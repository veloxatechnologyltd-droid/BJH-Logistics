import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { after, before, test } from "node:test";
import {
  TEST_CUSTOMER_A_TOKEN,
  TEST_MATCHING_TOKEN,
  TEST_MATCHING_USER_ID,
  TEST_SUPER_ADMIN_ID,
  TEST_SUPER_ADMIN_TOKEN,
  TEST_UNASSIGNED_TOKEN,
  createTestApplication,
} from "./test-application";
import { DatabasePort } from "../src/database/database.port";
import {
  beginTestDatabase,
  endTestDatabase,
  testPostgresPool,
} from "./postgres-test-database";

let application: INestApplication;
let baseUrl: string;

const get = (path: string, token: string) =>
  fetch(`${baseUrl}${path}`, { headers: { authorization: `Bearer ${token}` } });
const badges = async (token: string) => {
  const response = await get("/api/v1/workspace/badges", token);
  assert.equal(response.status, 200);
  return response.json() as Promise<Record<string, number>>;
};
const sql = (text: string, values: unknown[] = []) =>
  testPostgresPool.query(text, values);

before(async () => {
  await beginTestDatabase();
  const started = await createTestApplication();
  application = started.application;
  baseUrl = started.baseUrl;
  const database = application.get(DatabasePort);
  await database.assignStaffRole(
    TEST_MATCHING_USER_ID,
    "import_rep",
    TEST_SUPER_ADMIN_ID,
  );
  const company = randomUUID();
  await database.createCustomer({
    id: company,
    companyName: "Badge Synthetic Ltd",
    createdAt: new Date().toISOString(),
    contacts: [],
  });

  const email = async () =>
    String(
      (
        await sql(
          `INSERT INTO app.inbound_email (message_id, from_email, body_text, received_at)
           VALUES ($1, 'client@example.test', 'Synthetic', now())
           RETURNING email_id`,
          [`<${randomUUID()}@example.test>`],
        )
      ).rows[0].email_id,
    );
  const request = async (fields: Record<string, unknown>) => {
    const columns = [
      "company_name",
      "contact_name",
      "email",
      "message",
      ...Object.keys(fields),
    ];
    const values = [
      "Badge Synthetic Ltd",
      "Ama",
      "client@example.test",
      "Synthetic request",
      ...Object.values(fields),
    ];
    await sql(
      `INSERT INTO app.quote_request (${columns.join(", ")})
       VALUES (${values.map((_, index) => `$${index + 1}`).join(", ")})`,
      values,
    );
  };
  const notification = async (
    jobId: string | null,
    daysAgo: number,
    status: "failed" | "sent",
  ) => {
    const id = String(
      (
        await sql(
          `INSERT INTO app.notification
             (company_id, job_id, event, dedupe_key, subject, body, sms_text, created_at)
           VALUES ($1::uuid, $2::uuid, 'client_message', $3, 'Synthetic', 'Body', 'Sms',
                   now() - make_interval(days => $4))
           RETURNING notification_id`,
          [company, jobId, randomUUID(), daysAgo],
        )
      ).rows[0].notification_id,
    );
    await sql(
      `INSERT INTO app.notification_delivery (notification_id, channel, status, sent_at)
       VALUES ($1::uuid, 'email', $2, CASE WHEN $2 = 'sent' THEN now() END)`,
      [id, status],
    );
    return id;
  };
  const job = async (serviceLine: string, number: string) =>
    String(
      (
        await sql(
          `INSERT INTO app.job (file_number, service_line, customer_company_id, opened_by)
           VALUES ($1, $2, $3::uuid, $4::uuid) RETURNING job_id`,
          [number, serviceLine, company, TEST_SUPER_ADMIN_ID],
        )
      ).rows[0].job_id,
    );
  const quote = async (serviceLine: string, statuses: string[]) => {
    const id = String(
      (
        await sql(
          `INSERT INTO app.quote (service_line, customer_company_id, created_by)
           VALUES ($1, $2::uuid, $3::uuid) RETURNING quote_id`,
          [serviceLine, company, TEST_SUPER_ADMIN_ID],
        )
      ).rows[0].quote_id,
    );
    for (const [index, status] of statuses.entries()) {
      await sql(
        `INSERT INTO app.quote_version
           (quote_id, version_number, currency, title, status, created_by, issued_at, issued_by)
         VALUES ($1::uuid, $2, 'GHS', 'Synthetic', $3, $4::uuid,
                 CASE WHEN $3 = 'issued' THEN now() END,
                 CASE WHEN $3 = 'issued' THEN $4::uuid END)`,
        [id, index + 1, status, TEST_SUPER_ADMIN_ID],
      );
    }
  };

  // Quote mail: one unchecked (counts), one checked, one not from email.
  await request({ inbound_email_id: await email(), source: "email" });
  await request({
    inbound_email_id: await email(),
    source: "email",
    reviewed_at: new Date(),
    reviewed_by: TEST_SUPER_ADMIN_ID,
  });
  await request({ source: "portal" });

  // Inquiries: escalated and unanswered (counts), escalated and answered, not escalated.
  const escalated = {
    mailbox: "inquiries",
    source: "email",
    escalated_at: new Date(),
    escalation_reason: "Synthetic",
  };
  await request({ ...escalated, inbound_email_id: await email() });
  await request({
    ...escalated,
    inbound_email_id: await email(),
    reply_subject: "Re: Synthetic",
    reply_body: "Answered",
    reply_sent_at: new Date(),
    reply_sent_by: TEST_SUPER_ADMIN_ID,
    reply_notification_id: await notification(null, 0, "sent"),
  });
  await request({
    mailbox: "inquiries",
    source: "email",
    inbound_email_id: await email(),
  });

  // Quotes: drafts on an import and an export line; one issued after its draft.
  await quote("sea_import", ["draft"]);
  await quote("sea_export", ["draft"]);
  await quote("sea_import", ["draft", "issued"]);

  // Failed messages this week: import job, export job, no job; one too old.
  await notification(await job("sea_import", "BJH/SI/2026/9001"), 1, "failed");
  await notification(await job("sea_export", "BJH/SE/2026/9001"), 1, "failed");
  await notification(null, 2, "failed");
  await notification(null, 8, "failed");

  // Client chat: two unread from the client, one read, one to the client.
  for (const [direction, read] of [
    ["from_client", false],
    ["from_client", false],
    ["from_client", true],
    ["to_client", false],
  ] as const) {
    await sql(
      `INSERT INTO app.chat_message
         (company_id, direction, channel, body, read_at, author_user_id)
       VALUES ($1::uuid, $2, 'portal', 'Synthetic', CASE WHEN $3 THEN now() END,
               CASE WHEN $2 = 'to_client' THEN $4::uuid END)`,
      [company, direction, read, TEST_SUPER_ADMIN_ID],
    );
  }
});

