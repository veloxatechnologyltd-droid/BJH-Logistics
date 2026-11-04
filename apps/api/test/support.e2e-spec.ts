import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { after, before, test } from "node:test";
import {
  TEST_CUSTOMER_A_ID,
  TEST_CUSTOMER_A_TOKEN,
  TEST_CUSTOMER_B_TOKEN,
  TEST_SUPER_ADMIN_ID,
  TEST_SUPER_ADMIN_TOKEN,
  TEST_UNASSIGNED_TOKEN,
  TEST_UNASSIGNED_USER_ID,
  createTestApplication,
} from "./test-application";
import { DatabasePort } from "../src/database/database.port";
import { EMAIL_PROVIDER } from "../src/notifications/providers";
import type { RecordingEmailProvider } from "../src/notifications/providers";
import { beginTestDatabase, endTestDatabase } from "./postgres-test-database";

const STAFF = TEST_UNASSIGNED_TOKEN;
const CUSTOMER = TEST_CUSTOMER_A_TOKEN;
const ADMIN = TEST_SUPER_ADMIN_TOKEN;

let application: INestApplication;
let baseUrl: string;
let email: RecordingEmailProvider;

type Message = {
  id: string;
  authorRole: string;
  authorName: string | null;
  body: string;
};

type Support = {
  id: string;
  reporterEmail: string | null;
  reporterKind: string;
  messages: Message[];
  reporterName: string | null;
  companyName: string | null;
  kind: string;
  description: string;
  pagePath: string | null;
  lastError: string | null;
  status: string;
};

function call(path: string, token: string | null, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (token) headers.set("authorization", `Bearer ${token}`);
  if (init.body) headers.set("content-type", "application/json");
  return fetch(`${baseUrl}/api/v1/support${path}`, { ...init, headers });
}
const send = (token: string | null, body: unknown) =>
  call("", token, { method: "POST", body: JSON.stringify(body) });
const settle = () => new Promise((resolve) => setTimeout(resolve, 150));

before(async () => {
  process.env.SUPPORT_EMAIL_TO = "developer@example.test";
  await beginTestDatabase();
  const started = await createTestApplication();
  application = started.application;
  baseUrl = started.baseUrl;
  email = application.get(EMAIL_PROVIDER);
  const database = application.get(DatabasePort);
  await database.assignStaffRole(
    TEST_UNASSIGNED_USER_ID,
    "customer_service_rep",
    TEST_SUPER_ADMIN_ID,
  );
  const companyId = randomUUID();
  await database.createCustomer({
    id: companyId,
    companyName: "Support Synthetic Ltd",
    createdAt: new Date().toISOString(),
    contacts: [],
  });
  await database.grantCustomerMembership(
    companyId,
    TEST_CUSTOMER_A_ID,
    TEST_SUPER_ADMIN_ID,
  );
});

after(async () => {
  delete process.env.SUPPORT_EMAIL_TO;
  await application?.close();
  await endTestDatabase();
});

test("a customer reports a problem; it is saved with their company and emailed to the developer", async () => {
  email.sent.length = 0;
  const response = await send(CUSTOMER, {
    kind: "problem",
    description: "  The invoice page shows nothing.  ",
    pagePath: "/invoices",
    userAgent: "Synthetic Browser",
    lastError: "Something went wrong on our side.",
  });
  assert.equal(response.status, 201, await response.clone().text());
  const saved = (await response.json()) as Support;
  assert.equal(saved.reporterKind, "customer");
  assert.equal(saved.companyName, "Support Synthetic Ltd");
  assert.equal(saved.description, "The invoice page shows nothing.");
  assert.equal(saved.status, "new");
  await settle();
  assert.equal(email.sent.length, 1);
  assert.equal(email.sent[0].to, "developer@example.test");
  assert.match(email.sent[0].subject, /^\[BJH support\] Problem from /);
  assert.match(email.sent[0].text, /Page: \/invoices/);
  assert.match(email.sent[0].text, /Support Synthetic Ltd/);
  assert.match(email.sent[0].text, /The invoice page shows nothing\./);
});

test("staff send a feature request; it is marked as staff with no company", async () => {
  const response = await send(STAFF, {
    kind: "feature",
    description: "Export jobs to Excel",
  });
  assert.equal(response.status, 201);
  const saved = (await response.json()) as Support;
  assert.equal(saved.reporterKind, "staff");
  assert.equal(saved.companyName, null);
  assert.equal(saved.pagePath, null);
});

