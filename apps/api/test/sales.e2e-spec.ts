import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { after, before, test } from "node:test";
import { Pool as PgPool } from "pg";
import {
  TEST_CUSTOMER_A_TOKEN,
  TEST_MATCHING_TOKEN,
  TEST_MATCHING_USER_ID,
  TEST_SUPER_ADMIN_ID,
  TEST_SUPER_ADMIN_TOKEN,
  TEST_UNASSIGNED_TOKEN,
  TEST_UNASSIGNED_USER_ID,
  createTestApplication,
  testDocumentStorage,
} from "./test-application";
import { DatabasePort } from "../src/database/database.port";
import {
  POSTGRES_POOL,
  PostgresDatabaseService,
} from "../src/database/postgres-database.service";
import type { PostgresPool } from "../src/database/postgres-database.service";
import { OUTREACH_DRAFTER } from "../src/sales/outreach-drafting";
import {
  beginTestDatabase,
  endTestDatabase,
  getLocalDatabaseUrl,
} from "./postgres-test-database";
import {
  salesUnsubscribeEmail,
  salesUnsubscribeToken,
} from "../src/sales/sales-unsubscribe";

/** Everything is synthetic, nothing is sent, and the drafter is the fixed wording (asserted below). */
let application: INestApplication;
let baseUrl: string;
let pool: PostgresPool;

type Pool = {
  items: Array<{
    id: string;
    businessName: string;
    campaignName: string;
    score: number | null;
    dismissedAt: string | null;
    draftStatus: string | null;
    promotedLeadId: string | null;
  }>;
  total: number;
};
type Draft = {
  id: string;
  prospectId: string;
  recipientEmail: string;
  subject: string;
  body: string;
  status: string;
  method: string;
  edited: boolean;
  rejectedReason: string | null;
  decidedByName: string | null;
};
type DraftPage = {
  items: Draft[];
  total: number;
  counts: Record<string, number>;
};

const admin = TEST_SUPER_ADMIN_TOKEN;
const salesRep = TEST_UNASSIGNED_TOKEN;

function call(path: string, token: string | null, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (token) headers.set("authorization", `Bearer ${token}`);
  if (init.body) headers.set("content-type", "application/json");
  return fetch(`${baseUrl}${path}`, { ...init, headers });
}
const send = (
  method: string,
  path: string,
  token: string | null,
  body: unknown = {},
) =>
  call(path, token, {
    method,
    ...(method === "GET" ? {} : { body: JSON.stringify(body) }),
  });

async function newCampaign(name: string) {
  const response = await send("POST", "/api/v1/campaigns", admin, {
    name,
    targetService: "Sea freight import",
    targetIndustry: "Food importers",
    targetLocation: "Accra, Ghana",
  });
  assert.equal(response.status, 201);
  return ((await response.json()) as { id: string }).id;
}

/** A scored prospect, as the run pipeline would leave it. */
async function addProspect(
  campaignId: string,
  name: string,
  options: { score?: number | null; emails?: string[] } = {},
) {
  const id = randomUUID();
  const score = options.score === undefined ? 60 : options.score;
  await pool.query(
    `INSERT INTO app.prospect
       (prospect_id, campaign_id, business_name, source, normalized_name, emails,
        category, address, score, score_reason, score_method, scored_at)
     VALUES ($1::uuid, $2::uuid, $3, 'stub', $4, $5::text[], 'Food importer',
             '1 Example Road, Accra', $6, $7, $8, $9)`,
    [
      id,
      campaignId,
      name,
      name.toLowerCase(),
      options.emails ?? [],
      score,
      score === null ? null : "Synthetic reason",
      score === null ? null : "rules",
      score === null ? null : new Date().toISOString(),
    ],
  );
  return id;
}

async function poolOf(query = "") {
  const response = await call(`/api/v1/sales/pool${query}`, admin);
  assert.equal(response.status, 200);
  return (await response.json()) as Pool;
}
async function draftsOf(query = "") {
  const response = await call(`/api/v1/sales/drafts${query}`, admin);
  assert.equal(response.status, 200);
  return (await response.json()) as DraftPage;
}
async function draftFor(prospectIds: string[]) {
  const response = await send("POST", "/api/v1/sales/drafts", admin, {
    prospectIds,
  });
  assert.equal(response.status, 201);
  return (await response.json()) as {
    created: Draft[];
    skipped: Array<{ prospectId: string; reason: string }>;
  };
}

before(async () => {
  await beginTestDatabase();
  const started = await createTestApplication();
  application = started.application;
  baseUrl = started.baseUrl;
  pool = application.get(POSTGRES_POOL);
  const database = application.get(DatabasePort);
  await database.assignStaffRole(
    TEST_UNASSIGNED_USER_ID,
    "sales_rep",
    TEST_SUPER_ADMIN_ID,
  );
  await database.assignStaffRole(
    TEST_MATCHING_USER_ID,
    "import_rep",
    TEST_SUPER_ADMIN_ID,
  );
  // Never let a test reach a real AI.
  assert.equal(application.get(OUTREACH_DRAFTER).name, "template");
});

after(async () => {
  await application?.close();
  await endTestDatabase();
});

test("customers, other staff roles and anonymous callers are refused on every sales route", async () => {
  const id = randomUUID();
  const routes: Array<[string, string, unknown?]> = [
    ["GET", "/api/v1/sales/overview"],
    ["GET", "/api/v1/sales/pool"],
    [
      "POST",
      "/api/v1/sales/pool/dismiss",
      { prospectIds: [id], dismissed: true },
    ],
    ["POST", "/api/v1/sales/drafts", { prospectIds: [id] }],
    ["GET", "/api/v1/sales/drafts"],
    ["GET", "/api/v1/sales/messages"],
    ["GET", `/api/v1/sales/messages/${id}`],
    ["POST", "/api/v1/sales/messages/preview", {}],
    ["POST", "/api/v1/sales/messages/send", {}],
    ["POST", "/api/v1/sales/mailbox/sync"],
    ["POST", "/api/v1/sales/drafts/approve", { draftIds: [id] }],
    [
      "PATCH",
      `/api/v1/sales/drafts/${id}`,
      { recipientEmail: "a@example.test", subject: "s", body: "b" },
    ],
    ["POST", `/api/v1/sales/drafts/${id}/approve`],
    ["POST", `/api/v1/sales/drafts/${id}/reject`, {}],
  ];
  for (const [method, path, body] of routes) {
    for (const [who, token, status] of [
      ["a customer", TEST_CUSTOMER_A_TOKEN, 403],
      ["an import rep", TEST_MATCHING_TOKEN, 403],
      ["no sign-in", null, 401],
    ] as const) {
      const response = await send(method, path, token, body);
      assert.equal(response.status, status, `${method} ${path} as ${who}`);
    }
  }
  // A sales rep and the super admin are let in.
  for (const token of [salesRep, admin]) {
    assert.equal((await call("/api/v1/sales/overview", token)).status, 200);
    assert.equal((await call("/api/v1/sales/pool", token)).status, 200);
    assert.equal((await call("/api/v1/sales/messages", token)).status, 200);
  }
});

