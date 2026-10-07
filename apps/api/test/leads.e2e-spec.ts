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
  createTestApplication,
} from "./test-application";
import { DatabasePort } from "../src/database/database.port";
import { beginTestDatabase, endTestDatabase } from "./postgres-test-database";

let application: INestApplication;
let baseUrl: string;
const company = randomUUID();

function call(path: string, token: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  if (init.body && typeof init.body === "string") {
    headers.set("content-type", "application/json");
  }
  return fetch(`${baseUrl}${path}`, { ...init, headers });
}
const send = (
  method: string,
  path: string,
  token: string,
  body: unknown = {},
) =>
  call(path, token, {
    method,
    body: method === "GET" ? undefined : JSON.stringify(body),
  });
const json = async <T>(response: Response) => (await response.json()) as T;

type Lead = {
  id: string;
  companyName: string;
  stage: string;
  ownerId: string | null;
  ownerEmail: string | null;
  nextFollowUp: string | null;
  lostReason: string | null;
  customerCompanyId: string | null;
  customerCompanyName: string | null;
  followUpOverdue: boolean;
};

const create = (body: unknown, token = TEST_SUPER_ADMIN_TOKEN) =>
  send("POST", "/api/v1/leads", token, body);
const update = (id: string, body: unknown, token = TEST_SUPER_ADMIN_TOKEN) =>
  send("PATCH", `/api/v1/leads/${id}`, token, body);

before(async () => {
  await beginTestDatabase();
  const started = await createTestApplication();
  application = started.application;
  baseUrl = started.baseUrl;
  const database = application.get(DatabasePort);
  await database.assignStaffRole(
    TEST_MATCHING_USER_ID,
    "sea_import_rep",
    TEST_SUPER_ADMIN_ID,
  );
  await database.createCustomer({
    id: company,
    companyName: "Won Synthetic Ltd",
    createdAt: new Date().toISOString(),
    contacts: [],
  });
});

after(async () => {
  await application?.close();
  await endTestDatabase();
});

test("a lead starts new, owned by whoever added it, and is listed", async () => {
  const response = await create({
    companyName: "  Prospect Synthetic Ltd ",
    contactName: "Pat Prospect",
    email: "pat@prospect.test",
    source: "referral",
    nextFollowUp: "2999-01-01",
  });
  assert.equal(response.status, 201, await response.clone().text());
  const lead = await json<Lead>(response);
  assert.equal(lead.companyName, "Prospect Synthetic Ltd");
  assert.equal(lead.stage, "new");
  assert.equal(lead.ownerId, TEST_SUPER_ADMIN_ID);
  assert.ok(lead.ownerEmail);
  assert.equal(lead.followUpOverdue, false);

  const list = await json<Lead[]>(
    await call("/api/v1/leads", TEST_MATCHING_TOKEN),
  );
  assert.ok(list.some((row) => row.id === lead.id));
});

test("a bad lead is refused with a clear message", async () => {
  assert.equal((await create({})).status, 400);
  assert.equal(
    (await create({ companyName: "X Ltd", email: "not-an-email" })).status,
    400,
  );
  assert.equal(
    (await create({ companyName: "X Ltd", nextFollowUp: "tomorrow" })).status,
    400,
  );
});

test("a lead moves through the stages; lost needs a reason and won needs a customer", async () => {
  const lead = await json<Lead>(await create({ companyName: "Flow Ltd" }));
  const contacted = await json<Lead>(
    await update(lead.id, { stage: "contacted" }, TEST_MATCHING_TOKEN),
  );
  assert.equal(contacted.stage, "contacted");

  assert.equal((await update(lead.id, { stage: "lost" })).status, 400);
  const lost = await json<Lead>(
    await update(lead.id, {
      stage: "lost",
      lostReason: "Chose another forwarder",
    }),
  );
  assert.equal(lost.lostReason, "Chose another forwarder");

  // Reopening clears the reason.
  const reopened = await json<Lead>(await update(lead.id, { stage: "new" }));
  assert.equal(reopened.lostReason, null);
  assert.equal(
    (await update(lead.id, { stage: "new", lostReason: "no" })).status,
    400,
  );

  assert.equal((await update(lead.id, { stage: "won" })).status, 400);
  assert.equal(
    (
      await update(lead.id, {
        stage: "won",
        customerCompanyId: randomUUID(),
      })
    ).status,
    400,
  );
  const won = await json<Lead>(
    await update(lead.id, { stage: "won", customerCompanyId: company }),
  );
  assert.equal(won.stage, "won");
  assert.equal(won.customerCompanyName, "Won Synthetic Ltd");
});

test("staff can take and release a lead, and set or clear its follow-up", async () => {
  const lead = await json<Lead>(await create({ companyName: "Owner Ltd" }));
  const taken = await json<Lead>(
    await update(lead.id, { owner: "me" }, TEST_MATCHING_TOKEN),
  );
  assert.equal(taken.ownerId, TEST_MATCHING_USER_ID);
  const released = await json<Lead>(await update(lead.id, { owner: null }));
  assert.equal(released.ownerId, null);

  const dated = await json<Lead>(
    await update(lead.id, { nextFollowUp: "2020-01-01" }),
  );
  assert.equal(dated.nextFollowUp, "2020-01-01");
  assert.equal(dated.followUpOverdue, true);
  const cleared = await json<Lead>(
    await update(lead.id, { nextFollowUp: null }),
  );
  assert.equal(cleared.nextFollowUp, null);
  assert.equal(cleared.followUpOverdue, false);
});

test("a finished lead is never flagged overdue", async () => {
  const lead = await json<Lead>(
    await create({ companyName: "Done Ltd", nextFollowUp: "2020-01-01" }),
  );
  const lost = await json<Lead>(
    await update(lead.id, { stage: "lost", lostReason: "No budget" }),
  );
  assert.equal(lost.followUpOverdue, false);
});

test("a quote request becomes at most one lead", async () => {
  const request = await json<{ id: string }>(
    await send("POST", "/api/v1/quote-requests", TEST_SUPER_ADMIN_TOKEN, {
      companyName: "Requester Ltd",
      contactName: "Rae",
      email: "rae@requester.test",
      message: "Please quote sea freight",
    }),
  );
  const body = {
    companyName: "Requester Ltd",
    source: "quote_request",
    quoteRequestId: request.id,
  };
  assert.equal((await create(body)).status, 201);
  assert.equal((await create(body)).status, 409);
  assert.equal(
    (await create({ ...body, quoteRequestId: randomUUID() })).status,
    400,
  );
});

test("unknown leads are not found; customers and the signed-out are refused", async () => {
  assert.equal((await update(randomUUID(), { stage: "new" })).status, 404);
  assert.equal((await update("nope", { stage: "new" })).status, 404);
  assert.equal((await update(randomUUID(), {})).status, 400);
  for (const [method, path] of [
    ["GET", "/api/v1/leads"],
    ["POST", "/api/v1/leads"],
    ["PATCH", `/api/v1/leads/${randomUUID()}`],
  ] as const) {
    assert.equal(
      (await send(method, path, TEST_CUSTOMER_A_TOKEN, { companyName: "X" }))
        .status,
      403,
    );
    assert.equal(
      (await send(method, path, "bad-token", { companyName: "X" })).status,
      401,
    );
  }
});
