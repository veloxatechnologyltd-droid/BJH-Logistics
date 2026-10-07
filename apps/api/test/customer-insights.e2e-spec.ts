import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { after, before, test } from "node:test";
import {
  TEST_CUSTOMER_A_ID,
  TEST_CUSTOMER_A_TOKEN,
  TEST_MATCHING_TOKEN,
  TEST_MATCHING_USER_ID,
  TEST_SUPER_ADMIN_ID,
  TEST_SUPER_ADMIN_TOKEN,
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
const busyCompany = randomUUID();
const oldCompany = randomUUID();
const quietCompany = randomUUID();

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

type Insight = {
  companyId: string;
  active: boolean;
  totalJobs: number;
  activeJobs: number;
  lastJobAt: string | null;
  lastContactAt: string | null;
  quotesSent: number;
  quotesAccepted: number;
  quotesAwaiting: number;
  money: Array<{
    currency: string;
    invoicedMinor: number;
    receivedMinor: number;
    averageDaysToPay: number | null;
  }>;
};
const insights = async (token = TEST_SUPER_ADMIN_TOKEN) =>
  json<Insight[]>(await call("/api/v1/customers/insights", token));

const quoteContent = () => ({
  currency: "GHS",
  title: "Synthetic quotation",
  procedureSteps: [],
  requiredDocuments: [],
  terms: [],
  sizeLabels: ["20ft"],
  lines: [
    {
      description: "Service fee",
      basis: "per_container",
      sizeAmountsMinor: [150000],
    },
  ],
});

async function issueQuote(companyId: string) {
  const created = await json<{ id: string }>(
    await post("/api/v1/quotes", TEST_SUPER_ADMIN_TOKEN, {
      customerCompanyId: companyId,
      serviceLine: "sea_import",
      version: quoteContent(),
    }),
  );
  await post(`/api/v1/quotes/${created.id}/issue`, TEST_SUPER_ADMIN_TOKEN);
  return created.id;
}

async function issueInvoice(
  jobId: string,
  currency: string,
  amountMinor: number,
) {
  const created = await json<{ id: string }>(
    await post(`/api/v1/jobs/${jobId}/invoices`, TEST_SUPER_ADMIN_TOKEN, {
      currency,
      lines: [{ description: "Fee", amountMinor, taxable: false }],
    }),
  );
  await post(
    `/api/v1/jobs/${jobId}/invoices/${created.id}/issue`,
    TEST_SUPER_ADMIN_TOKEN,
  );
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
    "sea_import_rep",
    TEST_SUPER_ADMIN_ID,
  );
  for (const [id, name] of [
    [busyCompany, "Busy Synthetic Ltd"],
    [oldCompany, "Old Synthetic Ltd"],
    [quietCompany, "Quiet Synthetic Ltd"],
  ] as const) {
    await database.createCustomer({
      id,
      companyName: name,
      createdAt: new Date().toISOString(),
      contacts: [],
    });
  }
  await database.grantCustomerMembership(
    busyCompany,
    TEST_CUSTOMER_A_ID,
    TEST_SUPER_ADMIN_ID,
  );
  await call("/api/v1/settings", TEST_SUPER_ADMIN_TOKEN, {
    method: "PUT",
    body: JSON.stringify({
      issuer: { name: "Synthetic Forwarding Ltd" },
      currencies: ["GHS", "USD"],
      numbering: {
        quotePrefix: "SYN/Q",
        invoicePrefix: "SYN/INV",
        receiptPrefix: "SYN/RCT",
      },
      quoteDefaults: {},
    }),
  });

  // Busy: an open job, GHS 1,000.00 invoiced and paid in full, USD 50.00
  // invoiced and unpaid, one accepted quote and one still awaiting an answer.
  const job = await json<{ id: string }>(
    await post("/api/v1/jobs", TEST_SUPER_ADMIN_TOKEN, {
      customerCompanyId: busyCompany,
      serviceLine: "sea_import",
    }),
  );
  const paid = await issueInvoice(job.id, "GHS", 100000);
  await post(
    `/api/v1/jobs/${job.id}/invoices/${paid}/payments`,
    TEST_SUPER_ADMIN_TOKEN,
    {
      amountMinor: 100000,
      receivedOn: new Date().toISOString().slice(0, 10),
      method: "cash",
    },
  );
  await issueInvoice(job.id, "USD", 5000);
  const accepted = await issueQuote(busyCompany);
  await post(`/api/v1/quotes/${accepted}/decision`, TEST_SUPER_ADMIN_TOKEN, {
    versionNumber: 1,
    decision: "accepted",
    clientSignatory: "A. Client",
  });
  await issueQuote(busyCompany);

  // Old: its only job was opened a year ago and is finished.
  await testPostgresPool.query(
    `INSERT INTO app.job (file_number, service_line, customer_company_id,
                          status, opened_by, opened_at, closed_at)
     VALUES ('BJH/SI/2025/0001', 'sea_import', $1::uuid, 'closed', $2::uuid,
             now() - interval '365 days', now() - interval '360 days')`,
    [oldCompany, TEST_SUPER_ADMIN_ID],
  );
});

