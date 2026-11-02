import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { after, before, test } from "node:test";
import {
  TEST_CUSTOMER_A_ID,
  TEST_CUSTOMER_A_TOKEN,
  TEST_CUSTOMER_B_ID,
  TEST_CUSTOMER_B_TOKEN,
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
let companyA: string;

function call(path: string, token: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  if (init.body && typeof init.body === "string") {
    headers.set("content-type", "application/json");
  }
  return fetch(`${baseUrl}${path}`, { ...init, headers });
}
const post = (path: string, token: string, body: unknown = {}) =>
  call(path, token, { method: "POST", body: JSON.stringify(body) });
const json = async <T>(response: Response) => (await response.json()) as T;
const message = async (response: Response) =>
  ((await response.json()) as { message: string }).message;

type Result = {
  decision: {
    decision: string;
    clientSignatory: string;
    decidedAt: string;
    recordedBy: string;
    versionNumber: number;
  };
  job: { id: string; openedBy: string; quoteId: string } | null;
};

async function issuedQuote(title: string, issue = true) {
  const created = await json<{ id: string }>(
    await post("/api/v1/quotes", TEST_MATCHING_TOKEN, {
      customerCompanyId: companyA,
      serviceLine: "sea_import",
      version: {
        currency: "GHS",
        title,
        procedureSteps: [],
        requiredDocuments: [],
        terms: [],
        lines: [{ description: "Fee", basis: "fixed", amountMinor: 1000 }],
      },
    }),
  );
  if (issue)
    await post(`/api/v1/quotes/${created.id}/issue`, TEST_MATCHING_TOKEN);
  return created.id;
}

before(async () => {
  await beginTestDatabase();
  const started = await createTestApplication();
  application = started.application;
  baseUrl = started.baseUrl;
  const database = application.get(DatabasePort);
  await database.assignStaffRole(
    TEST_MATCHING_USER_ID,
    "customer_service_rep",
    TEST_SUPER_ADMIN_ID,
  );
  companyA = randomUUID();
  const companyB = randomUUID();
  for (const [id, name] of [
    [companyA, "Northstar Synthetic Ltd"],
    [companyB, "Southwind Synthetic Ltd"],
  ]) {
    await database.createCustomer({
      id,
      companyName: name,
      createdAt: new Date().toISOString(),
      contacts: [],
    });
  }
  await database.grantCustomerMembership(
    companyA,
    TEST_CUSTOMER_A_ID,
    TEST_SUPER_ADMIN_ID,
  );
  await database.grantCustomerMembership(
    companyB,
    TEST_CUSTOMER_B_ID,
    TEST_SUPER_ADMIN_ID,
  );
});

after(async () => {
  await application?.close();
  await endTestDatabase();
});

test("a customer accepts their own company's issued quote and the job opens", async () => {
  const quote = await issuedQuote("Clearance A");
  const path = `/api/v1/quotes/${quote}/respond`;
  const body = {
    versionNumber: 1,
    decision: "accepted",
    clientSignatory: "  Ama Mensah  ",
  };

  // Another company cannot see the quote at all.
  assert.equal((await post(path, TEST_CUSTOMER_B_TOKEN, body)).status, 404);
  const bad = await post(path, TEST_CUSTOMER_A_TOKEN, {
    versionNumber: 1,
    decision: "maybe",
    clientSignatory: "x",
  });
  assert.equal(bad.status, 400);
  assert.equal(await message(bad), "decision must be accepted or rejected");

  const accepted = await post(path, TEST_CUSTOMER_A_TOKEN, {
    ...body,
    decidedAt: "2020-01-01T00:00:00Z",
  });
  assert.equal(accepted.status, 201);
  const result = await json<Result>(accepted);
  assert.equal(result.decision.decision, "accepted");
  assert.equal(result.decision.clientSignatory, "Ama Mensah");
  assert.equal(result.decision.recordedBy, TEST_CUSTOMER_A_ID);
  // The customer cannot backdate the decision.
  assert.ok(
    Math.abs(Date.parse(result.decision.decidedAt) - Date.now()) < 60_000,
  );
  assert.ok(result.job);
  assert.equal(result.job.quoteId, quote);
  assert.equal(result.job.openedBy, TEST_CUSTOMER_A_ID);

  // Repeating it returns the same decision and job; the accepted quote takes no new version.
  const again = await json<Result>(
    await post(path, TEST_CUSTOMER_A_TOKEN, body),
  );
  assert.equal(again.job!.id, result.job.id);
  assert.equal(
    (await post(`/api/v1/quotes/${quote}/versions`, TEST_MATCHING_TOKEN))
      .status,
    409,
  );
  const contrary = await post(path, TEST_CUSTOMER_A_TOKEN, {
    ...body,
    decision: "rejected",
  });
  assert.equal(contrary.status, 409);
});

test("a customer can decline, and staff can still see and revise the quote", async () => {
  const quote = await issuedQuote("Clearance B");
  const declined = await post(
    `/api/v1/quotes/${quote}/respond`,
    TEST_CUSTOMER_A_TOKEN,
    {
      versionNumber: 1,
      decision: "rejected",
      clientSignatory: "Ama Mensah",
      note: "Price too high",
    },
  );
  assert.equal(declined.status, 201);
  const result = await json<Result>(declined);
  assert.equal(result.decision.decision, "rejected");
  assert.equal(result.job, null);
  assert.equal(
    (await post(`/api/v1/quotes/${quote}/versions`, TEST_MATCHING_TOKEN))
      .status,
    201,
  );
});

test("only issued quotes can be answered, and staff use the decision endpoint instead", async () => {
  const draft = await issuedQuote("Clearance C", false);
  const notIssued = await post(
    `/api/v1/quotes/${draft}/respond`,
    TEST_CUSTOMER_A_TOKEN,
    {
      versionNumber: 1,
      decision: "accepted",
      clientSignatory: "Ama Mensah",
    },
  );
  // A customer cannot even see a draft.
  assert.equal(notIssued.status, 404);

  const quote = await issuedQuote("Clearance D");
  for (const token of [TEST_MATCHING_TOKEN, TEST_SUPER_ADMIN_TOKEN]) {
    const staff = await post(`/api/v1/quotes/${quote}/respond`, token, {
      versionNumber: 1,
      decision: "accepted",
      clientSignatory: "Ama Mensah",
    });
    assert.equal(staff.status, 403);
    assert.equal(
      await message(staff),
      "Staff record a client's decision on the quote's decision endpoint",
    );
  }
  const wrongVersion = await post(
    `/api/v1/quotes/${quote}/respond`,
    TEST_CUSTOMER_A_TOKEN,
    {
      versionNumber: 7,
      decision: "accepted",
      clientSignatory: "Ama Mensah",
    },
  );
  assert.equal(wrongVersion.status, 404);
  assert.equal(
    (
      await post(
        `/api/v1/quotes/${randomUUID()}/respond`,
        TEST_CUSTOMER_A_TOKEN,
        {},
      )
    ).status,
    404,
  );
});