test("the pool lists prospects of every campaign and filters, searches and sorts them", async () => {
  const first = await newCampaign("Pool campaign one");
  const second = await newCampaign("Pool campaign two");
  await addProspect(first, "Pool Alpha Foods", {
    score: 80,
    emails: ["a@pool-alpha.example"],
  });
  await addProspect(first, "Pool Bravo Rice", { score: 40 });
  await addProspect(second, "Pool Charlie Grains", {
    score: null,
    emails: ["c@pool-charlie.example"],
  });

  const everything = await poolOf("?search=Pool%20&limit=10");
  assert.equal(everything.total, 3);
  // Best score first; an unscored business last; each says which campaign found it.
  assert.deepEqual(
    everything.items.map((item) => item.businessName),
    ["Pool Alpha Foods", "Pool Bravo Rice", "Pool Charlie Grains"],
  );
  assert.deepEqual(
    everything.items.map((item) => item.campaignName),
    ["Pool campaign one", "Pool campaign one", "Pool campaign two"],
  );

  const named = await poolOf("?search=Pool&sort=name");
  assert.deepEqual(
    named.items.map((item) => item.businessName),
    ["Pool Alpha Foods", "Pool Bravo Rice", "Pool Charlie Grains"],
  );
  assert.equal((await poolOf(`?campaignId=${second}`)).total, 1);
  assert.equal((await poolOf("?search=Pool&minScore=50")).total, 1);
  assert.equal((await poolOf("?search=Pool&hasEmail=true")).total, 2);
  assert.equal((await poolOf("?search=Pool&hasEmail=false")).total, 1);
  assert.equal((await poolOf("?search=rice")).total, 1);
  // A "%" in the search is text, not a wildcard.
  assert.equal((await poolOf("?search=%25")).total, 0);

  for (const bad of [
    "?status=maybe",
    "?sort=best",
    "?minScore=101",
    "?hasEmail=yes",
    "?campaignId=nope",
    "?limit=0",
    "?limit=201",
  ]) {
    const response = await call(`/api/v1/sales/pool${bad}`, admin);
    assert.equal(response.status, 400, bad);
  }
});

test("dismissing sets a business aside and restoring brings it back; a lead cannot be dismissed", async () => {
  const campaignId = await newCampaign("Dismiss campaign");
  const keep = await addProspect(campaignId, "Dismiss Keep Ltd");
  const away = await addProspect(campaignId, "Dismiss Away Ltd");
  const asLead = await addProspect(campaignId, "Dismiss Lead Ltd");

  const promoted = await send(
    "POST",
    `/api/v1/campaigns/${campaignId}/prospects/promote`,
    admin,
    { prospectIds: [asLead] },
  );
  assert.equal(promoted.status, 200);

  const dismiss = await send("POST", "/api/v1/sales/pool/dismiss", salesRep, {
    prospectIds: [away, asLead, randomUUID()],
    dismissed: true,
  });
  assert.equal(dismiss.status, 200);
  // Only the one that was free to dismiss changed.
  assert.deepEqual(await dismiss.json(), { changed: 1, unchanged: 2 });

  const waiting = await poolOf(`?campaignId=${campaignId}`);
  assert.deepEqual(
    waiting.items.map((item) => item.businessName),
    ["Dismiss Keep Ltd"],
  );
  const dismissed = await poolOf(`?campaignId=${campaignId}&status=dismissed`);
  assert.deepEqual(
    dismissed.items.map((item) => item.businessName),
    ["Dismiss Away Ltd"],
  );
  assert.ok(dismissed.items[0].dismissedAt);
  const added = await poolOf(`?campaignId=${campaignId}&status=added`);
  assert.deepEqual(
    added.items.map((item) => item.businessName),
    ["Dismiss Lead Ltd"],
  );
  assert.ok(added.items[0].promotedLeadId);
  assert.equal((await poolOf(`?campaignId=${campaignId}&status=all`)).total, 3);

  // Dismissing it again changes nothing; restoring brings it back.
  const again = await send("POST", "/api/v1/sales/pool/dismiss", admin, {
    prospectIds: [away],
    dismissed: true,
  });
  assert.deepEqual(await again.json(), { changed: 0, unchanged: 1 });
  const restore = await send("POST", "/api/v1/sales/pool/dismiss", admin, {
    prospectIds: [away, keep],
    dismissed: false,
  });
  assert.deepEqual(await restore.json(), { changed: 1, unchanged: 1 });
  assert.equal((await poolOf(`?campaignId=${campaignId}`)).total, 2);

  for (const bad of [
    {},
    { prospectIds: [], dismissed: true },
    { prospectIds: [away] },
    { prospectIds: ["nope"], dismissed: true },
  ]) {
    const response = await send(
      "POST",
      "/api/v1/sales/pool/dismiss",
      admin,
      bad,
    );
    assert.equal(response.status, 400, JSON.stringify(bad));
  }
});

test("drafting writes one pending email per business with an address and reports the rest", async () => {
  const campaignId = await newCampaign("Drafting campaign");
  const withEmail = await addProspect(campaignId, "Draft Foods Ltd", {
    emails: ["sales@draft-foods.example", "other@draft-foods.example"],
  });
  const noEmail = await addProspect(campaignId, "Draft Silent Ltd");
  const setAside = await addProspect(campaignId, "Draft Away Ltd", {
    emails: ["a@draft-away.example"],
  });
  await send("POST", "/api/v1/sales/pool/dismiss", admin, {
    prospectIds: [setAside],
    dismissed: true,
  });
  const missing = randomUUID();

  const result = await draftFor([withEmail, noEmail, setAside, missing]);
  assert.equal(result.created.length, 1);
  const [draft] = result.created;
  assert.equal(draft.prospectId, withEmail);
  assert.equal(draft.recipientEmail, "sales@draft-foods.example");
  assert.equal(draft.status, "pending");
  assert.equal(draft.method, "template");
  assert.equal(draft.edited, false);
  assert.match(draft.subject, /Draft Foods Ltd/);
  assert.doesNotMatch(draft.body, /reply "?stop"?/i);
  assert.deepEqual(
    result.skipped.map((skip) => [skip.prospectId, skip.reason]).sort(),
    [
      [noEmail, "no_email"],
      [setAside, "dismissed"],
      [missing, "not_found"],
    ].sort(),
  );

  // Drafting again does not pile up a second open draft.
  const second = await draftFor([withEmail]);
  assert.equal(second.created.length, 0);
  assert.deepEqual(
    second.skipped.map((skip) => skip.reason),
    ["already_drafted"],
  );

  // The pool shows the draft's state.
  const pooled = await poolOf(`?campaignId=${campaignId}&search=Foods`);
  assert.equal(pooled.items[0].draftStatus, "pending");

  for (const bad of [{}, { prospectIds: [] }, { prospectIds: ["nope"] }]) {
    const response = await send("POST", "/api/v1/sales/drafts", admin, bad);
    assert.equal(response.status, 400, JSON.stringify(bad));
  }
  const tooMany = await send("POST", "/api/v1/sales/drafts", admin, {
    prospectIds: Array.from({ length: 21 }, () => randomUUID()),
  });
  assert.equal(tooMany.status, 400);
});