test("bad input and anonymous callers are refused", async () => {
  assert.equal(
    (await send(null, { kind: "problem", description: "x" })).status,
    401,
  );
  assert.equal(
    (await send(STAFF, { kind: "bug", description: "x" })).status,
    400,
  );
  assert.equal(
    (await send(STAFF, { kind: "problem", description: "   " })).status,
    400,
  );
  assert.equal(
    (await send(STAFF, { kind: "problem", description: "x".repeat(4001) }))
      .status,
    400,
  );
  // An account with neither a staff role nor a company is refused.
  assert.equal(
    (await send(TEST_CUSTOMER_B_TOKEN, { kind: "question", description: "Hi" }))
      .status,
    403,
  );
});

test("each person sees only their own requests; the super admin sees all", async () => {
  const mine = (await (await call("/mine", CUSTOMER)).json()) as Support[];
  assert.ok(mine.length >= 1);
  assert.ok(mine.every((item) => item.reporterKind === "customer"));
  const staffMine = (await (await call("/mine", STAFF)).json()) as Support[];
  assert.ok(staffMine.every((item) => item.reporterKind === "staff"));

  assert.equal((await call("", CUSTOMER)).status, 403);
  assert.equal((await call("", STAFF)).status, 403);
  const all = (await (await call("", ADMIN)).json()) as Support[];
  assert.ok(all.some((item) => item.reporterKind === "customer"));
  assert.ok(all.some((item) => item.reporterKind === "staff"));
  assert.ok(
    all.every((item) => item.reporterName && !item.reporterName.includes("@")),
    "reporters are shown by name, not email",
  );
});

test("only the super admin changes a status", async () => {
  const [first] = (await (await call("/mine", CUSTOMER)).json()) as Support[];
  const patch = (token: string, id: string, body: unknown) =>
    call(`/${id}`, token, { method: "PATCH", body: JSON.stringify(body) });

  assert.equal(
    (await patch(CUSTOMER, first.id, { status: "done" })).status,
    403,
  );
  assert.equal((await patch(STAFF, first.id, { status: "done" })).status, 403);
  assert.equal(
    (await patch(ADMIN, first.id, { status: "closed" })).status,
    400,
  );
  assert.equal(
    (await patch(ADMIN, randomUUID(), { status: "done" })).status,
    404,
  );
  assert.equal(
    (await patch(ADMIN, "not-an-id", { status: "done" })).status,
    404,
  );

  const updated = await patch(ADMIN, first.id, { status: "in_progress" });
  assert.equal(updated.status, 200);
  assert.equal(((await updated.json()) as Support).status, "in_progress");
  const [again] = (await (await call("/mine", CUSTOMER)).json()) as Support[];
  assert.equal(again.status, "in_progress");
});

test("without SUPPORT_EMAIL_TO the request is still saved and nothing is emailed", async () => {
  delete process.env.SUPPORT_EMAIL_TO;
  email.sent.length = 0;
  const response = await send(STAFF, {
    kind: "question",
    description: "How do I add a driver?",
  });
  assert.equal(response.status, 201);
  await settle();
  assert.equal(email.sent.length, 0);
  process.env.SUPPORT_EMAIL_TO = "developer@example.test";
});

const reply = (token: string | null, path: string, body: unknown) =>
  call(path, token, { method: "POST", body: JSON.stringify(body) });

async function newTicket(token: string, description: string) {
  const response = await send(token, { kind: "question", description });
  assert.equal(response.status, 201);
  const saved = (await response.json()) as Support;
  await settle();
  return saved;
}

test("the super admin replies to a ticket; its sender sees the reply and is emailed", async () => {
  const ticket = await newTicket(CUSTOMER, "Where do I find my receipts?");
  assert.deepEqual(ticket.messages, []);
  email.sent.length = 0;

  const response = await reply(ADMIN, `/${ticket.id}/replies`, {
    body: "  Open Payments, then Receipts.  ",
  });
  assert.equal(response.status, 201, await response.clone().text());
  const updated = (await response.json()) as Support;
  assert.equal(updated.status, "in_progress", "a first answer starts the work");
  assert.equal(updated.messages.length, 1);
  assert.equal(updated.messages[0].authorRole, "support");
  assert.equal(updated.messages[0].body, "Open Payments, then Receipts.");
  assert.ok(
    updated.messages[0].authorName &&
      !updated.messages[0].authorName.includes("@"),
    "the answer shows a name, not an email",
  );

  const mine = (await (await call("/mine", CUSTOMER)).json()) as Support[];
  assert.deepEqual(
    mine.find((item) => item.id === ticket.id)?.messages.map((m) => m.body),
    ["Open Payments, then Receipts."],
  );
  const all = (await (await call("", ADMIN)).json()) as Support[];
  assert.equal(all.find((item) => item.id === ticket.id)?.messages.length, 1);

  await settle();
  assert.equal(email.sent.length, 1);
  assert.equal(email.sent[0].to, ticket.reporterEmail);
  assert.match(email.sent[0].subject, /^BJH Logistics support replied/);
  assert.match(email.sent[0].text, /Open Payments, then Receipts\./);
  assert.match(email.sent[0].text, /Where do I find my receipts\?/);

  // A second answer does not change a status the super admin already set.
  await call(`/${ticket.id}`, ADMIN, {
    method: "PATCH",
    body: JSON.stringify({ status: "done" }),
  });
  const again = await reply(ADMIN, `/${ticket.id}/replies`, { body: "Ok?" });
  assert.equal(((await again.json()) as Support).status, "done");
});

