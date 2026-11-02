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
const numbers: Record<string, string> = {};

const daysFromNow = (days: number) =>
  new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

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
const get = (path: string, token: string) => call(path, token);
const json = async <T>(response: Response) => (await response.json()) as T;

type Row = {
  invoiceNumber: string;
  fileNumber: string;
  customerCompanyName: string;
  currency: string;
  totalMinor: number;
  outstandingMinor: number;
  dueDate: string | null;
  overdue: boolean;
  daysOverdue: number;
};
type Report = {
  invoices: Row[];
  totals: Array<{
    currency: string;
    outstandingMinor: number;
    overdueMinor: number;
  }>;
};
const report = async (token: string, query = "") =>
  json<Report>(await get(`/api/v1/invoices/outstanding${query}`, token));
const label = (rows: Row[]) => rows.map((row) => row.invoiceNumber);

async function openJob(companyId: string, serviceLine: string) {
  const response = await post("/api/v1/jobs", TEST_SUPER_ADMIN_TOKEN, {
    customerCompanyId: companyId,
    serviceLine,
  });
  return (await json<{ id: string }>(response)).id;
}

/** An issued invoice with one line, optionally paid in part or whole. */
async function invoice(
  key: string,
  jobId: string,
  amountMinor: number,
  dueDate: string | null,
  paidMinor = 0,
) {
  const created = await json<{ id: string }>(
    await post(`/api/v1/jobs/${jobId}/invoices`, TEST_SUPER_ADMIN_TOKEN, {
      currency: "GHS",
      ...(dueDate ? { dueDate } : {}),
      lines: [{ description: key, amountMinor, taxable: false }],
    }),
  );
  const issued = await json<{ invoiceNumber: string }>(
    await post(
      `/api/v1/jobs/${jobId}/invoices/${created.id}/issue`,
      TEST_SUPER_ADMIN_TOKEN,
    ),
  );
  numbers[key] = issued.invoiceNumber;
  if (paidMinor > 0) {
    await post(
      `/api/v1/jobs/${jobId}/invoices/${created.id}/payments`,
      TEST_SUPER_ADMIN_TOKEN,
      {
        amountMinor: paidMinor,
        receivedOn: daysFromNow(0),
        method: "cash",
      },
    );
  }
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
    "finance_rep",
    TEST_SUPER_ADMIN_ID,
  );
  await database.assignStaffRole(
    TEST_UNASSIGNED_USER_ID,
    "export_rep",
    TEST_SUPER_ADMIN_ID,
  );
  [companyA, companyB] = [randomUUID(), randomUUID()];
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
  await call("/api/v1/settings", TEST_SUPER_ADMIN_TOKEN, {
    method: "PUT",
    body: JSON.stringify({
      issuer: { name: "Synthetic Forwarding Ltd" },
      currencies: ["GHS"],
      numbering: {
        quotePrefix: "SYN/Q",
        invoicePrefix: "SYN/INV",
        receiptPrefix: "SYN/RCT",
      },
      quoteDefaults: {},
    }),
  });

  const seaA = await openJob(companyA, "sea_import");
  const airA = await openJob(companyA, "air_import");
  const seaB = await openJob(companyB, "sea_import");
  await invoice("late", seaA, 100000, daysFromNow(-3), 40000);
  await invoice("soon", seaA, 50000, daysFromNow(5));
  await invoice("nodue", seaB, 20000, null);
  await invoice("paid", seaB, 30000, daysFromNow(-10), 30000);
  await invoice("air", airA, 70000, daysFromNow(-1));
  const voided = await invoice("voided", seaB, 10000, daysFromNow(-2));
  await post(
    `/api/v1/jobs/${seaB}/invoices/${voided}/void`,
    TEST_SUPER_ADMIN_TOKEN,
    { reason: "Wrong customer" },
  );
});

after(async () => {
  await application?.close();
  await endTestDatabase();
});

test("everything still owing is listed, oldest due date first, with what is overdue", async () => {
  const all = await report(TEST_SUPER_ADMIN_TOKEN);
  // Paid and voided invoices are not owed; an invoice with no due date comes last.
  assert.deepEqual(label(all.invoices), [
    numbers.late,
    numbers.air,
    numbers.soon,
    numbers.nodue,
  ]);
  const late = all.invoices[0];
  assert.equal(late.outstandingMinor, 60000);
  assert.equal(late.totalMinor, 100000);
  assert.equal(late.overdue, true);
  assert.equal(late.daysOverdue, 3);
  assert.equal(late.customerCompanyName, "Northstar Synthetic Ltd");
  const soon = all.invoices.find((row) => row.invoiceNumber === numbers.soon)!;
  assert.equal(soon.overdue, false);
  assert.equal(soon.daysOverdue, 0);
  const nodue = all.invoices.find(
    (row) => row.invoiceNumber === numbers.nodue,
  )!;
  assert.equal(nodue.dueDate, null);
  assert.equal(nodue.overdue, false);
});