test("a person edits, approves or rejects a pending draft; the first decision stands", async () => {
  const campaignId = await newCampaign("Approval campaign");
  const ids = [
    await addProspect(campaignId, "Approve One Ltd", {
      emails: ["1@a.example"],
    }),
    await addProspect(campaignId, "Approve Two Ltd", {
      emails: ["2@a.example"],
    }),
    await addProspect(campaignId, "Approve Three Ltd", {
      emails: ["3@a.example"],
    }),
  ];
  const { created } = await draftFor(ids);
  assert.equal(created.length, 3);
  const [one, two, three] = created;

  // Edit: the wording changes and is marked as edited; a bad address is refused.
  const edited = await send(
    "PATCH",
    `/api/v1/sales/drafts/${one.id}`,
    salesRep,
    {
      recipientEmail: "boss@a.example",
      subject: "A better subject",
      body: "Hello, a better body.",
    },
  );
  assert.equal(edited.status, 200);
  const editedBody = (await edited.json()) as Draft;
  assert.equal(editedBody.recipientEmail, "boss@a.example");
  assert.equal(editedBody.subject, "A better subject");
  assert.equal(editedBody.edited, true);
  for (const bad of [
    { recipientEmail: "not-an-email", subject: "s", body: "b" },
    { recipientEmail: "a@a.example", subject: "", body: "b" },
    { recipientEmail: "a@a.example", subject: "s", body: "x".repeat(5001) },
    {},
  ]) {
    const response = await send(
      "PATCH",
      `/api/v1/sales/drafts/${one.id}`,
      admin,
      bad,
    );
    assert.equal(response.status, 400, JSON.stringify(bad).slice(0, 60));
  }
  // Saving the same wording is not an edit.
  const same = await send("PATCH", `/api/v1/sales/drafts/${two.id}`, admin, {
    recipientEmail: two.recipientEmail,
    subject: two.subject,
    body: two.body,
  });
  assert.equal(((await same.json()) as Draft).edited, false);

  // Approve records who and when; a second decision is refused and changes nothing.
  const approved = await send(
    "POST",
    `/api/v1/sales/drafts/${one.id}/approve`,
    salesRep,
  );
  assert.equal(approved.status, 200);
  const approvedBody = (await approved.json()) as Draft & {
    sendStatus: string;
  };
  assert.equal(approvedBody.status, "approved");
  assert.equal(approvedBody.sendStatus, "queued");
  // Who approved is recorded (the test sign-in has no display name, so it is the email).
  assert.ok(approvedBody.decidedByName);
  const queued = (await (
    await call(
      `/api/v1/sales/messages?search=${encodeURIComponent(approvedBody.subject)}`,
      admin,
    )
  ).json()) as {
    items: Array<{ sendStatus: string; to: Array<{ email: string }> }>;
  };
  assert.equal(queued.items.length, 1);
  assert.equal(queued.items[0]?.sendStatus, "queued");
  assert.equal(queued.items[0]?.to[0]?.email, "boss@a.example");
  assert.equal(
    (await send("POST", `/api/v1/sales/drafts/${one.id}/approve`, admin))
      .status,
    409,
  );
  assert.equal(
    (await send("POST", `/api/v1/sales/drafts/${one.id}/reject`, admin, {}))
      .status,
    409,
  );
  // If queueing failed after the approval was saved, approving again queues
  // the draft once; after that it is refused as before.
  await pool.query(
    `DELETE FROM app.sales_email_message WHERE draft_id = $1::uuid`,
    [one.id],
  );
  const recovered = await send(
    "POST",
    `/api/v1/sales/drafts/${one.id}/approve`,
    admin,
  );
  assert.equal(recovered.status, 200);
  assert.equal(
    ((await recovered.json()) as { sendStatus: string }).sendStatus,
    "queued",
  );
  assert.equal(
    (await send("POST", `/api/v1/sales/drafts/${one.id}/approve`, admin))
      .status,
    409,
  );
  assert.equal(
    (
      await send("PATCH", `/api/v1/sales/drafts/${one.id}`, admin, {
        recipientEmail: "a@a.example",
        subject: "late",
        body: "late",
      })
    ).status,
    409,
  );

  // Reject keeps the reason; the business can then be drafted for again.
  const rejected = await send(
    "POST",
    `/api/v1/sales/drafts/${two.id}/reject`,
    admin,
    {
      reason: "Wrong tone",
    },
  );
  assert.equal(rejected.status, 200);
  const rejectedBody = (await rejected.json()) as Draft;
  assert.equal(rejectedBody.status, "rejected");
  assert.equal(rejectedBody.rejectedReason, "Wrong tone");
  assert.equal((await draftFor([two.prospectId])).created.length, 1);

  // Batch approve: the pending one is approved, the decided and the unknown are reported.
  const batch = await send("POST", "/api/v1/sales/drafts/approve", admin, {
    draftIds: [three.id, one.id, randomUUID()],
  });
  assert.equal(batch.status, 200);
  const batchBody = (await batch.json()) as {
    approved: number;
    notPending: number;
    notFound: number;
  };
  assert.deepEqual(
    [batchBody.approved, batchBody.notPending, batchBody.notFound],
    [1, 1, 1],
  );

  // The queue lists pending drafts, and counts every status.
  const pending = await draftsOf("?status=pending");
  assert.ok(pending.items.every((draft) => draft.status === "pending"));
  assert.ok(pending.items.some((draft) => draft.prospectId === two.prospectId));
  assert.ok(pending.counts.approved >= 2 && pending.counts.rejected >= 1);
  assert.equal(
    (await call("/api/v1/sales/drafts?status=sent", admin)).status,
    400,
  );
  assert.equal(
    (await send("POST", `/api/v1/sales/drafts/${randomUUID()}/approve`, admin))
      .status,
    404,
  );
  assert.equal(
    (await send("POST", "/api/v1/sales/drafts/not-an-id/approve", admin))
      .status,
    404,
  );
});

