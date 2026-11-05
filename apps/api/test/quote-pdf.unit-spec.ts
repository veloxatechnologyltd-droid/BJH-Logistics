import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  QuoteLineRecord,
  QuoteRecord,
  QuoteVersionRecord,
} from "../src/database/database.port";
import {
  formatQuoteAmount,
  groupLines,
  quoteDraftReason,
  renderQuotePdf,
} from "../src/quotations/quote-pdf";

const line = (
  position: number,
  over: Partial<QuoteLineRecord>,
): QuoteLineRecord => ({
  id: `line-${position}`,
  position,
  section: "Charges",
  description: "Fee",
  details: null,
  basis: "fixed",
  basisNote: null,
  amountMinor: 100,
  quantity: 1,
  containerSize: null,
  sizeAmountsMinor: null,
  ...over,
});

const version = (
  over: Partial<QuoteVersionRecord> = {},
): QuoteVersionRecord => ({
  id: "version",
  versionNumber: 1,
  status: "issued",
  currency: "USD",
  title: "Synthetic quotation",
  subtitle: null,
  shipmentScope: "20ft FCL",
  intro: null,
  atCostNote: null,
  procedureSteps: ["Review documents"],
  requiredDocuments: ["Packing list"],
  documentsNote: null,
  timeline: null,
  terms: ["Synthetic term."],
  sizeLabels: [],
  bankAccounts: null,
  createdBy: "user",
  createdByAssistant: false,
  createdAt: "2026-09-22T09:00:00.000Z",
  updatedAt: "2026-09-22T09:00:00.000Z",
  issuedBy: "user",
  issuedAt: "2026-09-22T10:00:00.000Z",
  lines: [
    line(0, { description: "Port handling fee", amountMinor: 25050 }),
    line(1, {
      description: "Customs duty",
      basis: "at_cost",
      amountMinor: null,
      basisNote: "Based on HS code",
    }),
  ],
  ...over,
});

const quote = (v: QuoteVersionRecord): QuoteRecord => ({
  id: "quote",
  quoteNumber: "SYN/Q/SI/2026/0001",
  serviceLine: "sea_import",
  customerCompanyId: "company",
  customerCompanyName: "Harbor Demo Ltd",
  quoteRequestId: null,
  createdBy: "user",
  createdByAssistant: false,
  createdAt: "2026-09-22T09:00:00.000Z",
  versions: [v],
  decisions: [],
  jobId: null,
});

