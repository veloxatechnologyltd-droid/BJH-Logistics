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
  TEST_UNASSIGNED_TOKEN,
  TEST_UNASSIGNED_USER_ID,
  createTestApplication,
} from "./test-application";
import { DatabasePort } from "../src/database/database.port";
import { beginTestDatabase, endTestDatabase } from "./postgres-test-database";

let application: INestApplication;
let baseUrl: string;
let companyA: string;
let companyB: string;
const year = new Date().getUTCFullYear();

async function createCompany(companyName: string): Promise<string> {
  const id = randomUUID();
  await application.get(DatabasePort).createCustomer({
    id,
    companyName,
    createdAt: new Date().toISOString(),
    contacts: [],
  });
  return id;
}

function call(path: string, token: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  if (init.body) headers.set("content-type", "application/json");
  return fetch(`${baseUrl}${path}`, { ...init, headers });
}

function openJob(token: string, body: unknown) {
  return call("/api/v1/jobs", token, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

before(async () => {
  await beginTestDatabase();
  const started = await createTestApplication();
  application = started.application;
  baseUrl = started.baseUrl;
  const database = application.get(DatabasePort);
  await database.assignStaffRole(
    TEST_MATCHING_USER_ID,
    "air_import_rep",
    TEST_SUPER_ADMIN_ID,
  );
  await database.assignStaffRole(
    TEST_UNASSIGNED_USER_ID,
    "air_export_rep",
    TEST_SUPER_ADMIN_ID,
  );
  companyA = await createCompany("Northstar Synthetic Ltd");
  companyB = await createCompany("Southwind Synthetic Ltd");
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

let airImportJobId: string;
let seaImportJobId: string;

test("a rep opens a direct job for their own service line and gets a file number", async () => {
  const response = await openJob(TEST_MATCHING_TOKEN, {
    customerCompanyId: companyA,
    serviceLine: "air_import",
  });
  assert.equal(response.status, 201);
  const job = (await response.json()) as Record<string, unknown>;
  assert.equal(job.fileNumber, `BJH/AI/${year}/0001`);
  assert.equal(job.status, "open");
  assert.equal(job.customerCompanyName, "Northstar Synthetic Ltd");
  assert.equal(job.openedBy, TEST_MATCHING_USER_ID);
  airImportJobId = String(job.id);
});

test("a rep cannot open a job for another service line, and customers cannot open jobs", async () => {
  const otherLine = await openJob(TEST_MATCHING_TOKEN, {
    customerCompanyId: companyA,
    serviceLine: "sea_import",
  });
  assert.equal(otherLine.status, 403);
  const customer = await openJob(TEST_CUSTOMER_A_TOKEN, {
    customerCompanyId: companyA,
    serviceLine: "air_import",
  });
  assert.equal(customer.status, 403);
  const anonymous = await fetch(`${baseUrl}/api/v1/jobs`, { method: "POST" });
  assert.equal(anonymous.status, 401);
});

test("the super admin opens jobs on any line and numbers increment per line", async () => {
  const first = await openJob(TEST_SUPER_ADMIN_TOKEN, {
    customerCompanyId: companyB,
    serviceLine: "sea_import",
  });
  assert.equal(first.status, 201);
  const firstJob = (await first.json()) as { id: string; fileNumber: string };
  assert.equal(firstJob.fileNumber, `BJH/SI/${year}/0001`);
  seaImportJobId = firstJob.id;
  const second = await openJob(TEST_SUPER_ADMIN_TOKEN, {
    customerCompanyId: companyB,
    serviceLine: "sea_import",
  });
  assert.equal(
    ((await second.json()) as { fileNumber: string }).fileNumber,
    `BJH/SI/${year}/0002`,
  );
});

test("invalid job requests fail safely", async () => {
  const cases: Array<[unknown, number, string]> = [
    [null, 400, "Malformed request body"],
    [[], 400, "A job object is required"],
    [{ serviceLine: "sea_import" }, 400, "customerCompanyId is required"],
    [
      { customerCompanyId: "not-a-uuid", serviceLine: "sea_import" },
      400,
      "customerCompanyId must be a valid ID",
    ],
    [
      { customerCompanyId: companyA, serviceLine: "road" },
      400,
      "serviceLine must be sea_import, sea_export, air_import, air_export, warehousing or road_transport",
    ],
    [
      { customerCompanyId: randomUUID(), serviceLine: "sea_import" },
      404,
      "Customer company was not found",
    ],
    [
      {
        customerCompanyId: companyA,
        serviceLine: "sea_import",
        quoteRequestId: randomUUID(),
      },
      404,
      "Quote request was not found",
    ],
  ];
  for (const [body, status, message] of cases) {
    const response = await openJob(TEST_SUPER_ADMIN_TOKEN, body);
    assert.equal(response.status, status, message);
    assert.equal(
      ((await response.json()) as { message: string }).message,
      message,
    );
  }
});

test("a job can only link a quote request from the same company", async () => {
  const database = application.get(DatabasePort);
  const requestId = randomUUID();
  await database.createQuoteRequest({
    id: requestId,
    companyName: "Southwind Synthetic Ltd",
    contactName: "Contact",
    email: "southwind@example.test",
    message: "Synthetic request",
    createdAt: new Date().toISOString(),
    source: "staff",
    customerCompanyId: null,
    customerCompanyName: null,
    quoteId: null,
    quoteNumber: null,
    quoteStatus: null,
  });
  await database.linkQuoteRequestToCustomer(requestId, companyB);
  const mismatch = await openJob(TEST_SUPER_ADMIN_TOKEN, {
    customerCompanyId: companyA,
    serviceLine: "sea_export",
    quoteRequestId: requestId,
  });
  assert.equal(mismatch.status, 400);
  const linked = await openJob(TEST_SUPER_ADMIN_TOKEN, {
    customerCompanyId: companyB,
    serviceLine: "sea_export",
    quoteRequestId: requestId,
  });
  assert.equal(linked.status, 201);
  assert.equal(
    ((await linked.json()) as { quoteRequestId: string }).quoteRequestId,
    requestId,
  );
});

async function listNumbers(token: string, query = ""): Promise<string[]> {
  const response = await call(`/api/v1/jobs${query}`, token);
  assert.equal(response.status, 200);
  return ((await response.json()) as Array<{ fileNumber: string }>)
    .map((job) => job.fileNumber)
    .sort();
}

test("job lists are scoped by role and company", async () => {
  assert.equal((await listNumbers(TEST_SUPER_ADMIN_TOKEN)).length, 4);
  assert.deepEqual(await listNumbers(TEST_MATCHING_TOKEN), [
    `BJH/AI/${year}/0001`,
  ]);
  assert.deepEqual(await listNumbers(TEST_UNASSIGNED_TOKEN), []);
  assert.deepEqual(await listNumbers(TEST_CUSTOMER_A_TOKEN), [
    `BJH/AI/${year}/0001`,
  ]);
  assert.equal((await listNumbers(TEST_CUSTOMER_B_TOKEN)).length, 3);
});

test("search matches file number and company, within the caller's scope", async () => {
  assert.deepEqual(await listNumbers(TEST_SUPER_ADMIN_TOKEN, "?search=ai%2F"), [
    `BJH/AI/${year}/0001`,
  ]);
  assert.equal(
    (await listNumbers(TEST_SUPER_ADMIN_TOKEN, "?search=southwind")).length,
    3,
  );
  assert.deepEqual(
    await listNumbers(TEST_CUSTOMER_A_TOKEN, "?search=southwind"),
    [],
  );
  const tooLong = await call(
    `/api/v1/jobs?search=${"x".repeat(201)}`,
    TEST_SUPER_ADMIN_TOKEN,
  );
  assert.equal(tooLong.status, 400);
});

test("job detail denies other companies and other departments, including guessed IDs", async () => {
  const own = await call(
    `/api/v1/jobs/${airImportJobId}`,
    TEST_CUSTOMER_A_TOKEN,
  );
  assert.equal(own.status, 200);
  const crossCompany = await call(
    `/api/v1/jobs/${seaImportJobId}`,
    TEST_CUSTOMER_A_TOKEN,
  );
  assert.equal(crossCompany.status, 404);
  const wrongCompanyForAirJob = await call(
    `/api/v1/jobs/${airImportJobId}`,
    TEST_CUSTOMER_B_TOKEN,
  );
  assert.equal(wrongCompanyForAirJob.status, 404);
  const wrongDepartment = await call(
    `/api/v1/jobs/${airImportJobId}`,
    TEST_UNASSIGNED_TOKEN,
  );
  assert.equal(wrongDepartment.status, 404);
  const rightDepartment = await call(
    `/api/v1/jobs/${airImportJobId}`,
    TEST_MATCHING_TOKEN,
  );
  assert.equal(rightDepartment.status, 200);
  const notAnId = await call("/api/v1/jobs/not-a-uuid", TEST_SUPER_ADMIN_TOKEN);
  assert.equal(notAnId.status, 404);
  const unknown = await call(
    `/api/v1/jobs/${randomUUID()}`,
    TEST_SUPER_ADMIN_TOKEN,
  );
  assert.equal(unknown.status, 404);
});
