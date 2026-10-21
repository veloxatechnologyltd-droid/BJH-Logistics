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

type Line = {
  date: string;
  kind: "invoice" | "payment";
  reference: string;
  debitMinor: number;
  creditMinor: number;
  balanceMinor: number;
};
type Section = {
  currency: string;
  openingMinor: number;
  lines: Line[];
  debitMinor: number;
  creditMinor: number;
  closingMinor: number;
};
type Statement = {
  company: { id: string; name: string; customerNumber: string | null };
  from: string | null;
  to: string | null;
  sections: Section[];
};
const statement = (token: string, company: string, query = "") =>
  get(`/api/v1/finance/statements?companyId=${company}${query}`, token);
const sectionOf = (result: Statement, currency: string) =>
  result.sections.find((section) => section.currency === currency)!;

async function openJob(companyId: string, serviceLine: string) {
  const response = await post("/api/v1/jobs", TEST_SUPER_ADMIN_TOKEN, {
    customerCompanyId: companyId,
    serviceLine,
  });
  return (await json<{ id: string }>(response)).id;
}

/** A draft invoice with one line; issued unless `draftOnly`. */
async function invoice(
  key: string,
  jobId: string,
  amountMinor: number,
  currency = "GHS",
  draftOnly = false,
) {
  const created = await json<{ id: string }>(
    await post(`/api/v1/jobs/${jobId}/invoices`, TEST_SUPER_ADMIN_TOKEN, {
      currency,
      lines: [{ description: key, amountMinor, taxable: false }],
    }),
  );
  if (draftOnly) return created.id;
  const issued = await json<{ invoiceNumber: string }>(
    await post(
      `/api/v1/jobs/${jobId}/invoices/${created.id}/issue`,
      TEST_SUPER_ADMIN_TOKEN,
    ),
  );
  numbers[key] = issued.invoiceNumber;
  return created.id;
}

async function pay(jobId: string, invoiceId: string, amountMinor: number) {
  return json<{ id: string }>(
    await post(
      `/api/v1/jobs/${jobId}/invoices/${invoiceId}/payments`,
      TEST_SUPER_ADMIN_TOKEN,
      {
        amountMinor,
        receivedOn: daysFromNow(0),
        method: "bank_transfer",
        reference: "TT-STMT",
      },
    ),
  );
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
      currencies: ["GHS", "USD"],
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
  await post(`/api/v1/jobs/${seaA}/references`, TEST_SUPER_ADMIN_TOKEN, {
    kind: "master_bl",
    value: "MBL-SYN-STMT",
  });

  const one = await invoice("one", seaA, 100_000);
  await pay(seaA, one, 40_000);
  const two = await invoice("two", seaA, 50_000);
  const reversed = await pay(seaA, two, 50_000);
  await post(
    `/api/v1/jobs/${seaA}/invoices/${two}/payments/${reversed.id}/reverse`,
    TEST_SUPER_ADMIN_TOKEN,
    { reason: "Cheque bounced" },
  );
  await invoice("three", airA, 70_000);
  await invoice("dollars", airA, 25_000, "USD");
  const voided = await invoice("voided", seaA, 9_000);
  await post(
    `/api/v1/jobs/${seaA}/invoices/${voided}/void`,
    TEST_SUPER_ADMIN_TOKEN,
    { reason: "Wrong customer" },
  );
  await invoice("draft", seaA, 1_234, "GHS", true);
  await invoice("other", seaB, 20_000);
});

after(async () => {
  await application?.close();
  await endTestDatabase();
});

test("a statement lists the customer's issued invoices and standing payments, one section per currency", async () => {
  const result = await json<Statement>(
    await statement(TEST_SUPER_ADMIN_TOKEN, companyA),
  );
  assert.equal(result.company.name, "Northstar Synthetic Ltd");

  const ghs = sectionOf(result, "GHS");
  // Invoices first (oldest first), then the payment; the voided invoice, the
  // draft, the reversed payment and the other customer's invoice are absent.
  assert.deepEqual(
    ghs.lines.map((line) => [line.kind, line.debitMinor, line.creditMinor]),
    [
      ["invoice", 100_000, 0],
      ["invoice", 50_000, 0],
      ["invoice", 70_000, 0],
      ["payment", 0, 40_000],
    ],
  );
  assert.deepEqual(
    ghs.lines.map((line) => line.balanceMinor),
    [100_000, 150_000, 220_000, 180_000],
  );
  assert.equal(ghs.closingMinor, 180_000);

  const usd = sectionOf(result, "USD");
  assert.deepEqual(
    usd.lines.map((line) => line.balanceMinor),
    [25_000],
  );
  // Currencies are never added together.
  assert.deepEqual(
    result.sections.map((section) => section.currency),
    ["GHS", "USD"],
  );
});

