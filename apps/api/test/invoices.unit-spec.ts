import assert from "node:assert/strict";
import { test } from "node:test";
import type { JobRecord } from "../src/database/database.port";
import { computeInvoiceTotals } from "../src/finance/invoice-totals";
import {
  formatInvoiceAmount,
  formatRate,
  invoiceDraftReason,
  renderInvoicePdf,
} from "../src/finance/invoice-pdf";
import { renderReceiptPdf } from "../src/finance/receipt-pdf";
import type { InvoiceView } from "../src/finance/invoices.service";
import type { InvoicePaymentRecord } from "../src/database/database.port";

const levies = [
  { name: "NHIL", rateBasisPoints: 250 },
  { name: "GETFL", rateBasisPoints: 250 },
  { name: "VAT", rateBasisPoints: 1500 },
];

test("the port invoice in the client's samples reproduces to the pesewa", () => {
  // Shore handling 1,381.90 + transport 1,015.90; NHIL 2.5%, GETFL 2.5%, VAT 15%.
  const totals = computeInvoiceTotals(
    [
      { amountMinor: 138190, taxable: true },
      { amountMinor: 101590, taxable: true },
    ],
    levies,
  );
  assert.equal(totals.subtotalMinor, 239780);
  assert.deepEqual(
    totals.taxLines.map((line) => line.amountMinor),
    [5995, 5995, 35967],
  );
  // The total takes the tax once from the combined rate: 2,877.36, one
  // pesewa under the sum of the printed (rounded) lines, as on the sample.
  assert.equal(totals.taxTotalMinor, 47956);
  assert.equal(totals.totalMinor, 287736);
});

test("tax applies only to taxable lines and is never compounded", () => {
  const totals = computeInvoiceTotals(
    [
      { amountMinor: 100000, taxable: true },
      { amountMinor: 50000, taxable: false },
    ],
    [{ name: "VAT", rateBasisPoints: 1500 }],
  );
  assert.equal(totals.subtotalMinor, 150000);
  assert.equal(totals.taxTotalMinor, 15000);
  assert.equal(totals.totalMinor, 165000);
});

test("no tax lines, no lines and huge amounts stay exact", () => {
  assert.equal(
    computeInvoiceTotals([{ amountMinor: 12345, taxable: true }], [])
      .totalMinor,
    12345,
  );
  assert.equal(computeInvoiceTotals([], levies).totalMinor, 0);
  const big = computeInvoiceTotals(
    Array.from({ length: 100 }, () => ({
      amountMinor: 1_000_000_000_000,
      taxable: true,
    })),
    [{ name: "VAT", rateBasisPoints: 1500 }],
  );
  assert.equal(big.subtotalMinor, 100_000_000_000_000);
  assert.equal(big.totalMinor, 115_000_000_000_000);
});

test("half a minor unit rounds up", () => {
  // 0.5 pesewa of tax on 0.10 at 5%: 10 * 500 / 10000 = 0.5 -> 1.
  const totals = computeInvoiceTotals(
    [{ amountMinor: 10, taxable: true }],
    [{ name: "X", rateBasisPoints: 500 }],
  );
  assert.equal(totals.taxTotalMinor, 1);
});

test("amounts always show two decimals and rates drop trailing zeros", () => {
  assert.equal(formatInvoiceAmount(239780, "GHS"), "GHS 2,397.80");
  assert.equal(formatInvoiceAmount(380000, "GHS"), "GHS 3,800.00");
  assert.equal(formatRate(250), "2.5%");
  assert.equal(formatRate(1500), "15%");
});

const job: JobRecord = {
  id: "job",
  fileNumber: "SYN/SI/2026/0001",
  serviceLine: "sea_import",
  customerCompanyId: "company",
  customerCompanyName: "Harbor Demo Ltd",
  quoteRequestId: null,
  quoteId: null,
  status: "open",
  openedBy: "user",
  openedAt: "2026-09-20T09:00:00.000Z",
  closedAt: null,
};

const invoice = (over: Partial<InvoiceView> = {}): InvoiceView => ({
  id: "invoice",
  jobId: "job",
  invoiceNumber: "SYN/INV/2026/0001",
  status: "issued",
  currency: "GHS",
  lines: [
    { description: "Shore handling", amountMinor: 138190, taxable: true },
    { description: "Transport charge", amountMinor: 101590, taxable: true },
  ],
  dueDate: "2026-10-22",
  notes: "Thank you for your business.",
  subtotalMinor: 239780,
  taxLines: [
    { name: "NHIL", rateBasisPoints: 250, amountMinor: 5995 },
    { name: "GETFL", rateBasisPoints: 250, amountMinor: 5995 },
    { name: "VAT", rateBasisPoints: 1500, amountMinor: 35967 },
  ],
  taxTotalMinor: 47956,
  totalMinor: 287736,
  createdBy: "user",
  createdAt: "2026-09-22T09:00:00.000Z",
  updatedAt: "2026-09-22T09:00:00.000Z",
  issuedBy: "user",
  issuedAt: "2026-09-22T10:00:00.000Z",
  voidedBy: null,
  voidedAt: null,
  voidReason: null,
  paidMinor: 100000,
  outstandingMinor: 187736,
  paymentStatus: "partial",
  acceptance: null,
  ...over,
});

