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
let jobA: string;
let jobB: string;
let jobC: string;
let companyA: string;
let companyB: string;
let evidenceOnA: string;
let evidenceOnB: string;

const year = new Date().getUTCFullYear();
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
const post = (path: string, token: string, body: unknown) =>
  call(path, token, { method: "POST", body: JSON.stringify(body) });
const put = (path: string, token: string, body: unknown) =>
  call(path, token, { method: "PUT", body: JSON.stringify(body) });
const get = (path: string, token = TEST_MATCHING_TOKEN) => call(path, token);
const message = async (response: Response) =>
  ((await response.json()) as { message: string }).message;

async function openJob(companyId: string) {
  const response = await post("/api/v1/jobs", TEST_SUPER_ADMIN_TOKEN, {
    customerCompanyId: companyId,
    serviceLine: "sea_import",
  });
  return ((await response.json()) as { id: string }).id;
}

async function evidenceDocument(jobId: string) {
  const form = new FormData();
  form.append("documentType", "other");
  form.append(
    "file",
    new Blob(
      [new Uint8Array(Buffer.from(`%PDF-1.4\n% ${randomUUID()}\n%%EOF\n`))],
      {
        type: "application/pdf",
      },
    ),
    "evidence.pdf",
  );
  const response = await call(
    `/api/v1/jobs/${jobId}/documents`,
    TEST_MATCHING_TOKEN,
    {
      method: "POST",
      body: form,
    },
  );
  return ((await response.json()) as { id: string }).id;
}

type Invoice = {
  id: string;
  invoiceNumber: string | null;
  status: string;
  currency: string;
  lines: Array<{ description: string; amountMinor: number; taxable: boolean }>;
  dueDate: string | null;
  notes: string | null;
  subtotalMinor: number;
  taxLines: Array<{
    name: string;
    rateBasisPoints: number;
    amountMinor: number;
  }>;
  taxTotalMinor: number;
  totalMinor: number;
  paidMinor: number;
  outstandingMinor: number;
  paymentStatus: string;
  voidReason: string | null;
  payments?: Array<{
    id: string;
    receiptNumber: string | null;
    amountMinor: number;
    method: string;
    reference: string | null;
    reversal: { reason: string } | null;
  }>;
};

const invoicesOf = async (jobId: string, token = TEST_MATCHING_TOKEN) =>
  (await (
    await get(`/api/v1/jobs/${jobId}/invoices`, token)
  ).json()) as Invoice[];

const settings = (over: Record<string, unknown> = {}) => ({
  issuer: { name: "Synthetic Forwarding Ltd", address: "1 Test Road" },
  currencies: ["GHS", "USD"],
  taxLines: [
    { name: "NHIL", rateBasisPoints: 250 },
    { name: "GETFL", rateBasisPoints: 250 },
    { name: "VAT", rateBasisPoints: 1500 },
  ],
  paymentTermsDays: 30,
  numbering: {
    quotePrefix: "SYN/Q",
    invoicePrefix: "SYN/INV",
    receiptPrefix: "SYN/RCT",
  },
  quoteDefaults: {},
  ...over,
});

const sampleLines = [
  { description: "Shore handling export stuffed 40FT", amountMinor: 138190 },
  { description: "Transport charge stuffed export", amountMinor: 101590 },
];

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
  jobA = await openJob(companyA);
  jobB = await openJob(companyB);
  jobC = await openJob(companyA);
  evidenceOnA = await evidenceDocument(jobA);
  evidenceOnB = await evidenceDocument(jobB);
});

after(async () => {
  await application?.close();
  await endTestDatabase();
});

let invoice: Invoice;
let voidedDraftId: string;