after(async () => {
  await application?.close();
  await endTestDatabase();
});

test("a customer with a recent or unfinished job is active; one with only an old finished job, or none, is not", async () => {
  const byId = new Map((await insights()).map((row) => [row.companyId, row]));
  const busy = byId.get(busyCompany)!;
  assert.equal(busy.active, true);
  // The direct job plus the one opened by accepting a quote.
  assert.equal(busy.totalJobs, 2);
  assert.equal(busy.activeJobs, 2);
  assert.ok(busy.lastJobAt);

  const old = byId.get(oldCompany)!;
  assert.equal(old.active, false);
  assert.equal(old.totalJobs, 1);
  assert.equal(old.activeJobs, 0);

  const quiet = byId.get(quietCompany)!;
  assert.equal(quiet.active, false);
  assert.equal(quiet.lastJobAt, null);
  assert.deepEqual(quiet.money, []);
});

test("an old job that is still unfinished keeps the customer active", async () => {
  await testPostgresPool.query(
    `INSERT INTO app.job (file_number, service_line, customer_company_id,
                          opened_by, opened_at)
     VALUES ('BJH/SI/2025/0002', 'sea_import', $1::uuid, $2::uuid,
             now() - interval '200 days')`,
    [quietCompany, TEST_SUPER_ADMIN_ID],
  );
  const row = (await insights()).find((r) => r.companyId === quietCompany)!;
  assert.equal(row.active, true);
  assert.equal(row.activeJobs, 1);
});

test("money stays per currency and counts only issued invoices and standing payments", async () => {
  const busy = (await insights()).find((r) => r.companyId === busyCompany)!;
  const byCurrency = new Map(busy.money.map((row) => [row.currency, row]));
  assert.deepEqual(byCurrency.get("GHS"), {
    currency: "GHS",
    invoicedMinor: 100000,
    receivedMinor: 100000,
    averageDaysToPay: 0,
  });
  // Unpaid invoices have no time-to-pay yet.
  assert.deepEqual(byCurrency.get("USD"), {
    currency: "USD",
    invoicedMinor: 5000,
    receivedMinor: 0,
    averageDaysToPay: null,
  });
});

test("quotes are counted as sent, accepted and awaiting an answer", async () => {
  const busy = (await insights()).find((r) => r.companyId === busyCompany)!;
  assert.equal(busy.quotesSent, 2);
  assert.equal(busy.quotesAccepted, 1);
  assert.equal(busy.quotesAwaiting, 1);
});

test("one company's figures can be read by ID; an unknown company is not found", async () => {
  const one = await json<Insight>(
    await call(
      `/api/v1/customers/${busyCompany}/insights`,
      TEST_MATCHING_TOKEN,
    ),
  );
  assert.equal(one.companyId, busyCompany);
  assert.equal(
    (
      await call(
        `/api/v1/customers/${randomUUID()}/insights`,
        TEST_MATCHING_TOKEN,
      )
    ).status,
    404,
  );
  assert.equal(
    (await call("/api/v1/customers/not-an-id/insights", TEST_MATCHING_TOKEN))
      .status,
    400,
  );
});

test("any staff role sees the figures, but customers and the signed-out are refused", async () => {
  assert.ok((await insights(TEST_MATCHING_TOKEN)).length >= 3);
  for (const path of [
    "/api/v1/customers/insights",
    `/api/v1/customers/${busyCompany}/insights`,
  ]) {
    assert.equal((await call(path, TEST_CUSTOMER_A_TOKEN)).status, 403);
    assert.equal((await call(path, "bad-token")).status, 401);
  }
});