test("only the super admin answers from the admin route, and only real tickets", async () => {
  const ticket = await newTicket(STAFF, "Can I print the job list?");
  const path = `/${ticket.id}/replies`;
  assert.equal((await reply(null, path, { body: "Yes" })).status, 401);
  assert.equal((await reply(CUSTOMER, path, { body: "Yes" })).status, 403);
  assert.equal((await reply(STAFF, path, { body: "Yes" })).status, 403);
  assert.equal((await reply(ADMIN, path, { body: "   " })).status, 400);
  assert.equal(
    (await reply(ADMIN, path, { body: "x".repeat(4001) })).status,
    400,
  );
  assert.equal(
    (await reply(ADMIN, `/${randomUUID()}/replies`, { body: "Yes" })).status,
    404,
  );
  assert.equal(
    (await reply(ADMIN, "/not-an-id/replies", { body: "Yes" })).status,
    404,
  );
  const [unchanged] = (
    (await (await call("/mine", STAFF)).json()) as Support[]
  ).filter((item) => item.id === ticket.id);
  assert.equal(unchanged.messages.length, 0);
  assert.equal(unchanged.status, "new");
});

test("the sender writes back on their own ticket, never on someone else's", async () => {
  const ticket = await newTicket(CUSTOMER, "The quote PDF is blank.");
  await reply(ADMIN, `/${ticket.id}/replies`, { body: "Which quote?" });
  email.sent.length = 0;

  const path = `/mine/${ticket.id}/replies`;
  const response = await reply(CUSTOMER, path, { body: "QUO-0004" });
  assert.equal(response.status, 201, await response.clone().text());
  const updated = (await response.json()) as Support;
  assert.deepEqual(
    updated.messages.map((m) => [m.authorRole, m.body]),
    [
      ["support", "Which quote?"],
      ["reporter", "QUO-0004"],
    ],
  );
  await settle();
  assert.equal(email.sent.length, 1);
  assert.equal(email.sent[0].to, "developer@example.test");
  assert.match(email.sent[0].subject, /^\[BJH support\] Reply from /);
  assert.match(email.sent[0].text, /QUO-0004/);

  // Another person, even staff, gets "not found", not "forbidden".
  assert.equal((await reply(STAFF, path, { body: "Hi" })).status, 404);
  assert.equal(
    (await reply(TEST_CUSTOMER_B_TOKEN, path, { body: "Hi" })).status,
    403,
  );
  // The super admin answers through the admin route, not as the sender.
  assert.equal((await reply(ADMIN, path, { body: "Hi" })).status, 404);
  assert.equal((await reply(null, path, { body: "Hi" })).status, 401);
  assert.equal((await reply(CUSTOMER, path, { body: " " })).status, 400);
  assert.equal(
    (await reply(CUSTOMER, `/mine/${randomUUID()}/replies`, { body: "Hi" }))
      .status,
    404,
  );
  assert.equal(
    (await reply(CUSTOMER, "/mine/not-an-id/replies", { body: "Hi" })).status,
    404,
  );
  const all = (await (await call("", ADMIN)).json()) as Support[];
  assert.equal(all.find((item) => item.id === ticket.id)?.messages.length, 2);
});

test("writing again on a finished ticket reopens it", async () => {
  const ticket = await newTicket(STAFF, "How do I add a driver?");
  await call(`/${ticket.id}`, ADMIN, {
    method: "PATCH",
    body: JSON.stringify({ status: "done" }),
  });
  const response = await reply(STAFF, `/mine/${ticket.id}/replies`, {
    body: "That did not work.",
  });
  assert.equal(((await response.json()) as Support).status, "new");
});

test("a reply is saved even when no developer address is set", async () => {
  const ticket = await newTicket(STAFF, "Is there a dark mode?");
  delete process.env.SUPPORT_EMAIL_TO;
  email.sent.length = 0;
  const response = await reply(STAFF, `/mine/${ticket.id}/replies`, {
    body: "Just asking.",
  });
  process.env.SUPPORT_EMAIL_TO = "developer@example.test";
  assert.equal(response.status, 201);
  await settle();
  assert.equal(email.sent.length, 0);
  const [saved] = (
    (await (await call("/mine", STAFF)).json()) as Support[]
  ).filter((item) => item.id === ticket.id);
  assert.equal(saved.messages.length, 1);
});