after(async () => {
  await application?.close();
  await endTestDatabase();
});

test("the super admin's menu counts every service line and client chat", async () => {
  assert.deepEqual(await badges(TEST_SUPER_ADMIN_TOKEN), {
    newQuoteRequests: 1,
    inquiriesForAPerson: 1,
    draftQuotes: 2,
    failedMessages: 3,
    chatUnread: 2,
  });
});

test("the counts match what the menu used to work out from the full lists", async () => {
  const list = async <T>(path: string) =>
    (await get(path, TEST_SUPER_ADMIN_TOKEN)).json() as Promise<T>;
  type Request = {
    intake: null | {
      reviewedAt: string | null;
      escalation: unknown;
      reply: null | { sentAt: string | null };
    };
  };
  const quoteMail = await list<Request[]>("/api/v1/quote-requests");
  const inquiries = await list<Request[]>(
    "/api/v1/quote-requests?mailbox=inquiries",
  );
  const quotes = await list<Array<{ latestStatus: string }>>("/api/v1/quotes");
  const feed = await list<{
    messages: Array<{
      createdAt: string;
      deliveries: Array<{ status: string }>;
    }>;
  }>("/api/v1/messages");
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const counts = await badges(TEST_SUPER_ADMIN_TOKEN);
  assert.equal(
    counts.newQuoteRequests,
    quoteMail.filter((r) => r.intake && !r.intake.reviewedAt).length,
  );
  assert.equal(
    counts.inquiriesForAPerson,
    inquiries.filter((r) => r.intake?.escalation && !r.intake.reply?.sentAt)
      .length,
  );
  assert.equal(
    counts.draftQuotes,
    quotes.filter((q) => q.latestStatus === "draft").length,
  );
  assert.equal(
    counts.failedMessages,
    feed.messages.filter(
      (m) =>
        Date.parse(m.createdAt) >= weekAgo &&
        m.deliveries.some((d) => d.status === "failed"),
    ).length,
  );
});

test("a department rep counts only their service lines and no client chat", async () => {
  assert.deepEqual(await badges(TEST_MATCHING_TOKEN), {
    newQuoteRequests: 1,
    inquiriesForAPerson: 1,
    draftQuotes: 1,
    failedMessages: 2,
    chatUnread: 0,
  });
});

test("customers and people without a staff role get no counts", async () => {
  for (const token of [TEST_CUSTOMER_A_TOKEN, TEST_UNASSIGNED_TOKEN]) {
    const response = await get("/api/v1/workspace/badges", token);
    assert.equal(response.status, 403);
  }
  assert.equal((await fetch(`${baseUrl}/api/v1/workspace/badges`)).status, 401);
});
