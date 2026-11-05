import PDFDocument from "pdfkit";
import { pickBankAccounts } from "@bjh/contracts";
import type { BusinessSettings, InvoiceShipment } from "@bjh/contracts";
import { drawLogo } from "../assets/logo";
import type {
  CustomerCompanyRecord,
  JobRecord,
} from "../database/database.port";
import {
  drawPaymentDetails,
  paymentDetailsHeight,
} from "../settings/bank-details-pdf";
import { amountInWords } from "./amount-words";
import type { InvoiceView } from "./invoices.service";

// Same palette as the quote and waybill PDFs.
const PRIMARY = "#0b3fae";
const INK = "#17324d";
const MUTED = "#526b7d";
const BORDER = "#d7e3ed";
const CANVAS = "#f4f8fc";
const MARK_RED = "#b3261e";

const PAGE_MARGIN = 40;
const LOGO_HEIGHT = 40;

// Print type scale (pt): body text 11, small labels 9, footer 9.
const BODY = 11;
const LABEL = 9;
// Text in the invoice's own tables.
const TEXT = 10;
// Space kept above the bottom margin for the page footer.
const FOOTER_SPACE = 24;

export interface InvoicePdfInput {
  invoice: InvoiceView;
  /** Null for an invoice made without a job. */
  job: JobRecord | null;
  /** The client billed. */
  customer: CustomerCompanyRecord;
  /** null until the business settings are configured (D03). */
  settings: BusinessSettings | null;
}

