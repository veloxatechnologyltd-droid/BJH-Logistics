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

type Support = {
  id: string;
  reporterKind: string;
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