test("the closing balance matches what the receivables report says is still owed", async () => {
  const result = await json<Statement>(
    await statement(TEST_SUPER_ADMIN_TOKEN, companyA),
  );
  const owed = await json<{
    totals: Array<{ currency: string; outstandingMinor: number }>;
  }>(
    await get(
      `/api/v1/invoices/outstanding?companyId=${companyA}`,
      TEST_SUPER_ADMIN_TOKEN,
    ),
  );
  for (const total of owed.totals) {
    assert.equal(
      sectionOf(result, total.currency).closingMinor,
      total.outstandingMinor,
    );
  }
});

test("lines name the invoice, the job file, the bill of lading and the payment's receipt and reference", async () => {
  const result = await json<Statement>(
    await statement(TEST_SUPER_ADMIN_TOKEN, companyA),
  );
  const ghs = sectionOf(result, "GHS");
  assert.match(
    ghs.lines[0].reference,
    new RegExp(`^${numbers.one} - .+ - B/L#: MBL-SYN-STMT$`),
  );
  // The air job has no references, so its line is just invoice and file.
  assert.doesNotMatch(ghs.lines[2].reference, /B\/L#/);
  assert.match(
    ghs.lines[3].reference,
    new RegExp(
      `^Receipt SYN/RCT/.+ - Bank transfer \\(TT-STMT\\) - for ${numbers.one}$`,
    ),
  );
});

test("a period folds earlier entries into the opening balance and drops later ones", async () => {
  const later = await json<Statement>(
    await statement(
      TEST_SUPER_ADMIN_TOKEN,
      companyA,
      `&from=${daysFromNow(1)}`,
    ),
  );
  const ghs = sectionOf(later, "GHS");
  assert.equal(ghs.openingMinor, 180_000);
  assert.equal(ghs.lines.length, 0);
  assert.equal(ghs.closingMinor, 180_000);

  const earlier = await json<Statement>(
    await statement(TEST_SUPER_ADMIN_TOKEN, companyA, `&to=${daysFromNow(-1)}`),
  );
  assert.deepEqual(earlier.sections, []);
});

test("any staff member reads any customer's statement, including other departments' jobs", async () => {
  const rep = await json<Statement>(
    await statement(TEST_MATCHING_TOKEN, companyA),
  );
  // The sea-import rep still sees the air job's invoice: the statement is the whole account.
  assert.equal(sectionOf(rep, "GHS").closingMinor, 180_000);
});

test("customers and people with no role or company cannot read a statement", async () => {
  for (const token of [
    TEST_CUSTOMER_A_TOKEN,
    TEST_CUSTOMER_B_TOKEN,
    TEST_UNASSIGNED_TOKEN,
  ]) {
    assert.equal((await statement(token, companyA)).status, 403);
    assert.equal(
      (await get(`/api/v1/finance/statements/pdf?companyId=${companyA}`, token))
        .status,
      403,
    );
  }
  const anonymous = await fetch(
    `${baseUrl}/api/v1/finance/statements?companyId=${companyA}`,
  );
  assert.equal(anonymous.status, 401);
});

test("a bad request is refused in plain words and an unknown customer is not found", async () => {
  const message = async (response: Response) =>
    ((await response.json()) as { message: string }).message;

  const missing = await get(
    "/api/v1/finance/statements",
    TEST_SUPER_ADMIN_TOKEN,
  );
  assert.equal(missing.status, 400);
  assert.equal(await message(missing), "companyId is required");

  const badDate = await statement(
    TEST_SUPER_ADMIN_TOKEN,
    companyA,
    "&from=yesterday",
  );
  assert.equal(badDate.status, 400);
  assert.equal(await message(badDate), "from must be a date (YYYY-MM-DD)");

  const backwards = await statement(
    TEST_SUPER_ADMIN_TOKEN,
    companyA,
    "&from=2026-10-02&to=2026-10-01",
  );
  assert.equal(backwards.status, 400);
  assert.equal(await message(backwards), "from must not be after to");

  const unknown = await statement(TEST_SUPER_ADMIN_TOKEN, randomUUID());
  assert.equal(unknown.status, 404);
});

test("the statement downloads as a PDF for staff", async () => {
  const response = await get(
    `/api/v1/finance/statements/pdf?companyId=${companyA}`,
    TEST_SUPER_ADMIN_TOKEN,
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/pdf");
  assert.match(
    response.headers.get("content-disposition") ?? "",
    /^inline; filename="statement-Northstar-Synthetic-Ltd-\d{4}-\d{2}-\d{2}\.pdf"$/,
  );
  const body = Buffer.from(await response.arrayBuffer());
  assert.equal(body.subarray(0, 5).toString(), "%PDF-");
});