const settings = {
  issuer: {
    name: "Synthetic Forwarding Ltd",
    address: null,
    phone: null,
    email: null,
    website: null,
  },
  currencies: ["USD"],
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

test("amounts are shown like the sample quotations", () => {
  assert.equal(formatQuoteAmount(25000, "USD"), "$250");
  assert.equal(formatQuoteAmount(150050, "GHS"), "GHS 1,500.50");
  assert.equal(formatQuoteAmount(380000, "GHS"), "GHS 3,800");
});

test("a copy is a draft until it is issued and the settings are configured", () => {
  const issued = version();
  assert.equal(
    quoteDraftReason({ quote: quote(issued), version: issued, settings }),
    null,
  );
  assert.equal(
    quoteDraftReason({ quote: quote(issued), version: issued, settings: null }),
    "Draft - business settings not configured",
  );
  const draft = version({ status: "draft", issuedAt: null, issuedBy: null });
  assert.equal(
    quoteDraftReason({ quote: quote(draft), version: draft, settings }),
    "Draft - not yet issued",
  );
});

test("charge lines are grouped under their headings in order", () => {
  const groups = groupLines([
    line(0, { section: "Clearance" }),
    line(1, { section: "Clearance" }),
    line(2, { section: "Transport" }),
    line(3, { section: null }),
  ]);
  assert.deepEqual(
    groups.map((group) => [group.heading, group.lines.length]),
    [
      ["Clearance", 2],
      ["Transport", 1],
      ["Charges", 1],
    ],
  );
});

test("the PDF carries the quote content and the issuer from the settings", async () => {
  const v = version();
  const file = await renderQuotePdf(
    { quote: quote(v), version: v, settings },
    { compress: false },
  );
  assert.equal(file.subarray(0, 5).toString(), "%PDF-");
  const text = pdfText(file);
  for (const expected of [
    "Synthetic Forwarding Ltd",
    "Synthetic quotation",
    "SYN/Q/SI/2026/0001 (version 1)",
    "Harbor Demo Ltd",
    "Port handling fee",
    "$250.50",
    "Based on HS code",
    "1. Review documents",
    "Accepted by client",
  ]) {
    assert.ok(text.includes(expected), `missing: ${expected}`);
  }
  assert.ok(!text.includes("DRAFT"));
});

test("the PDF prints quote-specific container sizes and single-amount lines", async () => {
  const v = version({
    sizeLabels: ["20ft", "50ft"],
    lines: [
      line(0, {
        description: "Container handling",
        amountMinor: null,
        sizeAmountsMinor: [1000, 2500],
      }),
      line(1, { description: "Documentation", amountMinor: 5000 }),
    ],
  });
  const file = await renderQuotePdf(
    { quote: quote(v), version: v, settings },
    { compress: false },
  );
  const text = pdfText(file);
  for (const expected of [
    "20ft",
    "50ft",
    "Container handling",
    "$10",
    "$25",
    "Documentation",
    "$50",
  ]) {
    assert.ok(text.includes(expected), `missing: ${expected}`);
  }
});

test("a draft copy is marked on the page", async () => {
  const v = version();
  const file = await renderQuotePdf(
    { quote: quote(v), version: v, settings: null },
    { compress: false },
  );
  const text = pdfText(file);
  assert.ok(text.includes("DRAFT"));
  assert.ok(text.includes("DRAFT - BUSINESS SETTINGS NOT CONFIGURED"));
  assert.ok(text.includes("Issuer details not configured"));
});

test("a charge's description is printed under its name", async () => {
  const v = version({
    lines: [
      line(0, {
        description: "Port handling fee",
        details: "Covers terminal handling and gate-in",
      }),
    ],
  });
  const file = await renderQuotePdf(
    { quote: quote(v), version: v, settings },
    { compress: false },
  );
  const text = pdfText(file);
  assert.ok(text.includes("Port handling fee"));
  assert.ok(text.includes("Covers terminal handling and gate-in"));
});

const quoteAccount = {
  id: "5f0f2b9e-0a53-4f3e-9d57-1a2b3c4d5e02",
  bankName: "Synthetic Bank",
  branch: null,
  accountName: "Synthetic Forwarding Ltd",
  accountNumber: "0002000200020",
  currency: "USD",
  swiftCode: "SYNTGHAC",
  address: null,
};

test("a quote prints the bank account chosen for it, else the one in its currency, and carries the logo", async () => {
  const chosen = version({ bankAccounts: [quoteAccount] });
  const file = await renderQuotePdf(
    { quote: quote(chosen), version: chosen, settings },
    { compress: false },
  );
  const text = pdfText(file);
  for (const expected of [
    "BANK PAYMENT DETAILS",
    "Account number",
    "(USD)",
    "0002000200020",
    "SYNTGHAC",
  ]) {
    assert.ok(text.includes(expected), `missing: ${expected}`);
  }
  assert.ok(file.toString("latin1").includes("/Subtype /Image"));

  const plain = version();
  const fromSettings = pdfText(
    await renderQuotePdf(
      {
        quote: quote(plain),
        version: plain,
        settings: { ...settings, bankAccounts: [quoteAccount] },
      },
      { compress: false },
    ),
  );
  assert.ok(fromSettings.includes("0002000200020"));

  const none = pdfText(
    await renderQuotePdf(
      { quote: quote(plain), version: plain, settings },
      { compress: false },
    ),
  );
  assert.ok(!none.includes("BANK PAYMENT DETAILS"));
});