test("a draft can be prepared before settings exist, but cannot be issued", async () => {
  const response = await post(
    `/api/v1/jobs/${jobA}/invoices`,
    TEST_MATCHING_TOKEN,
    {
      currency: "ghs",
      lines: sampleLines,
      notes: "  Thank you  ",
    },
  );
  assert.equal(response.status, 201);
  invoice = (await response.json()) as Invoice;
  assert.equal(invoice.status, "draft");
  assert.equal(invoice.invoiceNumber, null);
  assert.equal(invoice.currency, "GHS");
  assert.equal(invoice.notes, "Thank you");
  assert.equal(invoice.subtotalMinor, 239780);
  assert.deepEqual(invoice.taxLines, []);
  assert.equal(invoice.totalMinor, 239780);
  assert.equal(invoice.outstandingMinor, 0);
  assert.equal(invoice.paymentStatus, "draft");
  assert.ok(invoice.lines.every((line) => line.taxable));

  const issue = await post(
    `/api/v1/jobs/${jobA}/invoices/${invoice.id}/issue`,
    TEST_MATCHING_TOKEN,
    {},
  );
  assert.equal(issue.status, 409);
  assert.equal(
    await message(issue),
    "Configure the business settings before issuing an invoice",
  );

  const cases: Array<[Record<string, unknown>, string]> = [
    [{ lines: [] }, "currency is required"],
    [{ currency: "GHS", lines: "x" }, "lines must be a list"],
    [
      { currency: "GHS", lines: [{ description: "x", amountMinor: -1 }] },
      "amountMinor cannot be negative",
    ],
    [
      { currency: "GHS", lines: [{ description: "x", amountMinor: 1.5 }] },
      "amountMinor must be a whole number of minor units",
    ],
    [
      { currency: "GHS", dueDate: "2026-02-30" },
      "dueDate must be a date (YYYY-MM-DD)",
    ],
    [
      {
        currency: "GHS",
        lines: Array.from({ length: 101 }, () => ({
          description: "x",
          amountMinor: 1,
        })),
      },
      "An invoice can have at most 100 lines",
    ],
  ];
  for (const [body, expected] of cases) {
    const rejected = await post(
      `/api/v1/jobs/${jobA}/invoices`,
      TEST_MATCHING_TOKEN,
      body,
    );
    assert.equal(rejected.status, 400, expected);
    assert.equal(await message(rejected), expected);
  }
});

test("tax lines come from the settings; issuing numbers the invoice and freezes it", async () => {
  assert.equal(
    (await put("/api/v1/settings", TEST_SUPER_ADMIN_TOKEN, settings())).status,
    200,
  );

  const wrongCurrency = await post(
    `/api/v1/jobs/${jobA}/invoices`,
    TEST_MATCHING_TOKEN,
    {
      currency: "EUR",
    },
  );
  assert.equal(wrongCurrency.status, 400);
  assert.match(await message(wrongCurrency), /configured currencies: GHS, USD/);

  const updated = await put(
    `/api/v1/jobs/${jobA}/invoices/${invoice.id}`,
    TEST_MATCHING_TOKEN,
    { currency: "GHS", lines: sampleLines, notes: "Thank you" },
  );
  assert.equal(updated.status, 200);
  const draft = (await updated.json()) as Invoice;
  // The client's sample: 2,397.80 charges give 2,877.36 with NHIL, GETFL and VAT.
  assert.equal(draft.subtotalMinor, 239780);
  assert.deepEqual(
    draft.taxLines.map((line) => [line.name, line.amountMinor]),
    [
      ["NHIL", 5995],
      ["GETFL", 5995],
      ["VAT", 35967],
    ],
  );
  assert.equal(draft.taxTotalMinor, 47956);
  assert.equal(draft.totalMinor, 287736);

  const issued = await post(
    `/api/v1/jobs/${jobA}/invoices/${invoice.id}/issue`,
    TEST_MATCHING_TOKEN,
    {},
  );
  assert.equal(issued.status, 201);
  invoice = (await issued.json()) as Invoice;
  assert.equal(invoice.status, "issued");
  assert.equal(invoice.invoiceNumber, `SYN/INV/${year}/0001`);
  assert.equal(invoice.dueDate, daysFromNow(30));
  assert.equal(invoice.totalMinor, 287736);
  assert.equal(invoice.paymentStatus, "unpaid");
  assert.equal(invoice.outstandingMinor, 287736);

  const edit = await put(
    `/api/v1/jobs/${jobA}/invoices/${invoice.id}`,
    TEST_MATCHING_TOKEN,
    { currency: "GHS", lines: [{ description: "Changed", amountMinor: 1 }] },
  );
  assert.equal(edit.status, 409);
  assert.match(await message(edit), /Only a draft invoice can be edited/);
  const again = await post(
    `/api/v1/jobs/${jobA}/invoices/${invoice.id}/issue`,
    TEST_MATCHING_TOKEN,
    {},
  );
  assert.equal(again.status, 409);

  // A later settings change never rewrites an issued invoice.
  await put(
    "/api/v1/settings",
    TEST_SUPER_ADMIN_TOKEN,
    settings({ taxLines: [] }),
  );
  const [stored] = await invoicesOf(jobA);
  assert.equal(stored.totalMinor, 287736);
  assert.equal(stored.taxLines.length, 3);
});