test("staff can preview recipients and queue separate, tracked sales emails", async () => {
  const composition = {
    emails: ["first@example.test", "second@example.test", "first@example.test"],
    campaignIds: [],
    subject: "Synthetic sales email",
    body: "This synthetic test message is not sent.",
  };
  const previewResponse = await send(
    "POST",
    "/api/v1/sales/messages/preview",
    admin,
    composition,
  );
  assert.equal(previewResponse.status, 200);
  const preview = (await previewResponse.json()) as {
    recipients: string[];
    suppressed: string[];
  };
  assert.deepEqual(preview.recipients, [
    "first@example.test",
    "second@example.test",
  ]);

  const sendRequestId = randomUUID();
  const submitted = {
    ...composition,
    expectedRecipients: preview.recipients,
    sendRequestId,
  };
  const queueResponse = await send(
    "POST",
    "/api/v1/sales/messages/send",
    admin,
    submitted,
  );
  assert.equal(queueResponse.status, 200);
  assert.deepEqual(await queueResponse.json(), { queued: 2, suppressed: 0 });
  const retry = await send(
    "POST",
    "/api/v1/sales/messages/send",
    admin,
    submitted,
  );
  assert.equal(retry.status, 200);
  assert.deepEqual(await retry.json(), { queued: 2, suppressed: 0 });
  const concurrentRetries = await Promise.all([
    send("POST", "/api/v1/sales/messages/send", admin, submitted),
    send("POST", "/api/v1/sales/messages/send", admin, submitted),
  ]);
  for (const response of concurrentRetries) {
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { queued: 2, suppressed: 0 });
  }
  assert.equal(
    (
      await send("POST", "/api/v1/sales/messages/send", admin, {
        ...submitted,
        body: "Different message",
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await send("POST", "/api/v1/sales/messages/send", admin, {
        ...composition,
        expectedRecipients: preview.recipients,
      })
    ).status,
    400,
  );

  const page = (await (
    await call("/api/v1/sales/messages?search=Synthetic%20sales%20email", admin)
  ).json()) as {
    items: Array<{ sendStatus: string; to: Array<{ email: string }> }>;
  };
  assert.equal(page.items.length, 2);
  assert.ok(page.items.every((email) => email.sendStatus === "queued"));
  assert.deepEqual(page.items.map((email) => email.to[0]?.email).sort(), [
    "first@example.test",
    "second@example.test",
  ]);
});

test("a failed broadcast insert rolls back every recipient and its request ledger", async () => {
  const database = application.get(DatabasePort);
  const requestId = randomUUID();
  const base = {
    fromEmail: "sales@bjhlogistics.com",
    subject: "Synthetic rollback",
    body: "No email is sent.",
    campaignIds: [],
    createdBy: TEST_SUPER_ADMIN_ID,
  };
  await assert.rejects(
    database.queueSalesEmailComposition({
      requestId,
      payloadHash: "a".repeat(64),
      createdBy: TEST_SUPER_ADMIN_ID,
      initialSuppressed: 0,
      sends: [
        { ...base, id: randomUUID(), recipientEmail: "first@rollback.example" },
        {
          ...base,
          id: randomUUID(),
          recipientEmail: "second@rollback.example",
          createdBy: "not-a-uuid",
        },
      ],
    }),
  );
  assert.equal(await database.findSalesEmailSendRequest(requestId), null);
  const rows = await pool.query(
    `SELECT count(*)::int AS count FROM app.sales_email_message WHERE send_request_id = $1::uuid`,
    [requestId],
  );
  assert.equal(rows.rows[0].count, 0);
});

test("the overview counts the pool, the funnel, drafts and what is due", async () => {
  const campaignId = await newCampaign("Overview campaign");
  const good = await addProspect(campaignId, "Overview Good Ltd", {
    score: 90,
    emails: ["g@o.example"],
  });
  await addProspect(campaignId, "Overview Weak Ltd", { score: 10 });
  const promoted = await send(
    "POST",
    `/api/v1/campaigns/${campaignId}/prospects/promote`,
    admin,
    { prospectIds: [good] },
  );
  const leadId = (
    (await promoted.json()) as { results: Array<{ leadId: string }> }
  ).results[0].leadId;
  // The lead has a follow-up that is already due.
  const due = await send("PATCH", `/api/v1/leads/${leadId}`, admin, {
    nextFollowUp: "2020-01-01",
  });
  assert.equal(due.status, 200);

  const response = await call("/api/v1/sales/overview", admin);
  assert.equal(response.status, 200);
  const overview = (await response.json()) as {
    pool: { waiting: number; goodFit: number; withEmail: number };
    funnel: { found: number; goodFit: number; addedToLeads: number };
    leads: { open: number; followUpsDue: number };
    drafts: { pending: number; approved: number; rejected: number };
    followUps: Array<{ leadId: string; overdue: boolean }>;
    recentActivity: Array<{ leadId: string }>;
    campaigns: Array<{
      name: string;
      found: number;
      goodFit: number;
      added: number;
    }>;
  };
  assert.ok(overview.funnel.found >= 2);
  assert.ok(overview.funnel.goodFit >= 1);
  assert.ok(overview.funnel.addedToLeads >= 1);
  assert.ok(overview.pool.waiting >= 1);
  assert.ok(overview.leads.open >= 1);
  assert.ok(overview.leads.followUpsDue >= 1);
  const followUp = overview.followUps.find((item) => item.leadId === leadId);
  assert.ok(followUp?.overdue);
  assert.ok(overview.recentActivity.some((item) => item.leadId === leadId));
  assert.ok(overview.drafts.pending >= 0);
  const mine = overview.campaigns.find((c) => c.name === "Overview campaign");
  assert.deepEqual([mine?.found, mine?.goodFit, mine?.added], [2, 1, 1]);
});

test("public unsubscribe needs a valid token and explicit POST", async () => {
  const previousKey = process.env.OUTREACH_UNSUBSCRIBE_KEY;
  const previousUrl = process.env.PUBLIC_API_URL;
  const key = Buffer.alloc(32, 7);
  process.env.OUTREACH_UNSUBSCRIBE_KEY = key.toString("hex");
  process.env.PUBLIC_API_URL = "http://127.0.0.1:3001/api";
  try {
    const email = "optout@example.test";
    const token = salesUnsubscribeToken(email, key);
    assert.equal(salesUnsubscribeEmail(token, key), email);
    assert.equal(salesUnsubscribeEmail(`${token}x`, key), null);
    const path = `/api/v1/sales/unsubscribe/${token}`;
    const page = await call(path, null);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Stop sales emails/);
    assert.deepEqual(
      await application.get(DatabasePort).listSuppressedSalesEmails([email]),
      [],
    );
    assert.equal((await send("POST", path, null, {})).status, 400);
    assert.equal(
      (await send("POST", `${path}x`, null, { confirm: "yes" })).status,
      400,
    );
    const result = await send("POST", path, null, {
      "List-Unsubscribe": "One-Click",
    });
    assert.equal(result.status, 200);
    assert.match(
      await result.text(),
      /You will no longer receive sales emails/,
    );
    assert.deepEqual(
      await application.get(DatabasePort).listSuppressedSalesEmails([email]),
      [email],
    );
    const form = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "confirm=yes",
    });
    assert.equal(form.status, 200, await form.text());
  } finally {
    if (previousKey === undefined) delete process.env.OUTREACH_UNSUBSCRIBE_KEY;
    else process.env.OUTREACH_UNSUBSCRIBE_KEY = previousKey;
    if (previousUrl === undefined) delete process.env.PUBLIC_API_URL;
    else process.env.PUBLIC_API_URL = previousUrl;
  }
});

