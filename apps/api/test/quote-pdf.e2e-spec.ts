import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { after, before, test } from "node:test";
import {
  TEST_CUSTOMER_A_ID,
  TEST_CUSTOMER_A_TOKEN,
  TEST_CUSTOMER_B_TOKEN,
  TEST_UNASSIGNED_TOKEN,
  TEST_CUSTOMER_B_ID,
  TEST_MATCHING_TOKEN,
  TEST_MATCHING_USER_ID,
  TEST_SUPER_ADMIN_ID,
  TEST_SUPER_ADMIN_TOKEN,
  TEST_UNASSIGNED_USER_ID,
  createTestApplication,
} from "./test-application";
import { DatabasePort } from "../src/database/database.port";
import { beginTestDatabase, endTestDatabase } from "./postgres-test-database";

let application: INestApplication;
let baseUrl: string;
let companyA: string;
let companyB: string;

function call(path: string, token: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  if (init.body) headers.set("content-type", "application/json");
  return fetch(`${baseUrl}${path}`, { ...init, headers });
}

function post(path: string, token: string, body: unknown) {
  return call(path, token, { method: "POST", body: JSON.stringify(body) });
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
  await database.assignStaffRole(
    TEST_UNASSIGNED_USER_ID,
    "export_rep",
    TEST_SUPER_ADMIN_ID,
  );
  companyA = randomUUID();
  companyB = randomUUID();
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

const content = (currency = "GHS") => ({
  currency,
  title: "Synthetic clearance quotation",
  procedureSteps: [],
  requiredDocuments: [],
  terms: [],
  sizeLabels: ["20ft", "50ft"],
  lines: [
    {
      description: "BJH service fee",
      basis: "per_container",
      sizeAmountsMinor: [150000, 240000],
    },
  ],
});

async function newQuote(token: string, customerCompanyId: string) {
  return (await (
    await post("/api/v1/quotes", token, {
      customerCompanyId,
      serviceLine: "sea_import",
      version: content("USD"),
    })
  ).json()) as { id: string };
}

const pdf = (quoteId: string, token: string, query = "") =>
  call(`/api/v1/quotes/${quoteId}/pdf${query}`, token);

let quoteId: string;
let draftOnlyId: string;

test("a rep downloads a draft quote as a PDF", async () => {
  quoteId = (await newQuote(TEST_MATCHING_TOKEN, companyA)).id;
  const response = await pdf(quoteId, TEST_MATCHING_TOKEN);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/pdf");
  assert.match(
    String(response.headers.get("content-disposition")),
    /^inline; filename="quote-draft-v1\.pdf"$/,
  );
  const file = Buffer.from(await response.arrayBuffer());
  assert.equal(file.subarray(0, 5).toString(), "%PDF-");
  assert.ok(file.subarray(-16).toString().includes("%%EOF"));
});

test("an issued quote's PDF is named after its quote number", async () => {
  await post(`/api/v1/quotes/${quoteId}/issue`, TEST_MATCHING_TOKEN, {});
  const response = await pdf(quoteId, TEST_SUPER_ADMIN_TOKEN);
  assert.equal(response.status, 200);
  assert.match(
    String(response.headers.get("content-disposition")),
    new RegExp(
      `filename="BJH-Q-SI-${new Date().getUTCFullYear()}-0001-v1\\.pdf"`,
    ),
  );
});

test("customers only reach PDFs of issued versions of their own quotes", async () => {
  draftOnlyId = (await newQuote(TEST_MATCHING_TOKEN, companyA)).id;
  assert.equal((await pdf(draftOnlyId, TEST_CUSTOMER_A_TOKEN)).status, 404);

  assert.equal((await pdf(quoteId, TEST_CUSTOMER_A_TOKEN)).status, 200);
  await post(`/api/v1/quotes/${quoteId}/versions`, TEST_MATCHING_TOKEN, {});
  // Version 2 is a draft: hidden from the customer, visible to staff.
  assert.equal(
    (await pdf(quoteId, TEST_CUSTOMER_A_TOKEN, "?version=2")).status,
    404,
  );
  assert.equal(
    (await pdf(quoteId, TEST_MATCHING_TOKEN, "?version=2")).status,
    200,
  );
  const latestForCustomer = await pdf(quoteId, TEST_CUSTOMER_A_TOKEN);
  assert.match(
    String(latestForCustomer.headers.get("content-disposition")),
    /-v1\.pdf"$/,
  );
  const latestForStaff = await pdf(quoteId, TEST_MATCHING_TOKEN);
  assert.match(
    String(latestForStaff.headers.get("content-disposition")),
    /-v2\.pdf"$/,
  );
});

test("access boundaries and bad requests", async () => {
  assert.equal((await pdf(quoteId, TEST_CUSTOMER_B_TOKEN)).status, 404);
  assert.equal((await pdf(quoteId, TEST_UNASSIGNED_TOKEN)).status, 404);
  assert.equal(
    (await fetch(`${baseUrl}/api/v1/quotes/${quoteId}/pdf`)).status,
    401,
  );
  assert.equal(
    (await pdf(quoteId, TEST_MATCHING_TOKEN, "?version=abc")).status,
    400,
  );
  assert.equal(
    (await pdf(quoteId, TEST_MATCHING_TOKEN, "?version=1.5")).status,
    400,
  );
  assert.equal(
    (await pdf(quoteId, TEST_MATCHING_TOKEN, "?version=9")).status,
    404,
  );
  assert.equal((await pdf(randomUUID(), TEST_SUPER_ADMIN_TOKEN)).status, 404);
});