test("totals are per currency and split out what is overdue", async () => {
  const all = await report(TEST_SUPER_ADMIN_TOKEN);
  assert.deepEqual(all.totals, [
    {
      currency: "GHS",
      outstandingMinor: 60000 + 70000 + 50000 + 20000,
      overdueMinor: 60000 + 70000,
    },
  ]);
});

test("finance sees every service line, other staff are refused, customers only their own company", async () => {
  // Finance is not held to a service line: it sees what the super admin sees.
  assert.deepEqual(
    label((await report(TEST_MATCHING_TOKEN)).invoices),
    label((await report(TEST_SUPER_ADMIN_TOKEN)).invoices),
  );
  // Other staff have no business with unpaid money.
  assert.equal(
    (await get("/api/v1/invoices/outstanding", TEST_UNASSIGNED_TOKEN)).status,
    403,
  );

  assert.deepEqual(label((await report(TEST_CUSTOMER_A_TOKEN)).invoices), [
    numbers.late,
    numbers.air,
    numbers.soon,
  ]);
  assert.deepEqual(label((await report(TEST_CUSTOMER_B_TOKEN)).invoices), [
    numbers.nodue,
  ]);
  // A customer cannot widen the report to another company.
  assert.deepEqual(
    (await report(TEST_CUSTOMER_B_TOKEN, `?companyId=${companyA}`)).invoices,
    [],
  );
  assert.deepEqual(
    (await report(TEST_CUSTOMER_B_TOKEN, `?companyId=${companyA}`)).totals,
    [],
  );
});

test("staff can narrow the report to one company; bad filters are refused", async () => {
  assert.deepEqual(
    label(
      (await report(TEST_SUPER_ADMIN_TOKEN, `?companyId=${companyB}`)).invoices,
    ),
    [numbers.nodue],
  );
  assert.deepEqual(
    (await report(TEST_SUPER_ADMIN_TOKEN, `?companyId=${randomUUID()}`))
      .invoices,
    [],
  );
  const bad = await get(
    "/api/v1/invoices/outstanding?companyId=nope",
    TEST_SUPER_ADMIN_TOKEN,
  );
  assert.equal(bad.status, 400);
  assert.equal(
    ((await bad.json()) as { message: string }).message,
    "companyId must be a valid ID",
  );
});

test("a payment that clears an invoice, or a reversal that reopens it, changes the report", async () => {
  const before = await report(TEST_SUPER_ADMIN_TOKEN);
  const soon = before.invoices.find(
    (row) => row.invoiceNumber === numbers.soon,
  )!;
  assert.ok(soon);
  const jobs = await json<Array<{ id: string; fileNumber: string }>>(
    await get("/api/v1/jobs", TEST_SUPER_ADMIN_TOKEN),
  );
  const job = jobs.find((item) => item.fileNumber === soon.fileNumber)!;
  const invoices = await json<Array<{ id: string; invoiceNumber: string }>>(
    await get(`/api/v1/jobs/${job.id}/invoices`, TEST_SUPER_ADMIN_TOKEN),
  );
  const target = invoices.find((item) => item.invoiceNumber === numbers.soon)!;
  const paid = await json<{ id: string }>(
    await post(
      `/api/v1/jobs/${job.id}/invoices/${target.id}/payments`,
      TEST_SUPER_ADMIN_TOKEN,
      {
        amountMinor: 50000,
        receivedOn: daysFromNow(0),
        method: "bank_transfer",
      },
    ),
  );
  assert.ok(
    !label((await report(TEST_SUPER_ADMIN_TOKEN)).invoices).includes(
      numbers.soon,
    ),
  );
  await post(
    `/api/v1/jobs/${job.id}/invoices/${target.id}/payments/${paid.id}/reverse`,
    TEST_SUPER_ADMIN_TOKEN,
    { reason: "Bounced" },
  );
  assert.ok(
    label((await report(TEST_SUPER_ADMIN_TOKEN)).invoices).includes(
      numbers.soon,
    ),
  );
});