test("an empty draft cannot be issued", async () => {
  const draft = (await (
    await post(`/api/v1/jobs/${jobA}/invoices`, TEST_MATCHING_TOKEN, {
      currency: "GHS",
    })
  ).json()) as Invoice;
  const response = await post(
    `/api/v1/jobs/${jobA}/invoices/${draft.id}/issue`,
    TEST_MATCHING_TOKEN,
    {},
  );
  assert.equal(response.status, 400);
  assert.equal(await message(response), "Add at least one line before issuing");
  // A draft that will not be used is voided; it never consumed a number.
  const voided = await post(
    `/api/v1/jobs/${jobA}/invoices/${draft.id}/void`,
    TEST_MATCHING_TOKEN,
    { reason: "Not needed" },
  );
  assert.equal(voided.status, 201);
  const voidedDraft = (await voided.json()) as Invoice;
  assert.equal(voidedDraft.invoiceNumber, null);
  voidedDraftId = voidedDraft.id;
});

test("payments are recorded against the issued invoice and the balance follows the ledger", async () => {
  const path = `/api/v1/jobs/${jobA}/invoices/${invoice.id}/payments`;
  const first = await post(path, TEST_MATCHING_TOKEN, {
    amountMinor: 100000,
    receivedOn: daysFromNow(0),
    method: "bank_transfer",
    reference: "  TXN-1  ",
    evidenceDocumentId: evidenceOnA,
  });
  assert.equal(first.status, 201);
  const firstPayment = (await first.json()) as {
    id: string;
    reference: string;
  };
  assert.equal(firstPayment.reference, "TXN-1");
  let [current] = await invoicesOf(jobA);
  assert.equal(current.paidMinor, 100000);
  assert.equal(current.outstandingMinor, 187736);
  assert.equal(current.paymentStatus, "partial");

  const over = await post(path, TEST_MATCHING_TOKEN, {
    amountMinor: 187737,
    receivedOn: daysFromNow(0),
    method: "cash",
  });
  assert.equal(over.status, 409);
  assert.equal(
    await message(over),
    "The payment is more than the outstanding balance",
  );

  const cases: Array<[Record<string, unknown>, number, string]> = [
    [{ amountMinor: 0 }, 400, "amountMinor must be more than zero"],
    [
      { amountMinor: 1.5 },
      400,
      "amountMinor must be a whole number of minor units",
    ],
    [
      { receivedOn: "2026-13-40" },
      400,
      "receivedOn must be a date (YYYY-MM-DD)",
    ],
    [{ receivedOn: daysFromNow(3) }, 400, "receivedOn cannot be in the future"],
    [
      { method: "crypto" },
      400,
      "method must be one of cash, bank_transfer, cheque, mobile_money, other",
    ],
    [
      { evidenceDocumentId: evidenceOnB },
      400,
      "evidenceDocumentId must be a document on this job",
    ],
  ];
  for (const [over, status, expected] of cases) {
    const response = await post(path, TEST_MATCHING_TOKEN, {
      amountMinor: 100,
      receivedOn: daysFromNow(0),
      method: "cash",
      ...over,
    });
    assert.equal(response.status, status, expected);
    assert.equal(await message(response), expected);
  }

  const remainder = await post(path, TEST_MATCHING_TOKEN, {
    amountMinor: 187736,
    receivedOn: daysFromNow(0),
    method: "cash",
  });
  assert.equal(remainder.status, 201);
  const remainderPayment = (await remainder.json()) as { id: string };
  [current] = await invoicesOf(jobA);
  assert.equal(current.outstandingMinor, 0);
  assert.equal(current.paymentStatus, "paid");
  assert.equal(
    (
      await post(path, TEST_MATCHING_TOKEN, {
        amountMinor: 1,
        receivedOn: daysFromNow(0),
        method: "cash",
      })
    ).status,
    409,
  );

  const voidWithPayments = await post(
    `/api/v1/jobs/${jobA}/invoices/${invoice.id}/void`,
    TEST_MATCHING_TOKEN,
    { reason: "Mistake" },
  );
  assert.equal(voidWithPayments.status, 409);
  assert.equal(
    await message(voidWithPayments),
    "Reverse the payments before voiding the invoice",
  );

  const reversePath = `${path}/${remainderPayment.id}/reverse`;
  assert.equal((await post(reversePath, TEST_MATCHING_TOKEN, {})).status, 400);
  const reversed = await post(reversePath, TEST_MATCHING_TOKEN, {
    reason: "Cheque bounced",
  });
  assert.equal(reversed.status, 201);
  assert.equal(
    ((await reversed.json()) as { reversal: { reason: string } }).reversal
      .reason,
    "Cheque bounced",
  );
  assert.equal(
    (await post(reversePath, TEST_MATCHING_TOKEN, { reason: "again" })).status,
    409,
  );
  assert.equal(
    (
      await post(`${path}/${randomUUID()}/reverse`, TEST_MATCHING_TOKEN, {
        reason: "x",
      })
    ).status,
    404,
  );

  [current] = await invoicesOf(jobA);
  assert.equal(current.paidMinor, 100000);
  assert.equal(current.outstandingMinor, 187736);
  assert.equal(current.paymentStatus, "partial");
  assert.equal(current.payments?.length, 2);
  assert.equal(
    current.payments?.find((payment) => payment.id === remainderPayment.id)
      ?.reversal?.reason,
    "Cheque bounced",
  );
  // The reversed amount is available again.
  assert.equal(
    (
      await post(path, TEST_MATCHING_TOKEN, {
        amountMinor: 187736,
        receivedOn: daysFromNow(0),
        method: "mobile_money",
      })
    ).status,
    201,
  );
  assert.equal(
    (
      await post(
        `/api/v1/jobs/${jobA}/invoices/not-a-uuid/payments`,
        TEST_MATCHING_TOKEN,
        {
          amountMinor: 1,
          receivedOn: daysFromNow(0),
          method: "cash",
        },
      )
    ).status,
    404,
  );
});

