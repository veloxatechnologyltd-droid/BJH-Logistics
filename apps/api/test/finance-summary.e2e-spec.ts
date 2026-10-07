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
  TEST_UNASSIGNED_TOKEN,
  TEST_UNASSIGNED_USER_ID,
  createTestApplication,
} from "./test-application";
import { DatabasePort } from "../src/database/database.port";
import { beginTestDatabase, endTestDatabase } from "./postgres-test-database";

let application: INestApplication;
let baseUrl: string;
let seaJob: string;
let airJob: string;

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

type Summary = {
  jobs: Array<{
    fileNumber: string;
    currency: string;
    invoicedMinor: number;
    receivedMinor: number;
    owingMinor: number;
    costMinor: number;
    marginMinor: number | null;
  }>;
  totals: Array<{
    currency: string;
    invoicedMinor: number;
    receivedMinor: number;
    owingMinor: number;
    costMinor: number;
  }>;
};
const summary = (token: string) => call("/api/v1/finance/summary", token);

async function openJob(companyId: string, serviceLine: string) {
  const response = await post("/api/v1/jobs", TEST_SUPER_ADMIN_TOKEN, {
    customerCompanyId: companyId,
    serviceLine,
  });
  return (await json<{ id: string; fileNumber: string }>(response)).id;
}

async function issued(jobId: string, currency: string, amountMinor: number) {
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
  await database.assignStaffRole(
    TEST_UNASSIGNED_USER_ID,
    "air_export_rep",
    TEST_SUPER_ADMIN_ID,
  );
  const company = randomUUID();
  await database.createCustomer({
    id: company,
    companyName: "Northstar Synthetic Ltd",
    createdAt: new Date().toISOString(),
    contacts: [],
  });
  await database.grantCustomerMembership(
    company,
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
  seaJob = await openJob(company, "sea_import");
  airJob = await openJob(company, "air_import");

  // Sea job: GHS 1,000.00 invoiced and 400.00 received; a USD 50.00 invoice;
  // a voided invoice that must not count.
  const ghs = await issued(seaJob, "GHS", 100000);
  await post(
    `/api/v1/jobs/${seaJob}/invoices/${ghs}/payments`,
    TEST_SUPER_ADMIN_TOKEN,
    {
      amountMinor: 40000,
      receivedOn: new Date().toISOString().slice(0, 10),
      method: "cash",
    },
  );
  await issued(seaJob, "USD", 5000);
  const voided = await issued(seaJob, "GHS", 9000);
  await post(
    `/api/v1/jobs/${seaJob}/invoices/${voided}/void`,
    TEST_SUPER_ADMIN_TOKEN,
    { reason: "Wrong customer" },
  );
  // Costs: only the newest actual of a charge counts; a removed charge does not.
  const chargesPath = `/api/v1/jobs/${seaJob}/charges`;
  const charge = await json<{ id: string }>(
    await post(chargesPath, TEST_SUPER_ADMIN_TOKEN, {
      kind: "disbursement",
      description: "Terminal handling",
      currency: "GHS",
    }),
  );
  const first = await json<{ id: string }>(
    await post(`${chargesPath}/${charge.id}/actuals`, TEST_SUPER_ADMIN_TOKEN, {
      amountMinor: 20000,
      currency: "GHS",
    }),
  );
  await post(`${chargesPath}/${charge.id}/actuals`, TEST_SUPER_ADMIN_TOKEN, {
    amountMinor: 30000,
    currency: "GHS",
    correctionOf: first.id,
  });
  // Air job: a cost but nothing invoiced.
  const airCharge = await json<{ id: string }>(
    await post(`/api/v1/jobs/${airJob}/charges`, TEST_SUPER_ADMIN_TOKEN, {
      kind: "disbursement",
      description: "Airline handling",
      currency: "GHS",
    }),
  );
  await post(
    `/api/v1/jobs/${airJob}/charges/${airCharge.id}/actuals`,
    TEST_SUPER_ADMIN_TOKEN,
    { amountMinor: 7000, currency: "GHS" },
  );
});

after(async () => {
  await application?.close();
  await endTestDatabase();
});

test("each job shows invoiced, received, owing and cost per currency, with a margin only where both exist", async () => {
  const body = await json<Summary>(await summary(TEST_SUPER_ADMIN_TOKEN));
  assert.equal(body.jobs.length, 3);
  const seaGhs = body.jobs.find(
    (row) => row.currency === "GHS" && row.invoicedMinor === 100000,
  )!;
  assert.equal(seaGhs.receivedMinor, 40000);
  assert.equal(seaGhs.owingMinor, 60000);
  // The corrected actual (300.00) counts, not the first (200.00).
  assert.equal(seaGhs.costMinor, 30000);
  assert.equal(seaGhs.marginMinor, 70000);
  const seaUsd = body.jobs.find((row) => row.currency === "USD")!;
  assert.equal(seaUsd.invoicedMinor, 5000);
  assert.equal(seaUsd.costMinor, 0);
  assert.equal(seaUsd.marginMinor, null);
  const air = body.jobs.find((row) => row.costMinor === 7000)!;
  assert.equal(air.invoicedMinor, 0);
  assert.equal(air.marginMinor, null);
});

test("totals stay per currency and the voided invoice is left out", async () => {
  const body = await json<Summary>(await summary(TEST_SUPER_ADMIN_TOKEN));
  const byCurrency = new Map(body.totals.map((row) => [row.currency, row]));
  assert.deepEqual(byCurrency.get("GHS"), {
    currency: "GHS",
    invoicedMinor: 100000,
    receivedMinor: 40000,
    owingMinor: 60000,
    costMinor: 37000,
  });
  assert.equal(byCurrency.get("USD")?.invoicedMinor, 5000);
});

test("a rep sees only their service lines; customers and the signed-out are refused", async () => {
  const rep = await json<Summary>(await summary(TEST_MATCHING_TOKEN));
  assert.ok(rep.jobs.length > 0);
  assert.ok(rep.jobs.every((row) => row.costMinor !== 7000));
  assert.deepEqual(
    (await json<Summary>(await summary(TEST_UNASSIGNED_TOKEN))).jobs,
    [],
  );
  assert.equal((await summary(TEST_CUSTOMER_A_TOKEN)).status, 403);
  assert.equal(
    (await call("/api/v1/finance/summary", "bad-token")).status,
    401,
  );
});
