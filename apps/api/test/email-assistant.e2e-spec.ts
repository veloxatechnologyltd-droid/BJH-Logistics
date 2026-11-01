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
import {
  EMAIL_PROVIDER,
  INQUIRY_EMAIL_PROVIDER,
  RecordingEmailProvider,
} from "../src/notifications/providers";
import { NotificationDispatcher } from "../src/notifications/notification-dispatcher.service";

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
  mailbox: "quotes" | "inquiries";
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
      sources: string[];
    };
    escalation: null | { at: string; reason: string };
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

/** An email delivered as the email service would, read as `kind` with `over` details; questions reach the inquiries mailbox unless told otherwise. */
async function deliver(
  from: string,
  kind: "quote" | "inquiry" | "other" | null,
  over: Record<string, string | null> = {},
  companyName = "Kpone Synthetic Hardware",
  mailbox: "quotes" | "inquiries" = kind === "inquiry" ? "inquiries" : "quotes",
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
  form.append("mailbox", mailbox);
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
      source: "email",
      mailbox: "quotes",
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
    answered: true,
    missing: null,
    sources: [],
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

  testReplyDrafter.result = {
    subject: "Re: hi",
    body: "Answer.",
    answered: true,
    missing: null,
    sources: [],
  };
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

  // Staff find it among the messages sent, as a reply to an email.
  const feed = await json<{ messages: Array<{ id: string }> }>(
    await call("/api/v1/messages?event=email_reply", TEST_SUPER_ADMIN_TOKEN),
  );
  assert.ok(feed.messages.some((item) => item.id === message?.id));

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
  const request = await deliver("efua@akwaaba.example", "quote");
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

type LeadRow = {
  id: string;
  companyName: string;
  email: string | null;
  source: string;
  stage: string;
  ownerId: string | null;
  quoteRequestId: string | null;
};
const leadFor = async (requestId: string) =>
  (
    await json<LeadRow[]>(await call("/api/v1/leads", TEST_SUPER_ADMIN_TOKEN))
  ).find((lead) => lead.quoteRequestId === requestId);
const customerCount = async () => (await database.listCustomers("")).length;

test("a first-time sender who asks for a quote becomes a customer and an open lead", async () => {
  const request = await deliver(
    "pat@brightpath.example",
    "quote",
    {},
    "Brightpath Imports Ltd",
  );

  assert.equal(request.customerCompanyName, "Brightpath Imports Ltd");
  const lead = await leadFor(request.id);
  assert.ok(lead, "a lead was opened for the request");
  assert.equal(lead.companyName, "Brightpath Imports Ltd");
  assert.equal(lead.email, "pat@brightpath.example");
  assert.equal(lead.stage, "new");
  assert.equal(lead.source, "quote_request");
  assert.equal(lead.ownerId, null, "nobody owns it until staff take it");
  assert.ok(
    request.intake!.assistantNotes.some((note) =>
      note.startsWith("Opened a lead"),
    ),
  );
});

test("a known contact is linked as before: no lead, no possible match", async () => {
  const request = await deliver(
    "efua@akwaaba.example",
    "quote",
    {},
    "Akwaaba Garments",
  );

  assert.equal(request.customerCompanyId, knownCompany);
  assert.equal(await leadFor(request.id), undefined);
  assert.ok(
    !request.intake!.assistantNotes.some((note) =>
      note.startsWith("Possible match"),
    ),
  );
});

test("a question from a first-time sender gets a customer but no lead", async () => {
  const request = await deliver(
    "ama@goldcoastcargo.example",
    "inquiry",
    {},
    "Gold Coast Cargo Ltd",
  );

  assert.equal(request.customerCompanyName, "Gold Coast Cargo Ltd");
  assert.equal(await leadFor(request.id), undefined);
});

test("a sender who is probably an existing customer is held for a person: not linked, no new customer, no lead, no quote", async () => {
  const now = new Date().toISOString();
  const veloxa = randomUUID();
  await database.createCustomer({
    id: veloxa,
    companyName: "Veloxa Technology Ltd",
    createdAt: now,
    contacts: [
      {
        id: randomUUID(),
        name: "Ama Boateng",
        email: "ama@veloxatech.example",
        notify: true,
        isPrimary: true,
        createdAt: now,
      },
    ],
  });
  process.env.ASSISTANT_AUTO_REPLY = "on";
  try {
    const before = await customerCount();

    // The same company under a shorter name, from a personal mailbox.
    const byName = await deliver(
      "kofi.v@gmail.com",
      "quote",
      {},
      "Veloxa Tech",
    );
    // A colleague at the company's own address, signing with their own name.
    const byDomain = await deliver(
      "kwame@veloxatech.example",
      "quote",
      {},
      "Kwame Asante",
    );

    for (const [request, why] of [
      [byName, "similar name"],
      [byDomain, "same email domain"],
    ] as const) {
      assert.equal(request.customerCompanyId, null, why);
      assert.equal(request.quoteId, null, `${why}: no draft quote yet`);
      assert.equal(await leadFor(request.id), undefined, why);
      assert.ok(
        request.intake!.assistantNotes.some(
          (note) =>
            note.startsWith(
              "Possible match, not linked: Veloxa Technology Ltd",
            ) && note.includes(why),
        ),
        request.intake!.assistantNotes.join(" | "),
      );
      // The reply is drafted for a person to read; it does not go out by itself.
      assert.ok(request.intake!.reply, why);
      assert.equal(request.intake!.reply!.sentAt, null, why);
      assert.ok(
        request.intake!.assistantNotes.some((note) =>
          note.startsWith("Reply not sent by itself"),
        ),
      );
    }
    assert.equal(await customerCount(), before, "no duplicate customer");
  } finally {
    delete process.env.ASSISTANT_AUTO_REPLY;
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

const inquiriesOf = async (token: string) =>
  call("/api/v1/quote-requests?mailbox=inquiries", token);

test("the knowledge base: the super admin writes it, staff read it, others are refused", async () => {
  const entry = {
    title: "Office hours",
    answer: "Monday to Friday, 8:00 to 17:00.",
  };
  assert.equal(
    (await send("POST", "/api/v1/knowledge", TEST_MATCHING_TOKEN, entry))
      .status,
    403,
  );
  assert.equal(
    (await send("POST", "/api/v1/knowledge", TEST_CUSTOMER_A_TOKEN, entry))
      .status,
    403,
  );
  assert.equal(
    (
      await send("POST", "/api/v1/knowledge", TEST_SUPER_ADMIN_TOKEN, {
        title: "",
      })
    ).status,
    400,
  );
  const created = await send(
    "POST",
    "/api/v1/knowledge",
    TEST_SUPER_ADMIN_TOKEN,
    entry,
  );
  assert.equal(created.status, 201, await created.clone().text());
  const { id } = await json<{ id: string }>(created);
  const updated = await send(
    "PUT",
    `/api/v1/knowledge/${id}`,
    TEST_SUPER_ADMIN_TOKEN,
    {
      ...entry,
      answer: "Monday to Friday, 8:00 to 17:30.",
    },
  );
  assert.equal(updated.status, 200);
  const listed = await json<Array<{ title: string; answer: string }>>(
    await call("/api/v1/knowledge", TEST_MATCHING_TOKEN),
  );
  assert.deepEqual(
    listed.map((item) => item.answer),
    ["Monday to Friday, 8:00 to 17:30."],
  );
  assert.equal(
    (await call("/api/v1/knowledge", TEST_CUSTOMER_A_TOKEN)).status,
    403,
  );
  assert.equal(
    (await send("DELETE", `/api/v1/knowledge/${id}`, TEST_MATCHING_TOKEN))
      .status,
    403,
  );
  assert.equal(
    (await send("DELETE", `/api/v1/knowledge/${id}`, TEST_SUPER_ADMIN_TOKEN))
      .status,
    204,
  );
  assert.equal(
    (await send("DELETE", `/api/v1/knowledge/${id}`, TEST_SUPER_ADMIN_TOKEN))
      .status,
    404,
  );
});

test("an inquiry is answered from the knowledge base, kept apart from quote requests, and hidden from customers", async () => {
  const created = await send(
    "POST",
    "/api/v1/knowledge",
    TEST_SUPER_ADMIN_TOKEN,
    {
      title: "Documents for sea import clearing",
      answer: "Bill of lading, commercial invoice, packing list.",
    },
  );
  assert.equal(created.status, 201);
  testReplyDrafter.result = {
    subject: "Re: Documents",
    body: "You will need the bill of lading, invoice and packing list.",
    answered: true,
    missing: null,
    sources: ["Documents for sea import clearing"],
  };
  const inquiry = await deliver("efua@akwaaba.example", "inquiry");
  assert.equal(inquiry.mailbox, "inquiries");
  assert.equal(inquiry.intake?.escalation, null);
  assert.deepEqual(inquiry.intake?.reply?.sources, [
    "Documents for sea import clearing",
  ]);
  assert.equal(inquiry.quoteId, null, "an inquiry never gets a draft quote");
  const context = testReplyDrafter.calls[0];
  assert.equal(context.kind, "inquiry");
  assert.deepEqual(
    context.knowledgeEntries.map((entry) => entry.title),
    ["Documents for sea import clearing"],
  );

  // Two inboxes: the inquiry is only in Inquiries.
  const quotes = await json<Request[]>(
    await call("/api/v1/quote-requests", TEST_SUPER_ADMIN_TOKEN),
  );
  assert.ok(!quotes.some((item) => item.id === inquiry.id));
  const inquiries = await json<Request[]>(
    await inquiriesOf(TEST_SUPER_ADMIN_TOKEN),
  );
  assert.ok(inquiries.some((item) => item.id === inquiry.id));
  assert.ok(inquiries.every((item) => item.mailbox === "inquiries"));
  assert.equal(
    (await call("/api/v1/quote-requests?mailbox=junk", TEST_SUPER_ADMIN_TOKEN))
      .status,
    400,
  );

  // The customer it is linked to never sees it, even asking for it.
  assert.equal(inquiry.customerCompanyId, knownCompany);
  const theirs = await json<Request[]>(
    await inquiriesOf(TEST_CUSTOMER_A_TOKEN),
  );
  assert.ok(!theirs.some((item) => item.id === inquiry.id));
  assert.equal(
    (await call(`/api/v1/quote-requests/${inquiry.id}`, TEST_CUSTOMER_A_TOKEN))
      .status,
    404,
  );

  // Any rep may answer an inquiry, even one whose service is not theirs; it goes out as an inquiry reply.
  const sent = await send(
    "POST",
    `/api/v1/quote-requests/${inquiry.id}/reply/send`,
    TEST_UNASSIGNED_TOKEN,
    {
      subject: "Re: Documents",
      body: "Checked and sent.",
    },
  );
  assert.equal(sent.status, 201, await sent.clone().text());
  const [message] = await database.listNotificationFeed({
    companyId: knownCompany,
    event: "inquiry_reply",
    serviceLines: null,
    limit: 10,
  });
  assert.equal(message?.subject, "Re: Documents");

  // The dispatcher sends it through the inquiries sender, not the quote mailbox's.
  const quoteSender = application.get<RecordingEmailProvider>(EMAIL_PROVIDER);
  const inquirySender = application.get<RecordingEmailProvider>(
    INQUIRY_EMAIL_PROVIDER,
  );
  quoteSender.sent.length = 0;
  inquirySender.sent.length = 0;
  await application.get(NotificationDispatcher).dispatchDue();
  assert.ok(
    inquirySender.sent.some((mail) => mail.subject === "Re: Documents"),
  );
  assert.ok(!quoteSender.sent.some((mail) => mail.subject === "Re: Documents"));
});

test("an inquiry the knowledge base does not answer, or that is unclear, waits for a person even with automatic replies on", async () => {
  process.env.ASSISTANT_AUTO_REPLY = "on";
  try {
    testReplyDrafter.result = {
      subject: "Re: Reefer",
      body: "A colleague will confirm this shortly.",
      answered: false,
      missing: "Whether BJH handles reefer containers.",
      sources: ["Not an entry that exists"],
    };
    const unsure = await deliver("efua@akwaaba.example", "inquiry");
    assert.equal(unsure.intake?.reply?.sentAt, null);
    assert.equal(
      unsure.intake?.escalation?.reason,
      "Whether BJH handles reefer containers.",
    );
    assert.ok(
      unsure.intake!.assistantNotes.includes(
        "Needs a person: Whether BJH handles reefer containers.",
      ),
    );

    const unclear = await deliver(
      "efua@akwaaba.example",
      null,
      {},
      "Kpone Synthetic Hardware",
      "inquiries",
    );
    assert.equal(
      unclear.intake?.escalation?.reason,
      "The assistant could not tell what the email asks.",
    );
    assert.equal(unclear.intake?.reply, null);

    testReplyDrafter.result = new ReplyDraftError("The AI service is busy");
    const failed = await deliver("efua@akwaaba.example", "inquiry");
    assert.equal(
      failed.intake?.escalation?.reason,
      "No reply could be drafted.",
    );

    // A person adds what was missing and drafts again: answered now, so no longer escalated, and still not sent by itself.
    testReplyDrafter.result = {
      subject: "Re: Reefer",
      body: "Yes, we handle reefer containers.",
      answered: true,
      missing: null,
      sources: [],
    };
    const redrafted = await send(
      "POST",
      `/api/v1/quote-requests/${unsure.id}/reply/draft`,
      TEST_UNASSIGNED_TOKEN,
    );
    assert.equal(redrafted.status, 201, await redrafted.clone().text());
    const after = await json<Request>(redrafted);
    assert.equal(after.intake?.escalation, null);
    assert.equal(after.intake?.reply?.sentAt, null);
  } finally {
    delete process.env.ASSISTANT_AUTO_REPLY;
  }
});

test("an email in the wrong mailbox is flagged, not acted on, until a person moves it", async () => {
  const misfiled = await deliver(
    "yaw@wrongbox.example",
    "quote",
    {},
    "Wrongbox Synthetic Ltd",
    "inquiries",
  );
  assert.equal(misfiled.mailbox, "inquiries");
  assert.equal(misfiled.customerCompanyId, null);
  assert.equal(misfiled.quoteId, null);
  assert.equal(misfiled.intake?.reply, null);
  assert.ok(
    misfiled.intake!.assistantNotes.some((note) =>
      note.startsWith("This looks like a quote request"),
    ),
  );

  const question = await deliver(
    "efua@akwaaba.example",
    "inquiry",
    {},
    "Kpone Synthetic Hardware",
    "quotes",
  );
  assert.equal(question.intake?.reply, null);
  assert.ok(
    question.intake!.assistantNotes.some((note) =>
      note.startsWith("This looks like a question"),
    ),
  );

  const path = `/api/v1/quote-requests/${misfiled.id}/mailbox`;
  assert.equal(
    (await send("PATCH", path, TEST_CUSTOMER_A_TOKEN, { mailbox: "quotes" }))
      .status,
    403,
  );
  assert.equal(
    (
      await send("PATCH", path, TEST_SUPER_ADMIN_TOKEN, {
        mailbox: "elsewhere",
      })
    ).status,
    400,
  );
  const moved = await send("PATCH", path, TEST_UNASSIGNED_TOKEN, {
    mailbox: "quotes",
  });
  assert.equal(moved.status, 200, await moved.clone().text());
  const after = await json<Request>(moved);
  assert.equal(after.mailbox, "quotes");
  assert.equal(after.intake?.kind, "quote");
  assert.ok(
    after.customerCompanyId,
    "the assistant carried on as for a quote request",
  );
  assert.equal(after.quoteStatus, "draft");
  assert.ok(after.intake?.reply);

  // Once a quote is prepared it stays where it is.
  assert.equal(
    (
      await send("PATCH", path, TEST_SUPER_ADMIN_TOKEN, {
        mailbox: "inquiries",
      })
    ).status,
    409,
  );
});