test("staff can suppress a reviewed incoming sender and queued mail respects it", async () => {
  const database = application.get(DatabasePort);
  const imported = await database.storeSyncedSalesEmail({
    folder: "INBOX",
    uidValidity: "1",
    uid: 870,
    messageId: "<optout-870@example.test>",
    inReplyTo: null,
    references: [],
    direction: "incoming",
    fromName: null,
    fromEmail: "review-optout@example.test",
    to: [{ name: null, email: "sales@bjhlogistics.com" }],
    cc: [],
    subject: "Please remove me",
    body: "Please take me off your list.",
    receivedAt: new Date().toISOString(),
  });
  const path = `/api/v1/sales/messages/${imported.id}/unsubscribe-sender`;
  for (const token of [TEST_CUSTOMER_A_TOKEN, TEST_MATCHING_TOKEN]) {
    assert.equal((await send("POST", path, token)).status, 403);
  }
  assert.equal((await send("POST", path, salesRep)).status, 200);
  assert.equal((await send("POST", path, admin)).status, 200);
  const detail = await call(`/api/v1/sales/messages/${imported.id}`, admin);
  assert.equal(detail.status, 200);
  assert.equal(
    ((await detail.json()) as { senderSuppressed: boolean }).senderSuppressed,
    true,
  );
  assert.deepEqual(
    await database.listSuppressedSalesEmails(["review-optout@example.test"]),
    ["review-optout@example.test"],
  );
  assert.equal(
    await database.queueSalesEmailMessage({
      id: randomUUID(),
      fromEmail: "sales@bjhlogistics.com",
      recipientEmail: "review-optout@example.test",
      subject: "Synthetic blocked send",
      body: "Not sent",
      campaignIds: [],
      createdBy: TEST_SUPER_ADMIN_ID,
    }),
    "suppressed",
  );
  const outgoingId = randomUUID();
  assert.equal(
    await database.queueSalesEmailMessage({
      id: outgoingId,
      fromEmail: "sales@bjhlogistics.com",
      recipientEmail: "another@example.test",
      subject: "Synthetic outgoing",
      body: "Not sent",
      campaignIds: [],
      createdBy: TEST_SUPER_ADMIN_ID,
    }),
    "queued",
  );
  assert.equal(
    (
      await send(
        "POST",
        `/api/v1/sales/messages/${outgoingId}/unsubscribe-sender`,
        admin,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await send(
        "POST",
        `/api/v1/sales/messages/${randomUUID()}/unsubscribe-sender`,
        admin,
      )
    ).status,
    404,
  );
});

test("staff can retry only failed unsuppressed platform mail", async () => {
  const database = application.get(DatabasePort);
  const emailId = randomUUID();
  assert.equal(
    await database.queueSalesEmailMessage({
      id: emailId,
      fromEmail: "sales@bjhlogistics.com",
      recipientEmail: "retry@example.test",
      subject: "Synthetic retry",
      body: "No email is sent by this test.",
      campaignIds: [],
      createdBy: TEST_SUPER_ADMIN_ID,
    }),
    "queued",
  );
  await pool.query(
    `UPDATE app.sales_email_message
     SET send_status = 'failed', send_started_at = clock_timestamp() - interval '2 days',
         error = 'Synthetic failure'
     WHERE email_id = $1::uuid`,
    [emailId],
  );
  await pool.query(
    `INSERT INTO app.sales_email_send_attempt (email_id, started_at, finished_at, status, error)
     SELECT email_id, send_started_at, send_started_at + interval '1 second', 'failed', error
     FROM app.sales_email_message WHERE email_id = $1::uuid`,
    [emailId],
  );
  const path = `/api/v1/sales/messages/${emailId}/retry`;
  assert.equal((await send("POST", path, TEST_CUSTOMER_A_TOKEN)).status, 403);
  const response = await send("POST", path, admin);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { queued: true });
  const retried = await pool.query(
    `SELECT send_status, send_started_at, error FROM app.sales_email_message WHERE email_id = $1::uuid`,
    [emailId],
  );
  assert.equal(retried.rows[0].send_status, "queued");
  assert.equal(retried.rows[0].send_started_at, null);
  assert.equal(retried.rows[0].error, null);
  const attempts = await pool.query(
    `SELECT count(*)::int AS count FROM app.sales_email_send_attempt WHERE email_id = $1::uuid`,
    [emailId],
  );
  assert.equal(attempts.rows[0].count, 1);
  assert.equal((await send("POST", path, admin)).status, 409);

  const suppressedId = randomUUID();
  await database.queueSalesEmailMessage({
    id: suppressedId,
    fromEmail: "sales@bjhlogistics.com",
    recipientEmail: "blocked-retry@example.test",
    subject: "Synthetic suppressed retry",
    body: "No email is sent by this test.",
    campaignIds: [],
    createdBy: TEST_SUPER_ADMIN_ID,
  });
  await pool.query(
    `UPDATE app.sales_email_message SET send_status = 'failed'
     WHERE email_id = $1::uuid`,
    [suppressedId],
  );
  await database.suppressSalesEmail({
    email: "blocked-retry@example.test",
    reason: "bounce",
  });
  assert.equal(
    (await send("POST", `/api/v1/sales/messages/${suppressedId}/retry`, admin))
      .status,
    409,
  );
});