test("access boundaries: customers read issued invoices of their own company only", async () => {
  const hidden = (await (
    await post(`/api/v1/jobs/${jobA}/invoices`, TEST_MATCHING_TOKEN, {
      currency: "GHS",
      lines: [{ description: "Draft only", amountMinor: 100 }],
    })
  ).json()) as Invoice;

  // Only the issued invoice: neither the draft nor the draft voided before issue.
  const asCustomer = await invoicesOf(jobA, TEST_CUSTOMER_A_TOKEN);
  assert.deepEqual(
    asCustomer.map((item) => item.id),
    [invoice.id],
  );
  const own = asCustomer.find((item) => item.id === invoice.id)!;
  assert.equal(own.outstandingMinor, 0);
  assert.equal(own.payments, undefined);

  const pdfPath = (id: string) => `/api/v1/jobs/${jobA}/invoices/${id}/pdf`;
  const staffPdf = await get(pdfPath(invoice.id));
  assert.equal(staffPdf.status, 200);
  assert.equal(staffPdf.headers.get("content-type"), "application/pdf");
  assert.match(
    staffPdf.headers.get("content-disposition") ?? "",
    new RegExp(`^inline; filename="SYN-INV-${year}-0001\\.pdf"$`),
  );
  assert.equal(
    Buffer.from(await staffPdf.arrayBuffer())
      .subarray(0, 5)
      .toString("latin1"),
    "%PDF-",
  );
  assert.equal(
    (await get(pdfPath(invoice.id), TEST_CUSTOMER_A_TOKEN)).status,
    200,
  );
  assert.equal(
    (await get(pdfPath(hidden.id), TEST_CUSTOMER_A_TOKEN)).status,
    404,
  );
  assert.equal(
    (await get(pdfPath(voidedDraftId), TEST_CUSTOMER_A_TOKEN)).status,
    404,
  );
  assert.equal((await get(pdfPath(hidden.id))).status, 200);

  for (const token of [TEST_CUSTOMER_B_TOKEN, TEST_UNASSIGNED_TOKEN]) {
    assert.equal(
      (await get(`/api/v1/jobs/${jobA}/invoices`, token)).status,
      404,
    );
    assert.equal((await get(pdfPath(invoice.id), token)).status, 404);
  }
  assert.equal(
    (
      await get(
        `/api/v1/jobs/${jobB}/invoices/${invoice.id}/pdf`,
        TEST_SUPER_ADMIN_TOKEN,
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await post(`/api/v1/jobs/${jobA}/invoices`, TEST_CUSTOMER_A_TOKEN, {
        currency: "GHS",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await post(
        `/api/v1/jobs/${jobA}/invoices/${invoice.id}/payments`,
        TEST_CUSTOMER_A_TOKEN,
        {
          amountMinor: 1,
          receivedOn: daysFromNow(0),
          method: "cash",
        },
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await post(
        `/api/v1/jobs/${jobA}/invoices/${invoice.id}/issue`,
        TEST_UNASSIGNED_TOKEN,
        {},
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await post(
        `/api/v1/jobs/${jobA}/invoices/${hidden.id}/void`,
        TEST_MATCHING_TOKEN,
        { reason: "tidy" },
      )
    ).status,
    201,
  );
});

test("an invoice starts from the job's charges and a void invoice takes no payments", async () => {
  const chargesPath = `/api/v1/jobs/${jobA}/charges`;
  const fromCharges = (body: unknown) =>
    post(
      `/api/v1/jobs/${jobA}/invoices/from-charges`,
      TEST_MATCHING_TOKEN,
      body,
    );
  const none = await fromCharges({ currency: "GHS" });
  assert.equal(none.status, 409);
  assert.match(
    await message(none),
    /No charge on this job has an amount in GHS/,
  );

  await post(chargesPath, TEST_MATCHING_TOKEN, {
    kind: "service",
    description: "BJH service fee",
    currency: "GHS",
    unitQuotedMinor: 150000,
  });
  const disbursement = (await (
    await post(chargesPath, TEST_MATCHING_TOKEN, {
      kind: "disbursement",
      description: "Terminal handling",
      currency: "GHS",
      quantity: 2,
      unitQuotedMinor: 25000,
    })
  ).json()) as { id: string };
  await post(`${chargesPath}/${disbursement.id}/actuals`, TEST_MATCHING_TOKEN, {
    amountMinor: 48000,
    currency: "GHS",
  });
  await post(chargesPath, TEST_MATCHING_TOKEN, {
    kind: "disbursement",
    description: "Unpriced",
    currency: "GHS",
  });
  await post(chargesPath, TEST_MATCHING_TOKEN, {
    kind: "service",
    description: "Other currency",
    currency: "USD",
    unitQuotedMinor: 1000,
  });

  const created = await fromCharges({
    currency: "GHS",
    dueDate: daysFromNow(5),
  });
  assert.equal(created.status, 201);
  const body = (await created.json()) as { invoice: Invoice; skipped: number };
  assert.equal(body.skipped, 1);
  assert.deepEqual(
    body.invoice.lines.map((line) => [line.description, line.amountMinor]),
    [
      ["BJH service fee", 150000],
      // The actual amount replaces the quote (2 x 250.00 = 500.00 quoted, 480.00 actual).
      ["Terminal handling", 48000],
    ],
  );
  assert.equal(body.invoice.subtotalMinor, 198000);
  assert.equal(body.invoice.dueDate, daysFromNow(5));

  const issued = (await (
    await post(
      `/api/v1/jobs/${jobA}/invoices/${body.invoice.id}/issue`,
      TEST_MATCHING_TOKEN,
      {},
    )
  ).json()) as Invoice;
  // The unused draft consumed no number: this is the second issued invoice.
  assert.equal(issued.invoiceNumber, `SYN/INV/${year}/0002`);
  assert.equal(issued.dueDate, daysFromNow(5));

  const voided = await post(
    `/api/v1/jobs/${jobA}/invoices/${issued.id}/void`,
    TEST_MATCHING_TOKEN,
    { reason: "Wrong customer" },
  );
  assert.equal(voided.status, 201);
  const voidInvoice = (await voided.json()) as Invoice;
  assert.equal(voidInvoice.status, "void");
  assert.equal(voidInvoice.voidReason, "Wrong customer");
  assert.equal(voidInvoice.outstandingMinor, 0);
  assert.equal(voidInvoice.invoiceNumber, `SYN/INV/${year}/0002`);

  const payment = await post(
    `/api/v1/jobs/${jobA}/invoices/${issued.id}/payments`,
    TEST_MATCHING_TOKEN,
    { amountMinor: 100, receivedOn: daysFromNow(0), method: "cash" },
  );
  assert.equal(payment.status, 409);
  assert.equal(
    await message(payment),
    "Payments can only be recorded against an issued invoice",
  );
  assert.equal(
    (
      await post(
        `/api/v1/jobs/${jobA}/invoices/${issued.id}/void`,
        TEST_MATCHING_TOKEN,
        {
          reason: "again",
        },
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await get(
        `/api/v1/jobs/${jobA}/invoices/${issued.id}/pdf`,
        TEST_CUSTOMER_A_TOKEN,
      )
    ).status,
    200,
  );
});

test("an at-cost charge with a GHS actual is billed on the GHS invoice, never twice", async () => {
  const chargesPath = `/api/v1/jobs/${jobA}/charges`;
  const fromCharges = (currency: string) =>
    post(`/api/v1/jobs/${jobA}/invoices/from-charges`, TEST_MATCHING_TOKEN, {
      currency,
    });
  // Imported from a USD quote "at cost"; the cost is recorded in GHS.
  const atCost = (await (
    await post(chargesPath, TEST_MATCHING_TOKEN, {
      kind: "disbursement",
      description: "Shipping line DO fee",
      currency: "USD",
    })
  ).json()) as { id: string };
  await post(`${chargesPath}/${atCost.id}/actuals`, TEST_MATCHING_TOKEN, {
    amountMinor: 45000,
    currency: "GHS",
  });

  type FromCharges = {
    invoice: Invoice;
    skipped: number;
    leftOut: { description: string; reason: string; currency?: string }[];
  };
  const usd = (await (await fromCharges("USD")).json()) as FromCharges;
  assert.deepEqual(
    usd.invoice.lines.map((line) => [line.description, line.amountMinor]),
    [["Other currency", 1000]],
  );
  assert.deepEqual(
    usd.leftOut.find((item) => item.description === "Shipping line DO fee"),
    {
      description: "Shipping line DO fee",
      reason: "other_currency",
      currency: "GHS",
    },
  );
  assert.deepEqual(
    usd.leftOut.find((item) => item.description === "Unpriced"),
    { description: "Unpriced", reason: "no_amount" },
  );
  assert.equal(usd.skipped, 1);

  const ghs = (await (await fromCharges("GHS")).json()) as FromCharges;
  const ghsLines = ghs.invoice.lines.map((line) => line.description);
  assert.ok(ghsLines.includes("Shipping line DO fee"));
  assert.ok(!ghsLines.includes("Other currency"));
  assert.equal(
    ghs.invoice.lines.find(
      (line) => line.description === "Shipping line DO fee",
    )?.amountMinor,
    45000,
  );
});

test("payments still arrive after a job is closed, but invoices cannot change", async () => {
  const draft = (await (
    await post(`/api/v1/jobs/${jobC}/invoices`, TEST_MATCHING_TOKEN, {
      currency: "GHS",
      lines: [{ description: "Fee", amountMinor: 100000 }],
    })
  ).json()) as Invoice;
  const issued = (await (
    await post(
      `/api/v1/jobs/${jobC}/invoices/${draft.id}/issue`,
      TEST_MATCHING_TOKEN,
      {},
    )
  ).json()) as Invoice;

  for (const status of ["in_progress", "ready_to_close", "closed"]) {
    const response = await post(
      `/api/v1/jobs/${jobC}/status`,
      TEST_MATCHING_TOKEN,
      { status },
    );
    assert.equal(response.status, 201, status);
  }
  const blocked = await post(
    `/api/v1/jobs/${jobC}/invoices`,
    TEST_MATCHING_TOKEN,
    {
      currency: "GHS",
    },
  );
  assert.equal(blocked.status, 409);
  assert.equal(await message(blocked), "Reopen the job before changing it");
  assert.equal(
    (
      await post(
        `/api/v1/jobs/${jobC}/invoices/${issued.id}/void`,
        TEST_MATCHING_TOKEN,
        {
          reason: "late",
        },
      )
    ).status,
    409,
  );

  const late = await post(
    `/api/v1/jobs/${jobC}/invoices/${issued.id}/payments`,
    TEST_MATCHING_TOKEN,
    {
      amountMinor: 40000,
      receivedOn: daysFromNow(0),
      method: "cheque",
      reference: "CHQ 0042",
    },
  );
  assert.equal(late.status, 201);
  const [after] = await invoicesOf(jobC);
  assert.equal(after.outstandingMinor, 60000);
});

test("each payment gets a numbered receipt; staff and the client's own accounts can print it", async () => {
  const [current] = await invoicesOf(jobA);
  const payments = current.payments ?? [];
  assert.ok(payments.length >= 3);
  const numbers = payments.map((item) => item.receiptNumber);
  assert.deepEqual(
    numbers,
    payments.map(
      (_, index) => `SYN/RCT/${year}/${String(index + 1).padStart(4, "0")}`,
    ),
  );

  const receiptPath = (paymentId: string, invoiceId = invoice.id, job = jobA) =>
    `/api/v1/jobs/${job}/invoices/${invoiceId}/payments/${paymentId}/receipt`;
  const [first] = payments;
  const printed = await get(receiptPath(first.id));
  assert.equal(printed.status, 200);
  assert.equal(printed.headers.get("content-type"), "application/pdf");
  assert.match(
    printed.headers.get("content-disposition") ?? "",
    new RegExp(`^inline; filename="SYN-RCT-${year}-0001\\.pdf"$`),
  );
  assert.equal(
    Buffer.from(await printed.arrayBuffer())
      .subarray(0, 5)
      .toString("latin1"),
    "%PDF-",
  );
  // A reversed payment keeps its receipt, stamped as reversed.
  const reversed = payments.find((item) => item.reversal);
  assert.ok(reversed);
  assert.equal((await get(receiptPath(reversed.id))).status, 200);

  // Clients get their own receipts (client meeting, 2026-11-01); another
  // company's job is not found for them.
  assert.equal(
    (await get(receiptPath(first.id), TEST_CUSTOMER_A_TOKEN)).status,
    200,
  );
  assert.equal(
    (await get(receiptPath(first.id), TEST_CUSTOMER_B_TOKEN)).status,
    404,
  );
  assert.equal(
    (await get(receiptPath(first.id), TEST_UNASSIGNED_TOKEN)).status,
    404,
  );
  assert.equal((await get(receiptPath(randomUUID()))).status, 404);
  assert.equal((await get(receiptPath("not-a-uuid"))).status, 404);
  assert.equal((await get(receiptPath(first.id, randomUUID()))).status, 404);
  assert.equal(
    (await get(receiptPath(first.id, invoice.id, jobB), TEST_SUPER_ADMIN_TOKEN))
      .status,
    404,
  );
});
