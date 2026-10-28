import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { after, before, beforeEach, test } from "node:test";
import {
  TEST_CUSTOMER_A_ID,
  TEST_CUSTOMER_A_TOKEN,
  TEST_MATCHING_TOKEN,
  TEST_MATCHING_USER_ID,
  TEST_SUPER_ADMIN_ID,
  TEST_SUPER_ADMIN_TOKEN,
  TEST_UNASSIGNED_TOKEN,
  TEST_UNASSIGNED_USER_ID,
  createTestApplication,
  testEmailExtractor,
  testReplyDrafter,
} from "./test-application";
import { DatabasePort } from "../src/database/database.port";
import { ReplyDraftError } from "../src/intake/reply-drafter";
import { automatedSender } from "../src/intake/email-assistant.service";
import { beginTestDatabase, endTestDatabase } from "./postgres-test-database";

const SECRET = "test-assistant-secret";

let application: INestApplication;
let baseUrl: string;
let database: DatabasePort;
let knownCompany: string;
let otherCompany: string;
let pastQuoteNumber: string;

function call(path: string, token: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  if (init.body) headers.set("content-type", "application/json");
  return fetch(`${baseUrl}${path}`, { ...init, headers });
}
const send = (method: string, path: string, token: string, body?: unknown) =>
  call(path, token, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const json = async <T>(response: Response) => (await response.json()) as T;

type Request = {
  id: string;
  customerCompanyId: string | null;
  customerCompanyName: string | null;
  quoteId: string | null;
  quoteStatus: string | null;
  intake: null | {
    kind: string | null;
    assistantNotes: string[];
    reply: null | {
      subject: string;
      body: string;
      model: string | null;
      sentAt: string | null;
      sentByAssistant: boolean;
    };
  };
};

const details = (over: Record<string, string | null> = {}) => ({
  service: "sea_import",
  origin: "Ningbo",
  destination: "Tema",
  cargo: "Ceramic tiles",
  quantity: "1 x 40ft",
  weightVolume: null,
  incoterm: "FOB",
  neededBy: null,
  contactPhone: null,
  ...over,
});

/** An email delivered as the email service would, read as `kind` with `over` details. */
async function deliver(
  from: string,
  kind: "quote" | "inquiry" | "other" | null,
  over: Record<string, string | null> = {},
  companyName = "Kpone Synthetic Hardware",
) {
  testEmailExtractor.result = {
    companyName,
    contactName: "Yaw Darko",
    details: details(over) as never,
    kind,
    question: kind === "other" ? null : "Wants a price for one container.",
  };
  testReplyDrafter.calls.length = 0;
  const form = new FormData();
  form.append("from_email", from);
  form.append("from_name", "Yaw Darko");
  form.append("subject", "Quotation needed");
  form.append("text", "Please quote 1 x 40ft Ningbo to Tema, FOB.");
  form.append("message_id", `<${randomUUID()}@mail.test>`);
  const response = await fetch(`${baseUrl}/api/v1/inbound-email`, {
    method: "POST",
    headers: { authorization: `Bearer ${SECRET}` },
    body: form,
  });
  assert.equal(response.status, 201, await response.clone().text());
  const { requestId } = await json<{ requestId: string }>(response);
  return json<Request>(
    await call(`/api/v1/quote-requests/${requestId}`, TEST_SUPER_ADMIN_TOKEN),
  );
}

before(async () => {
  process.env.INBOUND_EMAIL_SECRET = SECRET;
  delete process.env.ASSISTANT_AUTO_REPLY;
  await beginTestDatabase();
  const started = await createTestApplication();
  application = started.application;
  baseUrl = started.baseUrl;
  database = application.get(DatabasePort);
  await database.assignStaffRole(
    TEST_MATCHING_USER_ID,
    "sea_import_rep",
    TEST_SUPER_ADMIN_ID,
  );
  await database.assignStaffRole(
    TEST_UNASSIGNED_USER_ID,
    "air_export_rep",
    TEST_SUPER_ADMIN_ID,
  );
  const saved = await send("PUT", "/api/v1/settings", TEST_SUPER_ADMIN_TOKEN, {
    issuer: { name: "Synthetic Forwarding Ltd" },
    currencies: ["USD", "GHS"],
    numbering: {
      quotePrefix: "SYN/Q",
      invoicePrefix: "SYN/INV",
      receiptPrefix: "SYN/RCT",
    },
    quoteDefaults: {},
    assistant: { knowledge: "Office hours: Monday to Friday, 8:00 to 17:00." },
  });
  assert.equal(saved.status, 200, await saved.clone().text());

  knownCompany = randomUUID();
  otherCompany = randomUUID();
  const now = new Date().toISOString();
  await database.createCustomer({
    id: knownCompany,
    companyName: "Akwaaba Synthetic Garments Ltd",
    createdAt: now,
    contacts: [
      {
        id: randomUUID(),
        name: "Efua Owusu",
        email: "efua@akwaaba.example",
        notify: true,
        isPrimary: true,
        createdAt: now,
      },
    ],
  });
  await database.createCustomer({
    id: otherCompany,
    companyName: "Rival Synthetic Traders",
    createdAt: now,
    contacts: [],
  });
  await database.grantCustomerMembership(
    knownCompany,
    TEST_CUSTOMER_A_ID,
    TEST_SUPER_ADMIN_ID,
  );

  // A job for each company: only the sender's own may reach the reply.
  for (const company of [knownCompany, otherCompany]) {
    const job = await database.createJob(
      {
        customerCompanyId: company,
        serviceLine: "sea_import",
        quoteRequestId: null,
      },
      TEST_SUPER_ADMIN_ID,
      2026,
    );
    await database.appendEtaEvent({
      jobId: job.id,
      etaAt: "2026-11-02T14:30:00Z",
      source: "Carrier",
      note: null,
      recordedBy: TEST_SUPER_ADMIN_ID,
      correctionOf: null,
    });
  }

  // An issued quote for the rival on the same route: the starting point for new drafts.
  const { request: answered } = await database.createEmailQuoteRequest({
    email: {
      messageId: `<${randomUUID()}@mail.test>`,
      fromEmail: "buyer@rival.example",
      fromName: null,
      toAddress: null,
      subject: "Rate request",
      bodyText: "Please quote Ningbo to Tema.",
      receivedAt: now,
    },
    request: {
      id: randomUUID(),
      companyName: "Rival Synthetic Traders",
      contactName: "Buyer",
      message: "Please quote.",
    },
    attachments: [],
    skipped: [],
  });
  await database.completeEmailReading(answered.id, {
    status: "done",
    model: "test-model",
    companyName: null,
    contactName: null,
    details: details() as never,
    kind: "quote",
  });
  await database.linkQuoteRequestToCustomer(answered.id, otherCompany);
  const created = await send("POST", "/api/v1/quotes", TEST_SUPER_ADMIN_TOKEN, {
    customerCompanyId: otherCompany,
    serviceLine: "sea_import",
    quoteRequestId: answered.id,
    version: {
      currency: "USD",
      title: "Sea import quotation",
      sizeLabels: ["20ft", "40ft"],
      lines: [
        {
          description: "Clearance",
          basis: "per_container",
          sizeAmountsMinor: [30000, 45000],
        },
      ],
    },
  });
  assert.equal(created.status, 201, await created.clone().text());
  const { id } = await json<{ id: string }>(created);
  const issued = await json<{ quoteNumber: string }>(
    await send(
      "POST",
      `/api/v1/quotes/${id}/issue`,
      TEST_SUPER_ADMIN_TOKEN,
      {},
    ),
  );
  pastQuoteNumber = issued.quoteNumber;
});

beforeEach(() => {
  testReplyDrafter.result = {
    subject: "Re: Quotation needed",
    body: "Thank you. Your quotation will follow shortly.\n\nSynthetic Forwarding Ltd",
  };
});

after(async () => {
  await application?.close();
  await endTestDatabase();
  delete process.env.INBOUND_EMAIL_SECRET;
});

test("a quote request from a new sender gets a customer, a draft quote and a draft reply", async () => {
  const request = await deliver("yaw@kpone.example", "quote");

  assert.equal(request.intake?.kind, "quote");
  assert.equal(request.customerCompanyName, "Kpone Synthetic Hardware");
  const customer = await database.findCustomer(request.customerCompanyId!);
  assert.equal(customer?.contacts[0].email, "yaw@kpone.example");

  // The draft quote copies the rival's prices but never their name.
  assert.equal(request.quoteStatus, "draft");
  const quote = await database.findQuote(request.quoteId!, {});
  assert.equal(quote?.createdBy, null);
  assert.equal(quote?.createdByAssistant, true);
  assert.equal(quote?.customerCompanyId, request.customerCompanyId);
  assert.deepEqual(
    quote?.versions[0].lines[0].sizeAmountsMinor,
    [30000, 45000],
  );
  assert.equal(quote?.versions[0].createdByAssistant, true);

  const notes = request.intake!.assistantNotes;
  assert.ok(notes.some((note) => note.startsWith("The sender asks:")));
  assert.ok(notes.some((note) => note.startsWith("Created the customer")));
  assert.ok(
    notes.some((note) => note.includes(`${pastQuoteNumber} (same route)`)),
    notes.join(" | "),
  );

  assert.equal(request.intake!.reply?.model, "test-drafter");
  assert.equal(request.intake!.reply?.sentAt, null);
  const context = testReplyDrafter.calls[0];
  assert.equal(context.kind, "quote");
  assert.equal(context.quoteDrafted, true);
  assert.equal(context.jobs.length, 0, "a new customer has no jobs to share");
  assert.equal(
    context.priceGuide,
    null,
    "a quote request gets the quote, not a guide",
  );
  assert.match(context.knowledge ?? "", /Office hours/);
});

test("a question from a known contact uses only that customer's jobs, and prices without names", async () => {
  const request = await deliver("Efua@Akwaaba.example", "inquiry");

  assert.equal(request.customerCompanyId, knownCompany);
  assert.equal(request.quoteId, null, "a question gets no quote");
  const context = testReplyDrafter.calls[0];
  assert.equal(context.jobs.length, 1);
  const own = await database.listJobs("", { companyIds: [knownCompany] });
  assert.equal(context.jobs[0].fileNumber, own[0].fileNumber);
  assert.ok(context.jobs[0].eta);
  assert.equal(context.priceGuide?.match, "same route");
  assert.equal(context.priceGuide?.lines[0].amount, "20ft $300 / 40ft $450");
  assert.doesNotMatch(JSON.stringify(context), /Rival Synthetic Traders/);
});

test("an email that asks for nothing gets no customer, quote or reply", async () => {
  const request = await deliver("news@shipping-weekly.example", "other", {
    service: null,
  });
  assert.equal(request.customerCompanyId, null);
  assert.equal(request.quoteId, null);
  assert.equal(request.intake?.reply, null);
  assert.equal(testReplyDrafter.calls.length, 0);
});

test("a failed draft is noted and loses nothing; Draft reply tries again", async () => {
  testReplyDrafter.result = new ReplyDraftError(
    "The AI service is busy or over its limit",
  );
  const request = await deliver(
    "kofi@new-co.example",
    "inquiry",
    {},
    "New Synthetic Co",
  );
  assert.equal(request.intake?.reply, null);
  assert.ok(
    request.intake!.assistantNotes.some((note) =>
      note.includes("The AI service is busy"),
    ),
  );
  assert.ok(request.customerCompanyId);

  testReplyDrafter.result = { subject: "Re: hi", body: "Answer." };
  const again = await send(
    "POST",
    `/api/v1/quote-requests/${request.id}/reply/draft`,
    TEST_SUPER_ADMIN_TOKEN,
  );
  assert.equal(again.status, 201);
  assert.equal((await json<Request>(again)).intake?.reply?.body, "Answer.");
});

test("a person edits and sends the reply once, to the sender only; others cannot", async () => {
  const request = await deliver(
    "ama@sends.example",
    "quote",
    {},
    "Sends Synthetic Ltd",
  );
  const path = `/api/v1/quote-requests/${request.id}/reply`;
  const reply = { subject: "Re: Quotation needed", body: "Edited by staff." };

  // The rep of another service, a customer and an unknown caller are refused.
  assert.equal(
    (await send("POST", `${path}/send`, TEST_UNASSIGNED_TOKEN, reply)).status,
    403,
  );
  assert.equal(
    (await send("POST", `${path}/send`, TEST_CUSTOMER_A_TOKEN, reply)).status,
    403,
  );
  assert.equal(
    (await send("POST", `${path}/send`, "not-a-token", reply)).status,
    401,
  );
  assert.equal(
    (await send("POST", `${path}/send`, TEST_MATCHING_TOKEN, { subject: "" }))
      .status,
    400,
  );

  const saved = await send("PUT", path, TEST_MATCHING_TOKEN, reply);
  assert.equal(saved.status, 200);
  assert.equal((await json<Request>(saved)).intake?.reply?.model, null);

  const sent = await send("POST", `${path}/send`, TEST_MATCHING_TOKEN, reply);
  assert.equal(sent.status, 201, await sent.clone().text());
  assert.ok((await json<Request>(sent)).intake?.reply?.sentAt);

  const [message, ...more] = await database.listNotificationFeed({
    companyId: request.customerCompanyId!,
    event: "email_reply",
    serviceLines: null,
    limit: 10,
  });
  assert.equal(more.length, 0);
  assert.equal(message?.body, "Edited by staff.");
  assert.deepEqual(
    message?.deliveries.map((delivery) => [
      delivery.channel,
      delivery.recipient,
    ]),
    [["email", "ama@sends.example"]],
  );

  assert.equal(
    (await send("POST", `${path}/send`, TEST_MATCHING_TOKEN, reply)).status,
    409,
  );
  assert.equal(
    (await send("PUT", path, TEST_MATCHING_TOKEN, reply)).status,
    409,
  );
});

test("customers never see what the assistant read or wrote", async () => {
  const request = await deliver("efua@akwaaba.example", "inquiry");
  const seen = await json<Request>(
    await call(`/api/v1/quote-requests/${request.id}`, TEST_CUSTOMER_A_TOKEN),
  );
  assert.equal(seen.intake, null);
});

test("with automatic replies on, the reply goes to the sender by itself, without prices; the quote waits", async () => {
  process.env.ASSISTANT_AUTO_REPLY = "on";
  process.env.INBOUND_IMAP_USER = "quotes@synthetic-forwarding.example";
  try {
    const quote = await deliver(
      "kwame@auto.example",
      "quote",
      {},
      "Auto Synthetic Ltd",
    );
    assert.ok(quote.intake?.reply?.sentAt);
    assert.equal(quote.intake?.reply?.sentByAssistant, true);
    assert.equal(quote.quoteStatus, "draft", "a person still issues the quote");
    assert.ok(
      quote.intake!.assistantNotes.includes(
        "Sent the reply by itself to kwame@auto.example.",
      ),
    );
    const [message, ...more] = await database.listNotificationFeed({
      companyId: quote.customerCompanyId!,
      event: "email_reply",
      serviceLines: null,
      limit: 10,
    });
    assert.equal(more.length, 0);
    assert.equal(message?.createdBy, null);
    assert.deepEqual(
      message?.deliveries.map((delivery) => [
        delivery.channel,
        delivery.recipient,
      ]),
      [["email", "kwame@auto.example"]],
    );
    // Sent once: nobody can send or change it again.
    assert.equal(
      (
        await send(
          "POST",
          `/api/v1/quote-requests/${quote.id}/reply/send`,
          TEST_SUPER_ADMIN_TOKEN,
          { subject: "Again", body: "Again." },
        )
      ).status,
      409,
    );

    // A price question gets no figures when nobody reads the reply first.
    const question = await deliver("efua@akwaaba.example", "inquiry");
    assert.equal(testReplyDrafter.calls[0].priceGuide, null);
    assert.equal(question.intake?.reply?.sentByAssistant, true);

    // Machines and BJH's own mailbox are never answered by themselves.
    for (const from of [
      "no-reply@carrier.example",
      "quotes@synthetic-forwarding.example",
    ]) {
      const held = await deliver(from, "quote", {}, "Held Synthetic Ltd");
      assert.equal(held.intake?.reply?.sentAt, null, from);
      assert.ok(
        held.intake!.assistantNotes.some((note) =>
          note.startsWith("Reply not sent by itself"),
        ),
      );
    }

    const other = await deliver("news@shipping-weekly.example", "other", {
      service: null,
    });
    assert.equal(other.intake?.reply, null);
  } finally {
    delete process.env.ASSISTANT_AUTO_REPLY;
    delete process.env.INBOUND_IMAP_USER;
  }
});

test("automatic addresses are recognised", () => {
  const environment = { EMAIL_FROM: "BJH Logistics <Quotes@bjh.example>" };
  for (const address of [
    "noreply@x.example",
    "no-reply+bounce@x.example",
    "do-not-reply@x.example",
    "MAILER-DAEMON@x.example",
    "postmaster@x.example",
    "bounces@x.example",
    "quotes@bjh.example",
  ]) {
    assert.equal(automatedSender(address, environment), true, address);
  }
  for (const address of [
    "norah@x.example",
    "replyto@x.example",
    "ama@x.example",
  ]) {
    assert.equal(automatedSender(address, environment), false, address);
  }
});
