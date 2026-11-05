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
import {
  renderBatchReceiptPdf,
  renderReceiptPdf,
} from "../src/finance/receipt-pdf";
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
  vessel: null,
  portOfLoading: null,
  portOfDischarge: null,
  goodsDescription: null,
  remarks: null,
  expectedCompletionDate: null,
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
  bankAccounts: null,
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
  creditId: null,
  batchId: null,
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

test("one payment across several invoices gets one receipt listing them all", async () => {
  const line = (
    invoiceNumber: string,
    amountMinor: number,
    outstanding: number,
    over: Partial<InvoicePaymentRecord> = {},
  ) => ({
    payment: payment({ amountMinor, batchId: "batch", ...over }),
    invoiceNumber,
    jobId: "job",
    fileNumber: "SYN/SI/2026/0001",
    customerCompanyId: "company",
    customerCompanyName: "Harbor Demo Ltd",
    currency: "GHS",
    invoiceTotalMinor: 100000,
    invoiceOutstandingMinor: outstanding,
  });
  const lines = [
    line("SYN/INV/2026/0001", 100000, 0),
    line("SYN/INV/2026/0002", 40000, 60000),
  ];
  const text = pdfText(
    await renderBatchReceiptPdf({ lines, settings }, { compress: false }),
  );
  for (const expected of [
    "SYN/RCT/2026/0001",
    "GHS 1,400.00",
    "Harbor Demo Ltd",
    "SYN/INV/2026/0001",
    "SYN/INV/2026/0002",
    "GHS 400.00",
    "GHS 600.00",
    "TXN-42",
  ]) {
    assert.ok(text.includes(expected), `missing: ${expected}`);
  }
  assert.ok(!text.includes("REVERSED"));

  // One invoice's payment reversed: that line says so, the receipt stands.
  const reversal = {
    reason: "Wrong invoice",
    reversedBy: "user",
    reversedAt: "2026-09-27T09:00:00.000Z",
  };
  const partly = pdfText(
    await renderBatchReceiptPdf(
      {
        lines: [
          lines[0],
          line("SYN/INV/2026/0002", 40000, 100000, { reversal }),
        ],
        settings,
      },
      { compress: false },
    ),
  );
  assert.ok(partly.includes("(reversed)"));
  assert.ok(!partly.includes("REVERSED - "));
});

const ghsAccount = {
  id: "5f0f2b9e-0a53-4f3e-9d57-1a2b3c4d5e01",
  bankName: "Synthetic Bank",
  branch: "Main branch",
  accountName: "Synthetic Forwarding Ltd",
  accountNumber: "0001000100010",
  currency: "GHS",
  swiftCode: "SYNTGHAC",
  address: "1 Test Road",
};
const usdAccount = {
  ...ghsAccount,
  id: "5f0f2b9e-0a53-4f3e-9d57-1a2b3c4d5e02",
  accountNumber: "0002000200020",
  currency: "USD",
  swiftCode: null,
};

test("an invoice prints the bank account chosen for it, and carries the logo", async () => {
  const file = await renderInvoicePdf(
    { invoice: invoice({ bankAccounts: [usdAccount] }), job, settings },
    { compress: false },
  );
  const text = pdfText(file);
  for (const expected of [
    "BANK PAYMENT DETAILS",
    "Synthetic Bank",
    "Account number",
    "(USD)",
    "0002000200020",
  ]) {
    assert.ok(text.includes(expected), `missing: ${expected}`);
  }
  assert.ok(!text.includes("SWIFT code"), "an empty detail is left out");
  assert.ok(file.toString("latin1").includes("/Subtype /Image"));
});

test("an invoice with no chosen account prints the one in its currency, or none", async () => {
  const listed = { ...settings, bankAccounts: [usdAccount, ghsAccount] };
  const text = pdfText(
    await renderInvoicePdf(
      { invoice: invoice(), job, settings: listed },
      { compress: false },
    ),
  );
  assert.ok(text.includes("0001000100010"), "the GHS account");
  assert.ok(text.includes("SYNTGHAC"));
  assert.ok(!text.includes("0002000200020"), "not the USD account");

  const none = pdfText(
    await renderInvoicePdf(
      { invoice: invoice(), job, settings },
      { compress: false },
    ),
  );
  assert.ok(!none.includes("BANK PAYMENT DETAILS"));
});

test("an invoice prints several accounts in one box, a bank's currencies together", async () => {
  const uba = {
    ...ghsAccount,
    bankName: "United Bank for Africa",
    accountNumber: "00315953503516",
    isDefault: true,
  };
  const ubaUsd = {
    ...uba,
    id: "5f0f2b9e-0a53-4f3e-9d57-1a2b3c4d5e03",
    accountNumber: "00315953504230",
    currency: "USD",
  };
  const momo = {
    ...ghsAccount,
    id: "5f0f2b9e-0a53-4f3e-9d57-1a2b3c4d5e04",
    bankName: "MTN Mobile Money",
    branch: null,
    accountNumber: "663057",
    swiftCode: null,
    address: null,
    isDefault: true,
  };
  const listed = { ...settings, bankAccounts: [uba, ubaUsd, momo, usdAccount] };

  // Kept on the invoice: exactly those, one box, bank details printed once per bank.
  const kept = pdfText(
    await renderInvoicePdf(
      {
        invoice: invoice({ bankAccounts: [uba, ubaUsd, momo] }),
        job,
        settings,
      },
      { compress: false },
    ),
  );
  assert.equal(kept.split("BANK PAYMENT DETAILS").length - 1, 1);
  for (const expected of [
    "United Bank for Africa",
    "00315953503516",
    "00315953504230",
    "(GHS)",
    "(USD)",
    "MTN Mobile Money",
    "663057",
  ]) {
    assert.ok(kept.includes(expected), `missing: ${expected}`);
  }
  assert.equal(kept.split("United Bank for Africa").length - 1, 1);

  // An older invoice with none kept prints today's defaults, not the other accounts.
  const fallback = pdfText(
    await renderInvoicePdf(
      { invoice: invoice(), job, settings: listed },
      { compress: false },
    ),
  );
  assert.ok(fallback.includes("663057") && fallback.includes("00315953504230"));
  assert.ok(!fallback.includes("0002000200020"), "not the unmarked account");

  // Saved with no account ticked: no box, even though Settings has defaults.
  const none = pdfText(
    await renderInvoicePdf(
      { invoice: invoice({ bankAccounts: [] }), job, settings: listed },
      { compress: false },
    ),
  );
  assert.ok(!none.includes("BANK PAYMENT DETAILS"));
});