const settings = {
  issuer: {
    name: "Synthetic Forwarding Ltd",
    address: null,
    phone: null,
    email: null,
    website: null,
  },
  currencies: ["GHS"],
  taxLines: [],
  paymentTermsDays: null,
  numbering: {
    quotePrefix: "SYN/Q",
    invoicePrefix: "SYN/INV",
    receiptPrefix: "SYN/RCT",
    waybillPrefix: "SYN/WB",
  },
  quoteDefaults: {
    intro: null,
    atCostNote: null,
    procedureSteps: [],
    requiredDocuments: [],
    documentsNote: null,
    timeline: null,
    terms: [],
  },
  notifications: { channels: "both" as const },
};

/** The text drawn on the pages of an uncompressed pdfkit document. */
function pdfText(file: Buffer): string {
  const source = file.toString("latin1");
  const drawn: string[] = [];
  for (const match of source.matchAll(/\[([^\]]*)\]\s*TJ/g)) {
    drawn.push(
      [...match[1].matchAll(/<([0-9a-f]+)>/gi)]
        .map((hex) => Buffer.from(hex[1], "hex").toString("latin1"))
        .join(""),
    );
  }
  return drawn.join("\n");
}

test("an issued invoice prints its lines, tax lines, total and balance", async () => {
  const file = await renderInvoicePdf(
    { invoice: invoice(), job, settings },
    { compress: false },
  );
  assert.equal(file.subarray(0, 5).toString("latin1"), "%PDF-");
  const text = pdfText(file);
  for (const expected of [
    "SYN/INV/2026/0001",
    "Harbor Demo Ltd",
    "SYN/SI/2026/0001",
    "Shore handling",
    "GHS 1,381.90",
    "NHIL 2.5%",
    "VAT 15%",
    "GHS 359.67",
    "GHS 2,877.36",
    "Balance due",
    "GHS 1,877.36",
    "Thank you for your business.",
  ]) {
    assert.ok(text.includes(expected), `missing: ${expected}`);
  }
  assert.ok(!text.includes("DRAFT"));
});

test("drafts and unconfigured settings are marked, and void invoices say why", async () => {
  assert.equal(invoiceDraftReason({ invoice: invoice(), job, settings }), null);
  assert.equal(
    invoiceDraftReason({
      invoice: invoice({ status: "draft", invoiceNumber: null }),
      job,
      settings,
    }),
    "Draft - not yet issued",
  );
  assert.equal(
    invoiceDraftReason({ invoice: invoice(), job, settings: null }),
    "Draft - business settings not configured",
  );
  const voided = pdfText(
    await renderInvoicePdf(
      {
        invoice: invoice({
          status: "void",
          voidReason: "Wrong customer",
          paidMinor: 0,
          outstandingMinor: 0,
          paymentStatus: "void",
        }),
        job,
        settings,
      },
      { compress: false },
    ),
  );
  assert.ok(voided.includes("VOID - WRONG CUSTOMER"));
  const draft = pdfText(
    await renderInvoicePdf(
      {
        invoice: invoice({ status: "draft", invoiceNumber: null }),
        job,
        settings: null,
      },
      { compress: false },
    ),
  );
  assert.ok(draft.includes("Not yet numbered"));
  assert.ok(draft.includes("Issuer details not configured"));
});

const payment = (
  over: Partial<InvoicePaymentRecord> = {},
): InvoicePaymentRecord => ({
  id: "payment",
  invoiceId: "invoice",
  receiptNumber: "SYN/RCT/2026/0001",
  amountMinor: 100000,
  receivedOn: "2026-09-25",
  method: "bank_transfer",
  reference: "TXN-42",
  evidenceDocumentId: null,
  note: null,
  recordedBy: "user",
  recordedAt: "2026-09-25T11:00:00.000Z",
  reversal: null,
  ...over,
});

test("a receipt acknowledges the payment and never claims bank verification", async () => {
  const text = pdfText(
    await renderReceiptPdf(
      { payment: payment(), invoice: invoice(), job, settings },
      { compress: false },
    ),
  );
  for (const expected of [
    "SYN/RCT/2026/0001",
    "PAYMENT RECEIPT",
    "GHS 1,000.00",
    "Harbor Demo Ltd",
    "SYN/INV/2026/0001",
    "Bank transfer",
    "TXN-42",
    "GHS 2,877.36",
    "GHS 1,877.36",
    "It is not a bank confirmation.",
  ]) {
    assert.ok(text.includes(expected), `missing: ${expected}`);
  }
  assert.ok(
    !/verified|confirmed by the bank/i.test(
      text.replace("not a bank confirmation", ""),
    ),
  );
  assert.ok(!text.includes("REVERSED"));
});

test("a reversed payment's receipt is stamped with the reason", async () => {
  const text = pdfText(
    await renderReceiptPdf(
      {
        payment: payment({
          reversal: {
            reason: "Cheque bounced",
            reversedBy: "user",
            reversedAt: "2026-09-27T09:00:00.000Z",
          },
        }),
        invoice: invoice(),
        job,
        settings,
      },
      { compress: false },
    ),
  );
  assert.ok(text.includes("REVERSED - CHEQUE BOUNCED"));
});