test("sales attachment metadata and download stay inside staff mailbox access", async () => {
  const database = application.get(DatabasePort);
  const imported = await database.storeSyncedSalesEmail({
    folder: "INBOX",
    uidValidity: "1",
    uid: 869,
    messageId: "<attachment-869@example.test>",
    inReplyTo: null,
    references: [],
    direction: "incoming",
    fromName: null,
    fromEmail: "file@example.test",
    to: [{ name: null, email: "sales@bjhlogistics.com" }],
    cc: [],
    subject: "Synthetic file",
    body: "A synthetic file follows.",
    receivedAt: new Date().toISOString(),
  });
  const attachmentId = randomUUID();
  const key = `sales-email/${imported.id}/${randomUUID()}`;
  await testDocumentStorage.put(
    key,
    Buffer.from("Synthetic attachment"),
    "application/octet-stream",
  );
  await database.saveSalesEmailAttachment({
    id: attachmentId,
    emailId: imported.id,
    partIndex: 0,
    filename: "sample.txt",
    sizeBytes: 20,
    objectKey: key,
  });
  const detail = await call(`/api/v1/sales/messages/${imported.id}`, admin);
  assert.equal(detail.status, 200);
  const message = (await detail.json()) as {
    attachments: Array<{ id: string; available: boolean }>;
  };
  assert.deepEqual(message.attachments, [
    {
      id: attachmentId,
      filename: "sample.txt",
      sizeBytes: 20,
      available: true,
    },
  ]);
  const path = `/api/v1/sales/messages/${imported.id}/attachments/${attachmentId}/download`;
  const download = await call(path, admin);
  assert.equal(download.status, 200);
  const link = (await download.json()) as { url: string; filename: string };
  assert.match(link.url, /\/signed\/sales-email\//);
  assert.equal(link.filename, "sample.txt");
  for (const token of [TEST_CUSTOMER_A_TOKEN, TEST_MATCHING_TOKEN]) {
    assert.equal((await call(path, token)).status, 403);
  }
  assert.equal(
    (
      await call(
        `/api/v1/sales/messages/${randomUUID()}/attachments/${attachmentId}/download`,
        admin,
      )
    ).status,
    404,
  );
});

test("mailbox import reports only newly stored messages", async () => {
  const database = application.get(DatabasePort);
  const message = {
    folder: "INBOX",
    uidValidity: "1",
    uid: 880,
    messageId: "<incoming-880@example.test>",
    inReplyTo: null,
    references: [],
    direction: "incoming" as const,
    fromName: null,
    fromEmail: "sender@example.test",
    to: [{ name: null, email: "sales@bjhlogistics.com" }],
    cc: [],
    subject: "Synthetic import",
    body: "Synthetic only",
    receivedAt: new Date().toISOString(),
  };
  const firstImport = await database.storeSyncedSalesEmail(message);
  assert.equal(firstImport.inserted, true);
  assert.deepEqual(await database.storeSyncedSalesEmail(message), {
    id: firstImport.id,
    inserted: false,
  });
  const resetUidValidity = await database.storeSyncedSalesEmail({
    ...message,
    uidValidity: "2",
    uid: 1,
  });
  assert.deepEqual(resetUidValidity, { id: firstImport.id, inserted: false });
  const archivedCopy = await database.storeSyncedSalesEmail({
    ...message,
    folder: "Archive",
    uid: 15,
  });
  assert.deepEqual(archivedCopy, { id: firstImport.id, inserted: false });
  const archive = await call("/api/v1/sales/messages?folder=Archive", admin);
  assert.equal(archive.status, 200);
  const page = (await archive.json()) as {
    items: Array<{ id: string; folder: string | null }>;
    total: number;
  };
  assert.equal(page.total, 1);
  assert.equal(page.items[0].id, firstImport.id);
  assert.equal(page.items[0].folder, "Archive");
  const folders = await call("/api/v1/sales/mailbox/folders", admin);
  assert.deepEqual((await folders.json()) as string[], ["Archive", "INBOX"]);
});

test("sales mailbox sync lock prevents concurrent API instances", async () => {
  const realPool = new PgPool({
    connectionString: getLocalDatabaseUrl(),
    ssl: false,
    max: 2,
  });
  try {
    const database = new PostgresDatabaseService(realPool);
    const releaseFirst = await database.acquireSalesEmailSyncLock();
    assert.equal(typeof releaseFirst, "function");
    assert.equal(await database.acquireSalesEmailSyncLock(), null);
    await releaseFirst!();
    const releaseNext = await database.acquireSalesEmailSyncLock();
    assert.equal(typeof releaseNext, "function");
    await releaseNext!();
  } finally {
    await realPool.end();
  }
});

test("a reply keeps the incoming thread and cannot be redirected", async () => {
  const database = application.get(DatabasePort);
  await database.storeSyncedSalesEmail({
    folder: "INBOX",
    uidValidity: "1",
    uid: 871,
    messageId: "<incoming-871@example.test>",
    inReplyTo: "<earlier@example.test>",
    references: ["<earlier@example.test>"],
    direction: "incoming",
    fromName: "Synthetic Sender",
    fromEmail: "sender@example.test",
    to: [{ name: null, email: "sales@bjhlogistics.com" }],
    cc: [],
    subject: "Synthetic question",
    body: "A synthetic question",
    receivedAt: new Date().toISOString(),
  });
  const incoming = await pool.query(
    `SELECT email_id FROM app.sales_email_message WHERE mailbox_uid = 871`,
  );
  const replyToMessageId = String(incoming.rows[0].email_id);
  const reply = {
    replyToMessageId,
    emails: ["sender@example.test"],
    campaignIds: [],
    subject: "Re: Synthetic question",
    body: "A synthetic answer",
  };
  const preview = await send(
    "POST",
    "/api/v1/sales/messages/preview",
    admin,
    reply,
  );
  assert.equal(preview.status, 200);
  const queued = await send("POST", "/api/v1/sales/messages/send", admin, {
    ...reply,
    expectedRecipients: ["sender@example.test"],
    sendRequestId: randomUUID(),
  });
  assert.equal(queued.status, 200);
  const rows = await pool.query(
    `SELECT in_reply_to, references_ids FROM app.sales_email_message
     WHERE source = 'platform' AND subject = 'Re: Synthetic question'`,
  );
  assert.equal(rows.rows[0].in_reply_to, "<incoming-871@example.test>");
  assert.deepEqual(rows.rows[0].references_ids, [
    "<earlier@example.test>",
    "<incoming-871@example.test>",
  ]);
  await database.storeSyncedSalesEmail({
    folder: "INBOX",
    uidValidity: "1",
    uid: 872,
    messageId: "<incoming-872@example.test>",
    inReplyTo: "<incoming-871@example.test>",
    references: ["<earlier@example.test>", "<incoming-871@example.test>"],
    direction: "incoming",
    fromName: null,
    fromEmail: "sender@example.test",
    to: [{ name: null, email: "sales@bjhlogistics.com" }],
    cc: [],
    subject: "Re: Synthetic question",
    body: "A second synthetic reply",
    receivedAt: new Date().toISOString(),
  });
  const threadPath = `/api/v1/sales/messages/${replyToMessageId}/thread`;
  const threadResponse = await call(threadPath, admin);
  assert.equal(threadResponse.status, 200);
  const thread = (await threadResponse.json()) as Array<{ body: string }>;
  assert.equal(thread.length, 3);
  assert.ok(
    thread.some((message) => message.body === "A second synthetic reply"),
  );
  assert.equal((await call(threadPath, TEST_CUSTOMER_A_TOKEN)).status, 403);
  assert.equal((await call(threadPath, TEST_MATCHING_TOKEN)).status, 403);
  assert.equal(
    (await call(`/api/v1/sales/messages/${randomUUID()}/thread`, admin)).status,
    404,
  );
  for (const invalid of [
    { ...reply, emails: ["someone-else@example.test"] },
    { ...reply, campaignIds: [randomUUID()] },
  ]) {
    assert.equal(
      (await send("POST", "/api/v1/sales/messages/preview", admin, invalid))
        .status,
      400,
    );
  }
});

test("SMTP acceptance records one campaign lead activity and advances only new leads", async () => {
  const database = application.get(DatabasePort);
  const campaignId = await newCampaign("Synthetic send activity campaign");
  const prospectId = await addProspect(campaignId, "Activity Recipient Ltd", {
    emails: ["activity@example.test"],
  });
  const promoted = await send(
    "POST",
    `/api/v1/campaigns/${campaignId}/prospects/promote`,
    admin,
    { prospectIds: [prospectId] },
  );
  assert.equal(promoted.status, 200);
  const leadId = (
    (await promoted.json()) as { results: Array<{ leadId: string }> }
  ).results[0].leadId;

  const messageId = randomUUID();
  await pool.query(
    `INSERT INTO app.sales_email_message
       (email_id, direction, source, send_status, from_email, to_recipients,
        subject, body_text, created_by, campaign_ids)
     VALUES ($1::uuid, 'outgoing', 'platform', 'sending', 'sales@bjhlogistics.com',
             '[{"email":"activity@example.test"}]'::jsonb, 'Synthetic activity',
             'No email sent', $2::uuid, ARRAY[$3::uuid])`,
    [messageId, TEST_SUPER_ADMIN_ID, campaignId],
  );
  await database.finishSalesEmailMessage({ id: messageId, status: "accepted" });
  await database.finishSalesEmailMessage({ id: messageId, status: "accepted" });
  const lead = await pool.query(
    `SELECT stage FROM app.lead WHERE lead_id = $1::uuid`,
    [leadId],
  );
  assert.equal(lead.rows[0].stage, "contacted");
  const activities = await pool.query(
    `SELECT kind, note FROM app.lead_activity WHERE lead_id = $1::uuid AND kind = 'email'`,
    [leadId],
  );
  assert.equal(activities.rows.length, 1);
  assert.match(String(activities.rows[0].note), /accepted by SMTP/);

  const failedId = randomUUID();
  await pool.query(
    `INSERT INTO app.sales_email_message
       (email_id, direction, source, send_status, from_email, to_recipients,
        subject, body_text, created_by, campaign_ids)
     VALUES ($1::uuid, 'outgoing', 'platform', 'sending', 'sales@bjhlogistics.com',
             '[{"email":"activity@example.test"}]'::jsonb, 'Synthetic failure',
             'No email sent', $2::uuid, ARRAY[$3::uuid])`,
    [failedId, TEST_SUPER_ADMIN_ID, campaignId],
  );
  await database.finishSalesEmailMessage({ id: failedId, status: "failed" });
  const afterFailure = await pool.query(
    `SELECT count(*)::int AS count FROM app.lead_activity WHERE lead_id = $1::uuid AND kind = 'email'`,
    [leadId],
  );
  assert.equal(afterFailure.rows[0].count, 1);

  const secondProspect = await addProspect(campaignId, "Other Activity Ltd", {
    emails: ["activity@example.test"],
  });
  const secondPromotion = await send(
    "POST",
    `/api/v1/campaigns/${campaignId}/prospects/promote`,
    admin,
    { prospectIds: [secondProspect] },
  );
  assert.equal(secondPromotion.status, 200);
  const secondLeadId = (
    (await secondPromotion.json()) as { results: Array<{ leadId: string }> }
  ).results[0].leadId;
  const ambiguousId = randomUUID();
  await pool.query(
    `INSERT INTO app.sales_email_message
       (email_id, direction, source, send_status, from_email, to_recipients,
        subject, body_text, created_by, campaign_ids)
     VALUES ($1::uuid, 'outgoing', 'platform', 'sending', 'sales@bjhlogistics.com',
             '[{"email":"activity@example.test"}]'::jsonb, 'Ambiguous activity',
             'No email sent', $2::uuid, ARRAY[$3::uuid])`,
    [ambiguousId, TEST_SUPER_ADMIN_ID, campaignId],
  );
  await database.finishSalesEmailMessage({
    id: ambiguousId,
    status: "accepted",
  });
  const ambiguousLead = await pool.query(
    `SELECT stage FROM app.lead WHERE lead_id = $1::uuid`,
    [secondLeadId],
  );
  assert.equal(ambiguousLead.rows[0].stage, "new");
  const afterAmbiguous = await pool.query(
    `SELECT count(*)::int AS count FROM app.lead_activity WHERE lead_id = $1::uuid AND kind = 'email'`,
    [leadId],
  );
  assert.equal(afterAmbiguous.rows[0].count, 1);

  // A copy filed in Sent may already hold the Message-ID: finishing keeps the
  // status instead of failing on the unique index.
  const holderId = randomUUID();
  const racedId = randomUUID();
  for (const [id, status, messageId] of [
    [holderId, "accepted", "<raced@example.test>"],
    [racedId, "sending", null],
  ] as const) {
    await pool.query(
      `INSERT INTO app.sales_email_message
         (email_id, direction, source, send_status, from_email, to_recipients,
          subject, body_text, created_by, message_id)
       VALUES ($1::uuid, 'outgoing', 'platform', $2, 'sales@bjhlogistics.com',
               '[{"email":"raced@example.test"}]'::jsonb, 'Raced copy',
               'No email sent', $3::uuid, $4)`,
      [id, status, TEST_SUPER_ADMIN_ID, messageId],
    );
  }
  await database.finishSalesEmailMessage({
    id: racedId,
    status: "accepted",
    messageId: "<raced@example.test>",
  });
  const raced = await pool.query(
    `SELECT send_status, message_id FROM app.sales_email_message WHERE email_id = $1::uuid`,
    [racedId],
  );
  assert.equal(raced.rows[0].send_status, "accepted");
  assert.equal(raced.rows[0].message_id, null);
});

test("the sales send claim spaces messages and stops at the daily cap", async () => {
  const database = application.get(DatabasePort);
  // Without saved limits, queued mail cannot leave the worker.
  assert.equal((await database.claimSalesEmailMessages(1)).length, 0);
  await pool.query(
    `INSERT INTO app.business_settings_revision (revision_number, settings, changed_by)
     SELECT COALESCE(max(revision_number), 0) + 1,
            '{"salesEmailLimits":{"dailyCap":100,"gapSeconds":60,"campaignDailyCap":500}}'::jsonb,
            $1::uuid FROM app.business_settings_revision`,
    [TEST_SUPER_ADMIN_ID],
  );
  // A later settings save that leaves the limit fields blank must not pause sending.
  await pool.query(
    `INSERT INTO app.business_settings_revision (revision_number, settings, changed_by)
     SELECT COALESCE(max(revision_number), 0) + 1, '{}'::jsonb, $1::uuid
     FROM app.business_settings_revision`,
    [TEST_SUPER_ADMIN_ID],
  );
  for (const recipientEmail of ["one@limit.example", "two@limit.example"]) {
    assert.equal(
      await database.queueSalesEmailMessage({
        id: randomUUID(),
        fromEmail: "sales@bjhlogistics.com",
        recipientEmail,
        subject: "Synthetic limit check",
        body: "No message is sent by this test.",
        campaignIds: [],
        createdBy: TEST_SUPER_ADMIN_ID,
      }),
      "queued",
    );
  }
  assert.equal((await database.claimSalesEmailMessages(20)).length, 1);
  assert.equal((await database.claimSalesEmailMessages(20)).length, 0);

  await pool.query(
    `INSERT INTO app.sales_email_message
       (direction, source, send_status, from_email, to_recipients, subject,
        body_text, send_started_at)
     SELECT 'outgoing', 'platform', 'failed', 'sales@bjhlogistics.com',
            '[{"email":"synthetic@limit.example"}]'::jsonb, 'Synthetic cap',
            'No real email', clock_timestamp() - interval '2 minutes'
     FROM generate_series(1, 100)`,
  );
  await pool.query(
    `INSERT INTO app.sales_email_send_attempt (email_id, started_at, finished_at, status)
     SELECT email_id, send_started_at, send_started_at, 'failed'
     FROM app.sales_email_message WHERE subject = 'Synthetic cap'`,
  );
  assert.equal((await database.claimSalesEmailMessages(1)).length, 0);
});

test("a stale in-progress send becomes unknown and is not automatically retried", async () => {
  const database = application.get(DatabasePort);
  const messageId = randomUUID();
  await pool.query(
    `INSERT INTO app.sales_email_message
       (email_id, direction, source, send_status, from_email, to_recipients,
        subject, body_text, send_started_at)
     VALUES ($1::uuid, 'outgoing', 'platform', 'sending',
             'sales@bjhlogistics.com', '[{"email":"stale@example.test"}]'::jsonb,
             'Synthetic stale send', 'No real email',
             clock_timestamp() - interval '11 minutes')`,
    [messageId],
  );
  await pool.query(
    `INSERT INTO app.sales_email_send_attempt
       (email_id, started_at, status)
     VALUES ($1::uuid, clock_timestamp() - interval '11 minutes', 'sending')`,
    [messageId],
  );

  assert.equal((await database.claimSalesEmailMessages(1)).length, 0);
  const stored = await pool.query(
    `SELECT message.send_status, attempt.status AS attempt_status,
            attempt.finished_at, message.error
     FROM app.sales_email_message message
     JOIN app.sales_email_send_attempt attempt USING (email_id)
     WHERE message.email_id = $1::uuid`,
    [messageId],
  );
  assert.equal(stored.rows[0].send_status, "unknown");
  assert.equal(stored.rows[0].attempt_status, "unknown");
  assert.ok(stored.rows[0].finished_at);
  assert.match(String(stored.rows[0].error), /provider result/);
  assert.equal(await database.retrySalesEmailMessage(messageId), "not_failed");
});

test("a saturated campaign waits while another campaign can claim mail", async () => {
  const database = application.get(DatabasePort);
  const saturated = randomUUID();
  const available = randomUUID();
  await pool.query(
    `INSERT INTO app.business_settings_revision (revision_number, settings, changed_by)
     SELECT COALESCE(max(revision_number), 0) + 1,
            '{"salesEmailLimits":{"dailyCap":500,"gapSeconds":1,"campaignDailyCap":2}}'::jsonb,
            $1::uuid FROM app.business_settings_revision`,
    [TEST_SUPER_ADMIN_ID],
  );
  // Every changed row belongs to this rolled-back synthetic test transaction.
  await pool.query(
    `UPDATE app.sales_email_message SET send_status = 'failed'
     WHERE send_status = 'queued'`,
  );
  await pool.query(
    `UPDATE app.sales_email_message
     SET send_started_at = clock_timestamp() - interval '2 minutes'
     WHERE send_started_at IS NOT NULL`,
  );
  await pool.query(
    `UPDATE app.sales_email_send_attempt
     SET started_at = clock_timestamp() - interval '2 minutes'`,
  );
  await pool.query(
    `INSERT INTO app.sales_email_message
       (direction, source, send_status, from_email, to_recipients, subject,
        body_text, send_started_at, campaign_ids)
     SELECT 'outgoing', 'platform',
            CASE WHEN n = 1 THEN 'accepted' ELSE 'failed' END,
            'sales@bjhlogistics.com',
            '[{"email":"synthetic@limit.example"}]'::jsonb, 'Synthetic campaign cap',
            'No real email', clock_timestamp() - interval '2 minutes', ARRAY[$1::uuid]
     FROM generate_series(1, 2) AS n`,
    [saturated],
  );
  await pool.query(
    `INSERT INTO app.sales_email_send_attempt (email_id, started_at, finished_at, status)
     SELECT email_id, send_started_at, send_started_at,
            CASE WHEN send_status = 'accepted' THEN 'accepted' ELSE 'failed' END
     FROM app.sales_email_message WHERE subject = 'Synthetic campaign cap'`,
  );
  for (const [recipientEmail, campaignIds] of [
    ["blocked@limit.example", [saturated]],
    ["allowed@limit.example", [available]],
  ] as const) {
    assert.equal(
      await database.queueSalesEmailMessage({
        id: randomUUID(),
        fromEmail: "sales@bjhlogistics.com",
        recipientEmail,
        subject: "Synthetic campaign queue",
        body: "No real email",
        campaignIds: [...campaignIds],
        createdBy: TEST_SUPER_ADMIN_ID,
      }),
      "queued",
    );
  }
  const claimed = await database.claimSalesEmailMessages(1);
  assert.equal(claimed.length, 1);
  assert.equal(claimed[0].recipientEmail, "allowed@limit.example");
});
