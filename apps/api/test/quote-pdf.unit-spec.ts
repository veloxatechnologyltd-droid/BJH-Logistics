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
  withoutListMarker,
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

test("only unconfigured settings mark a copy; a draft version prints clean", () => {
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
    null,
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
    "250.50",
    "At cost - Based on HS code",
    "1. Review documents",
    "Accepted by client",
  ]) {
    // A cell that wraps is drawn one line at a time.
    assert.ok(
      text.replace(/\s+/g, " ").includes(expected),
      `missing: ${expected}`,
    );
  }
  assert.ok(!text.includes("DRAFT"));
});

test("charges print as Charge, Qty, Unit price, Total amount with the currency in the titles", async () => {
  const unit = version({
    currency: "GHS",
    lines: [
      line(0, { description: "Port handling fee", amountMinor: 150050 }),
      line(1, {
        description: "Customs duty",
        basis: "at_cost",
        amountMinor: 380000,
        basisNote: "Based on HS code",
      }),
    ],
  });
  const sized = version({
    currency: "GHS",
    sizeLabels: ["20ft", "40ft"],
    lines: [
      line(0, {
        description: "Haulage",
        basis: "at_cost",
        amountMinor: null,
        sizeAmountsMinor: [250000, 400000],
      }),
    ],
  });
  const unitText = pdfText(
    await renderQuotePdf(
      { quote: quote(unit), version: unit, settings },
      { compress: false },
    ),
  );
  const sizedText = pdfText(
    await renderQuotePdf(
      { quote: quote(sized), version: sized, settings },
      { compress: false },
    ),
  );
  for (const expected of [
    "Charge",
    "Qty",
    "Unit price (GHS)",
    "Total amount (GHS)",
    "1,500.50",
    "3,800",
    "At cost - Based on HS code",
  ]) {
    assert.ok(
      unitText.replace(/\s+/g, " ").includes(expected),
      `missing: ${expected}`,
    );
  }
  // An older quote priced per size column prints one row per size.
  for (const expected of [
    "Unit price (GHS)",
    "Haulage (20ft)",
    "Haulage (40ft)",
    "2,500",
    "4,000",
  ]) {
    assert.ok(
      sizedText.replace(/\s+/g, " ").includes(expected),
      `missing: ${expected}`,
    );
  }
  for (const text of [unitText, sizedText]) {
    // Only the total under the table carries the currency with a figure.
    const cells = text.split("\n").filter((cell) => !cell.startsWith("Total:"));
    assert.ok(!cells.some((cell) => /GHS \d/.test(cell)), "currency in a cell");
    // "At cost" stays in the basis column, never in front of a figure.
    assert.ok(
      !/At cost - (GHS )?\d/.test(text.replace(/\s+/g, " ")),
      "At cost in a price cell",
    );
  }
});

test("text pasted from Word with tabs prints readably", async () => {
  const v = version({
    procedureSteps: ["1.\tSubmit shipment documents"],
    requiredDocuments: ["•\tBill of lading or Sea waybill"],
  });
  const file = await renderQuotePdf(
    { quote: quote(v), version: v, settings },
    { compress: false },
  );
  const text = pdfText(file);
  for (const expected of [
    "1. Submit shipment documents",
    "- Bill of lading or Sea waybill",
  ]) {
    assert.ok(text.includes(expected), `missing: ${expected}`);
  }
});

test("a number or bullet pasted with a list item is not printed twice", () => {
  assert.equal(withoutListMarker("1.\tSubmit documents"), "Submit documents");
  assert.equal(withoutListMarker("2) Pay duties"), "Pay duties");
  assert.equal(withoutListMarker("\u2022\tPacking list"), "Packing list");
  assert.equal(withoutListMarker("\uf0b7Packing list"), "Packing list");
  assert.equal(withoutListMarker("- Packing list"), "Packing list");
  for (const kept of [
    "1.5 tonnes max",
    "20ft container",
    "-5C reefer",
    "Packing list",
  ]) {
    assert.equal(withoutListMarker(kept), kept);
  }
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
    "Unit price (USD)",
    "Total amount (USD)",
    "Container handling (20ft)",
    "Container handling (50ft)",
    "10",
    "25",
    "Documentation",
    "50",
  ]) {
    assert.ok(
      text.replace(/\s+/g, " ").includes(expected),
      `missing: ${expected}`,
    );
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
    "PAYMENT DETAILS",
    "USD account:",
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
  assert.ok(!none.includes("PAYMENT DETAILS"));
});