/** 239780 + GHS -> "GHS 2,397.80": always two decimals, as on an invoice. */
export function formatInvoiceAmount(minor: number, currency: string): string {
  return new Intl.NumberFormat("en", {
    style: "currency",
    currency,
    currencyDisplay: "code",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
    .format(minor / 100)
    .replace(/\p{Zs}/gu, " ");
}

/** 1000000 -> "10,000.00": the table headings already say the currency. */
function formatAmount(minor: number): string {
  return new Intl.NumberFormat("en", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(minor / 100);
}

/** 250 -> "2.5%", 1500 -> "15%". */
export function formatRate(basisPoints: number): string {
  return `${basisPoints / 100}%`;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(value));
}

/** Why the PDF carries a DRAFT mark, or null when it is a real issued copy. */
export function invoiceDraftReason(input: InvoicePdfInput): string | null {
  if (input.invoice.status === "draft") return "Draft - not yet issued";
  if (!input.settings) return "Draft - business settings not configured";
  return null;
}

export function renderInvoicePdf(
  input: InvoicePdfInput,
  options: { compress?: boolean } = {},
): Promise<Buffer> {
  const { invoice, settings } = input;
  const issuerName = settings?.issuer.name ?? "Issuer details not configured";

  const doc = new PDFDocument({
    size: "A4",
    margin: PAGE_MARGIN,
    bufferPages: true,
    compress: options.compress ?? true,
    info: {
      Title: `Invoice ${invoice.invoiceNumber ?? "(draft)"}`,
      Author: issuerName,
    },
  });
  const done = collect(doc);
  drawInvoice(doc, input);
  const range = doc.bufferedPageRange();
  markInvoicePages(doc, input, range.start, range.count, range.count);
  doc.end();
  return done;
}

function collect(doc: PDFKit.PDFDocument): Promise<Buffer> {
  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  return new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
}

/** "56" -> "56 packages"; text that already has words is left as typed. */
function withUnit(value: string, unit: string): string {
  return /^[\d.,\s]+$/.test(value) ? `${value.trim()}${unit}` : value;
}

/** The "Shipment details" rows an invoice prints, from what staff entered. */
export function shipmentRows(
  shipment: InvoiceShipment | null,
): Array<[string, string]> {
  if (!shipment) return [];
  const join = (parts: Array<string | null>, separator: string) =>
    parts.filter(Boolean).join(separator);
  const route =
    shipment.portOfLoading && shipment.portOfDischarge
      ? `${shipment.portOfLoading} to ${shipment.portOfDischarge}`
      : shipment.portOfLoading
        ? `From ${shipment.portOfLoading}`
        : shipment.portOfDischarge
          ? `To ${shipment.portOfDischarge}`
          : null;
  const rows: Array<[string, string]> = [
    [
      "Bill of lading",
      join(
        [
          shipment.billOfLading,
          shipment.billOfLadingDate
            ? formatDate(shipment.billOfLadingDate)
            : null,
        ],
        " | ",
      ),
    ],
    [
      "Vessel and route",
      join([join([shipment.vessel, shipment.voyage], " / "), route], " | "),
    ],
    [
      "Container and seal",
      join(
        [
          shipment.containerNumbers,
          shipment.containerType,
          shipment.sealNumbers ? `Seal: ${shipment.sealNumbers}` : null,
        ],
        " | ",
      ),
    ],
    ["Goods", join([shipment.goods, shipment.otherReferences], "\n")],
    [
      "Quantity and weight",
      join(
        [
          shipment.packages ? withUnit(shipment.packages, " packages") : null,
          shipment.weightKg ? withUnit(shipment.weightKg, " kg") : null,
          shipment.volumeCbm ? withUnit(shipment.volumeCbm, " CBM") : null,
        ],
        " | ",
      ),
    ],
  ];
  return rows.filter(([, value]) => value !== "");
}

/** Draws one invoice from the top of the current page (and onto new ones). */
function drawInvoice(doc: PDFKit.PDFDocument, input: InvoicePdfInput): void {
  const { invoice, customer, settings } = input;
  const issuerName = settings?.issuer.name ?? "Issuer details not configured";
  const left = PAGE_MARGIN;
  const width = doc.page.width - PAGE_MARGIN * 2;
  const bottom = () => doc.page.height - PAGE_MARGIN - FOOTER_SPACE;
  const ensure = (height: number) => {
    if (doc.y + height > bottom()) doc.addPage();
  };
  const heading = (title: string) => {
    ensure(40);
    doc.font("Helvetica-Bold").fontSize(11).fillColor(PRIMARY);
    doc.text(title, left, doc.y + 8, { width, characterSpacing: 0.5 });
    doc.y += 4;
  };

  // Logo on the left, the issuer's details beside it.
  const logoHeight = drawLogo(doc, left, PAGE_MARGIN, LOGO_HEIGHT * 1.3);
  const textX = left + width * 0.5;
  doc.font("Helvetica-Bold").fontSize(9).fillColor(INK);
  doc.text(issuerName.toUpperCase(), textX, PAGE_MARGIN + 6, {
    width: width * 0.5,
  });
  doc.font("Helvetica").fontSize(9).fillColor(INK);
  const contact = [
    settings?.issuer.address,
    settings?.issuer.phone ? `Tel / WhatsApp: ${settings.issuer.phone}` : null,
    settings?.issuer.email,
    settings?.issuer.website,
  ].filter(Boolean);
  for (const row of contact) {
    doc.text(String(row), textX, doc.y + 2, { width: width * 0.5 });
  }
  doc.y = Math.max(doc.y, PAGE_MARGIN + logoHeight) + 10;

  // Title, then the invoice's own details.
  doc.font("Helvetica-Bold").fontSize(26).fillColor("#000000");
  doc.text("INVOICE", left, doc.y, { width, align: "center" });
  doc.y += 4;
  const detail = (label: string, value: string, x: number, y: number) => {
    doc.font("Helvetica-Bold").fontSize(TEXT).fillColor("#000000");
    doc.text(`${label} `, x, y, { continued: true, lineBreak: false });
    doc.font("Helvetica").text(value, { continued: false, lineBreak: false });
  };
  detail(
    "Invoice no:",
    invoice.invoiceNumber ?? "Not yet numbered",
    left,
    doc.y,
  );
  doc.y += 16;
  const dateLine = doc.y;
  detail(
    "Invoice date:",
    invoice.issuedAt ? formatDate(invoice.issuedAt) : "Not yet issued",
    left,
    dateLine,
  );
  detail("Currency:", invoice.currency, left + 215, dateLine);
  if (invoice.dueDate) {
    detail("Due date:", formatDate(invoice.dueDate), left + 330, dateLine);
  }
  doc.y = dateLine + 18;

  // Bill to.
  heading("BILL TO");
  doc.font("Helvetica-Bold").fontSize(TEXT).fillColor("#000000");
  doc.text(customer.companyName, left, doc.y + 4, { width });
  doc.font("Helvetica").fontSize(TEXT);
  const billTo = [
    customer.billingAddress || customer.businessAddress,
    [
      customer.phone ? `Tel: ${customer.phone}` : null,
      customer.companyEmail ? `Email: ${customer.companyEmail}` : null,
    ]
      .filter(Boolean)
      .join(" | "),
  ].filter(Boolean);
  for (const row of billTo) doc.text(String(row), left, doc.y + 1, { width });

  // Shipment details: a two-column table, only the rows with something in them.
  const rows = shipmentRows(invoice.shipment);
  if (rows.length > 0) {
    heading("SHIPMENT DETAILS");
    doc.y += 4;
    const labelWidth = width * 0.3;
    for (const [label, value] of rows) {
      doc.font("Helvetica").fontSize(TEXT);
      const rowHeight =
        doc.heightOfString(value, { width: width - labelWidth - 20 }) + 12;
      ensure(rowHeight);
      const y = doc.y;
      doc
        .lineWidth(0.8)
        .rect(left, y, labelWidth, rowHeight)
        .fillAndStroke(CANVAS, BORDER);
      doc
        .lineWidth(0.8)
        .strokeColor(BORDER)
        .rect(left, y, width, rowHeight)
        .stroke();
      doc.font("Helvetica-Bold").fontSize(TEXT).fillColor("#000000");
      doc.text(label, left + 10, y + 6, { width: labelWidth - 20 });
      doc.font("Helvetica").fillColor("#000000");
      doc.text(value, left + labelWidth + 10, y + 6, {
        width: width - labelWidth - 20,
      });
      doc.y = y + rowHeight;
    }
  }

  // Charges: description, quantity (and unit price when any line has one), amount.
  heading("CHARGES");
  doc.y += 4;
  const priced = (line: InvoiceView["lines"][number]) =>
    line.quantity !== null &&
    line.quantity !== undefined &&
    line.unitAmountMinor !== null &&
    line.unitAmountMinor !== undefined;
  const showUnit = invoice.lines.some(priced);
  const columns = showUnit
    ? [
        { title: "Description", width: width * 0.42 },
        { title: "Quantity", width: width * 0.14 },
        { title: `Unit price ${invoice.currency}`, width: width * 0.22 },
        { title: `Amount ${invoice.currency}`, width: width * 0.22 },
      ]
    : [
        { title: "Description", width: width * 0.6 },
        { title: "Quantity", width: width * 0.18 },
        { title: `Amount ${invoice.currency}`, width: width * 0.22 },
      ];
  const last = columns.length - 1;
  const columnLeft = (index: number) =>
    left + columns.slice(0, index).reduce((sum, item) => sum + item.width, 0);
  const quantityText = (value: number) =>
    new Intl.NumberFormat("en-GH", { maximumFractionDigits: 3 }).format(value);
  const tableRow = (
    texts: string[],
    options: { bold?: boolean; fill?: string; height?: number } = {},
  ) => {
    doc.font(options.bold ? "Helvetica-Bold" : "Helvetica").fontSize(TEXT);
    const height =
      options.height ??
      doc.heightOfString(texts[0] || " ", { width: columns[0].width - 20 }) +
        16;
    ensure(height);
    const y = doc.y;
    columns.forEach((column, index) => {
      const x = columnLeft(index);
      doc.lineWidth(0.8).rect(x, y, column.width, height);
      if (options.fill) doc.fillAndStroke(options.fill, BORDER);
      else doc.strokeColor(BORDER).stroke();
      doc.font(options.bold ? "Helvetica-Bold" : "Helvetica").fontSize(TEXT);
      doc.fillColor("#000000");
      doc.text(texts[index] ?? "", x + 10, y + 6, {
        width: column.width - 20,
        align: index >= last ? "right" : "left",
      });
    });
    doc.y = y + height;
  };
  tableRow(
    columns.map((column) => column.title),
    { bold: true, fill: CANVAS },
  );
  for (const line of invoice.lines) {
    tableRow([
      line.description,
      priced(line) ? quantityText(line.quantity!) : "",
      ...(showUnit
        ? [priced(line) ? formatAmount(line.unitAmountMinor!) : ""]
        : []),
      formatAmount(line.amountMinor),
    ]);
  }
  const summaryRow = (label: string, value: string, strong: boolean) => {
    const cells = columns.map(() => "");
    cells[0] = label;
    cells[last] = value;
    tableRow(cells, {
      bold: strong,
      fill: strong ? CANVAS : undefined,
      height: 24,
    });
  };
  const taxableMinor = invoice.lines
    .filter((line) => line.taxable)
    .reduce((sum, line) => sum + line.amountMinor, 0);
  if (invoice.taxLines.length > 0) {
    summaryRow("Subtotal", formatAmount(invoice.subtotalMinor), false);
    if (taxableMinor !== invoice.subtotalMinor) {
      summaryRow("Taxable amount", formatAmount(taxableMinor), false);
    }
    for (const tax of invoice.taxLines) {
      summaryRow(
        `${tax.name} ${formatRate(tax.rateBasisPoints)}`,
        formatAmount(tax.amountMinor),
        false,
      );
    }
  }
  summaryRow("TOTAL AMOUNT DUE", formatAmount(invoice.totalMinor), true);
  if (invoice.status === "issued" && invoice.paidMinor > 0) {
    summaryRow("Paid", formatAmount(invoice.paidMinor), false);
    summaryRow("Balance due", formatAmount(invoice.outstandingMinor), true);
  }
  doc.font("Helvetica-Bold").fontSize(10).fillColor("#000000");
  ensure(24);
  doc.text("Amount in words: ", left, doc.y + 10, {
    continued: true,
    width,
  });
  doc
    .font("Helvetica")
    .text(amountInWords(invoice.totalMinor, invoice.currency), {
      continued: false,
    });

  if (invoice.notes) {
    heading("NOTES");
    doc.font("Helvetica").fontSize(TEXT).fillColor("#000000");
    doc.text(invoice.notes, left, doc.y + 4, { width, lineGap: 2 });
  }

  // Where to pay: the accounts kept on the invoice; an older invoice with
  // none kept prints today's defaults from Settings.
  const bank =
    invoice.bankAccounts ??
    pickBankAccounts(settings?.bankAccounts ?? [], invoice.currency);
  if (bank.length > 0) {
    // The heading never sits alone at the foot of a page.
    ensure(40 + paymentDetailsHeight(bank));
    heading("PAYMENT DETAILS");
    doc.y += 4;
    doc.y += drawPaymentDetails(doc, bank, left, doc.y, width);
  }
  doc.font("Helvetica").fontSize(10).fillColor("#000000");
  ensure(40);
  doc.text(
    `Please quote the invoice number when making payment and send the payment confirmation to ${issuerName}.`,
    left,
    doc.y + 14,
    { width },
  );
}

/**
 * Footer plus DRAFT / VOID marks on the invoice's pages: `count` pages from
 * `start`, numbered out of `total` pages in the whole file.
 */
function markInvoicePages(
  doc: PDFKit.PDFDocument,
  input: InvoicePdfInput,
  start: number,
  count: number,
  total: number,
): void {
  const { invoice, settings } = input;
  const draftReason = invoiceDraftReason(input);
  const issuerName = settings?.issuer.name ?? "Issuer details not configured";
  const left = PAGE_MARGIN;
  const width = doc.page.width - PAGE_MARGIN * 2;
  for (let index = start; index < start + count; index += 1) {
    doc.switchToPage(index);
    const { height, width: pageWidth } = doc.page;
    doc.page.margins.bottom = 0;
    doc.font("Helvetica").fontSize(LABEL).fillColor(MUTED);
    doc.text(
      `${issuerName}  |  ${invoice.invoiceNumber ?? "Draft invoice"}  |  Page ${index + 1} of ${total}`,
      left,
      height - PAGE_MARGIN + 6,
      { width, align: "center", lineBreak: false },
    );
    const mark =
      invoice.status === "void" ? "VOID" : draftReason ? "DRAFT" : null;
    if (mark) {
      doc.save();
      doc.fillColor(MARK_RED).opacity(0.1);
      doc.rotate(-35, { origin: [pageWidth / 2, height / 2] });
      doc.font("Helvetica-Bold").fontSize(110);
      doc.text(mark, 0, height / 2 - 60, {
        width: pageWidth,
        align: "center",
        lineBreak: false,
      });
      doc.restore();
      doc.opacity(1).font("Helvetica-Bold").fontSize(8).fillColor(MARK_RED);
      doc.text(
        (invoice.status === "void"
          ? `Void - ${invoice.voidReason ?? ""}`
          : (draftReason ?? "")
        ).toUpperCase(),
        left,
        24,
        { width, align: "right", lineBreak: false },
      );
    }
  }
}

export interface InvoiceSummaryPdfInput {
  companyName: string;
  settings: BusinessSettings | null;
  /** In the order they are listed; each gets its full invoice after the summary. */
  invoices: Array<{
    invoice: InvoiceView;
    job: JobRecord | null;
    customer: CustomerCompanyRecord;
  }>;
}

/**
 * A client's invoices in one file (Evans, 2026-11-04): a summary table
 * first, then each invoice in full on its own pages. The summary has no
 * number of its own; each invoice keeps its number and status.
 */
export function renderInvoiceSummaryPdf(
  input: InvoiceSummaryPdfInput,
  options: { compress?: boolean } = {},
): Promise<Buffer> {
  const { settings, invoices } = input;
  const issuerName = settings?.issuer.name ?? "Issuer details not configured";
  const doc = new PDFDocument({
    size: "A4",
    margin: PAGE_MARGIN,
    bufferPages: true,
    compress: options.compress ?? true,
    info: {
      Title: `Invoice summary - ${input.companyName}`,
      Author: issuerName,
    },
  });
  const done = collect(doc);
  const left = PAGE_MARGIN;
  const width = doc.page.width - PAGE_MARGIN * 2;
  const bottom = () => doc.page.height - PAGE_MARGIN - FOOTER_SPACE;

  const logoHeight = drawLogo(doc, left, PAGE_MARGIN, LOGO_HEIGHT);
  doc.font("Helvetica-Bold").fontSize(20).fillColor(PRIMARY);
  doc.text(issuerName, left, PAGE_MARGIN + (logoHeight ? logoHeight + 6 : 0), {
    width: width * 0.58,
  });
  const brandBottom = doc.y;
  doc.font("Helvetica-Bold").fontSize(11).fillColor(PRIMARY);
  doc.text("INVOICE SUMMARY", left + width * 0.5, PAGE_MARGIN, {
    width: width * 0.5,
    align: "right",
    characterSpacing: 1.5,
  });
  doc.font("Helvetica").fontSize(BODY).fillColor(MUTED);
  doc.text(
    formatDate(new Date().toISOString()),
    left + width * 0.5,
    PAGE_MARGIN + 17,
    {
      width: width * 0.5,
      align: "right",
    },
  );
  doc.y = Math.max(brandBottom, PAGE_MARGIN + 36) + 10;
  doc
    .moveTo(left, doc.y)
    .lineTo(left + width, doc.y)
    .lineWidth(2.5)
    .strokeColor(PRIMARY)
    .stroke();
  doc.y += 16;
  doc.font("Helvetica").fontSize(LABEL).fillColor(MUTED);
  doc.text("BILL TO", left, doc.y, { characterSpacing: 0.5 });
  doc.font("Helvetica-Bold").fontSize(14).fillColor(INK);
  doc.text(input.companyName, left, doc.y + 3, { width });
  doc.y += 18;

  const statusText = (invoice: InvoiceView) =>
    invoice.status === "draft"
      ? "Draft"
      : invoice.status === "void"
        ? "Void"
        : invoice.outstandingMinor === 0
          ? "Paid"
          : invoice.paidMinor > 0
            ? "Part paid"
            : "Unpaid";
  const columns = [
    { title: "Invoice", width: width * 0.24 },
    { title: "Job file", width: width * 0.2 },
    { title: "Due", width: width * 0.13 },
    { title: "Items", width: width * 0.08 },
    { title: "Status", width: width * 0.1 },
    { title: "Total", width: width * 0.25 },
  ];
  const columnLeft = (index: number) =>
    left + columns.slice(0, index).reduce((sum, item) => sum + item.width, 0);
  const cell = (index: number, text: string, y: number) =>
    doc.text(text, columnLeft(index) + 6, y + 9, {
      width: columns[index].width - 12,
      align: index >= 3 && index !== 4 ? "right" : "left",
    });
  const drawHeader = () => {
    const y = doc.y;
    doc.lineWidth(0.8).rect(left, y, width, 28).fillAndStroke(CANVAS, BORDER);
    doc.font("Helvetica-Bold").fontSize(10).fillColor(PRIMARY);
    columns.forEach((column, index) => cell(index, column.title, y));
    doc.y = y + 28;
  };
  drawHeader();
  const totals = new Map<string, { total: number; owing: number }>();
  for (const { invoice, job } of invoices) {
    const rowHeight = 30;
    if (doc.y + rowHeight > bottom()) {
      doc.addPage();
      drawHeader();
    }
    const y = doc.y;
    doc.font("Helvetica").fontSize(10.5).fillColor(INK);
    cell(0, invoice.invoiceNumber ?? "Draft (no number yet)", y);
    cell(1, job?.fileNumber ?? "-", y);
    cell(2, invoice.dueDate ?? "-", y);
    cell(3, String(invoice.lines.length), y);
    cell(4, statusText(invoice), y);
    cell(5, formatInvoiceAmount(invoice.totalMinor, invoice.currency), y);
    doc
      .moveTo(left, y + rowHeight)
      .lineTo(left + width, y + rowHeight)
      .lineWidth(0.7)
      .strokeColor(BORDER)
      .stroke();
    doc.y = y + rowHeight;
    if (invoice.status !== "void") {
      const sum = totals.get(invoice.currency) ?? { total: 0, owing: 0 };
      sum.total += invoice.totalMinor;
      sum.owing += invoice.status === "issued" ? invoice.outstandingMinor : 0;
      totals.set(invoice.currency, sum);
    }
  }

  const totalRows: Array<[string, string, boolean]> = [];
  for (const [currency, sum] of totals) {
    totalRows.push([
      `Total ${currency}`,
      formatInvoiceAmount(sum.total, currency),
      true,
    ]);
    if (sum.owing > 0 && sum.owing !== sum.total) {
      totalRows.push([
        `Still owing ${currency}`,
        formatInvoiceAmount(sum.owing, currency),
        false,
      ]);
    }
  }
  if (doc.y + totalRows.length * 24 + 70 > bottom()) doc.addPage();
  doc.y += 10;
  for (const [label, value, strong] of totalRows) {
    const y = doc.y;
    doc
      .font(strong ? "Helvetica-Bold" : "Helvetica")
      .fontSize(strong ? 12.5 : BODY);
    doc.fillColor(strong ? PRIMARY : INK);
    doc.text(label, left + width * 0.45, y, {
      width: width * 0.3,
      lineBreak: false,
    });
    doc.text(value, columnLeft(5) + 6, y, {
      width: columns[5].width - 12,
      align: "right",
      lineBreak: false,
    });
    doc.y = y + 24;
  }
  doc.moveDown(0.6);
  doc.font("Helvetica").fontSize(LABEL).fillColor(MUTED);
  doc.text(
    "Void invoices are not counted in the totals. This summary has no number of its own: each invoice, in full on the pages that follow, is the record of what is owed." +
      (invoices.some(({ invoice }) => invoice.status === "draft")
        ? " Draft invoices are for review and are not yet issued."
        : ""),
    left,
    doc.y,
    { width, lineGap: 1.5 },
  );
  const summaryPages = doc.bufferedPageRange().count;

  const spans: Array<[InvoicePdfInput, number, number]> = [];
  for (const { invoice, job, customer } of invoices) {
    doc.addPage();
    const start = doc.bufferedPageRange().count - 1;
    const one = { invoice, job, customer, settings };
    drawInvoice(doc, one);
    spans.push([one, start, doc.bufferedPageRange().count - start]);
  }
  const total = doc.bufferedPageRange().count;
  for (let index = 0; index < summaryPages; index += 1) {
    doc.switchToPage(index);
    doc.page.margins.bottom = 0;
    doc.font("Helvetica").fontSize(LABEL).fillColor(MUTED);
    doc.text(
      `${issuerName}  |  Invoice summary  |  Page ${index + 1} of ${total}`,
      left,
      doc.page.height - PAGE_MARGIN + 6,
      { width, align: "center", lineBreak: false },
    );
  }
  for (const [one, start, count] of spans) {
    markInvoicePages(doc, one, start, count, total);
  }
  doc.end();
  return done;
}
