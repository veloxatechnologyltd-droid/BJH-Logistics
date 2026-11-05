import PDFDocument from "pdfkit";
import { pickBankAccount } from "@bjh/contracts";
import type { BusinessSettings } from "@bjh/contracts";
import { drawLogo } from "../assets/logo";
import type { JobRecord } from "../database/database.port";
import {
  bankDetailsHeight,
  drawBankDetails,
} from "../settings/bank-details-pdf";
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
// Space kept above the bottom margin for the page footer.
const FOOTER_SPACE = 24;

export interface InvoicePdfInput {
  invoice: InvoiceView;
  job: JobRecord;
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

/** Draws one invoice from the top of the current page (and onto new ones). */
function drawInvoice(doc: PDFKit.PDFDocument, input: InvoicePdfInput): void {
  const { invoice, job, settings } = input;
  const issuerName = settings?.issuer.name ?? "Issuer details not configured";
  const money = (minor: number) => formatInvoiceAmount(minor, invoice.currency);
  const left = PAGE_MARGIN;
  const width = doc.page.width - PAGE_MARGIN * 2;
  const bottom = () => doc.page.height - PAGE_MARGIN - FOOTER_SPACE;

  // Brand block (logo, then the issuer), invoice number on the right.
  const logoHeight = drawLogo(doc, left, PAGE_MARGIN, LOGO_HEIGHT);
  doc.font("Helvetica-Bold").fontSize(20).fillColor(PRIMARY);
  doc.text(issuerName, left, PAGE_MARGIN + (logoHeight ? logoHeight + 6 : 0), {
    width: width * 0.58,
  });
  doc.font("Helvetica").fontSize(10).fillColor(MUTED);
  const contact = [
    settings?.issuer.address,
    [settings?.issuer.phone, settings?.issuer.email, settings?.issuer.website]
      .filter(Boolean)
      .join("  |  "),
  ].filter(Boolean);
  for (const row of contact) {
    doc.text(String(row), left, doc.y + 2, { width: width * 0.58 });
  }
  const brandBottom = doc.y;
  doc.font("Helvetica-Bold").fontSize(11).fillColor(PRIMARY);
  doc.text("INVOICE", left + width * 0.58, PAGE_MARGIN, {
    width: width * 0.42,
    align: "right",
    characterSpacing: 1.5,
  });
  doc.font("Helvetica-Bold").fontSize(18).fillColor(INK);
  doc.text(
    invoice.invoiceNumber ?? "Not yet numbered",
    left + width * 0.58,
    PAGE_MARGIN + 17,
    { width: width * 0.42, align: "right" },
  );
  doc.y = Math.max(brandBottom, PAGE_MARGIN + 42) + 10;
  doc
    .moveTo(left, doc.y)
    .lineTo(left + width, doc.y)
    .lineWidth(2.5)
    .strokeColor(PRIMARY)
    .stroke();
  doc.y += 16;

  // Metadata grid.
  const cells: Array<[string, string]> = [
    ["Bill to", job.customerCompanyName],
    ["Job file", job.fileNumber],
    [
      "Invoice date",
      invoice.issuedAt ? formatDate(invoice.issuedAt) : "Not yet issued",
    ],
    ["Due date", invoice.dueDate ? formatDate(invoice.dueDate) : "-"],
  ];
  const cellWidth = width / 2;
  const cellHeight = 50;
  const gridTop = doc.y;
  cells.forEach(([label, value], index) => {
    const x = left + (index % 2) * cellWidth;
    const y = gridTop + Math.floor(index / 2) * cellHeight;
    doc
      .lineWidth(0.8)
      .strokeColor(BORDER)
      .rect(x, y, cellWidth, cellHeight)
      .stroke();
    doc.font("Helvetica").fontSize(LABEL).fillColor(MUTED);
    doc.text(label.toUpperCase(), x + 10, y + 9, {
      width: cellWidth - 20,
      characterSpacing: 0.5,
    });
    doc.font("Helvetica-Bold").fontSize(12).fillColor(INK);
    doc.text(value, x + 10, y + 24, {
      width: cellWidth - 20,
      height: 18,
      ellipsis: true,
    });
  });
  doc.y = gridTop + cellHeight * 2 + 20;

  // Lines table, framed with column rules.
  // Description | Qty | Unit price | Amount; Qty and unit price are blank on
  // a line given as one amount.
  const columns = [
    { title: "Description", width: width * 0.44 },
    { title: "Qty", width: width * 0.1 },
    { title: `Unit price (${invoice.currency})`, width: width * 0.22 },
    { title: `Amount (${invoice.currency})`, width: width * 0.24 },
  ];
  const columnLeft = (index: number) =>
    left + columns.slice(0, index).reduce((sum, item) => sum + item.width, 0);
  const cell = (index: number, text: string, y: number) =>
    doc.text(text, columnLeft(index) + 8, y + 8, {
      width: columns[index].width - 16,
      align: index === 0 ? "left" : "right",
    });
  const quantityText = (value: number) =>
    new Intl.NumberFormat("en-GH", { maximumFractionDigits: 3 }).format(value);
  const headerHeight = 28;
  let tableTop = doc.y;
  const drawHeader = () => {
    const y = doc.y;
    tableTop = y;
    doc.lineWidth(0.8).rect(left, y, width, headerHeight);
    doc.fillAndStroke(CANVAS, BORDER);
    doc.font("Helvetica-Bold").fontSize(10).fillColor(PRIMARY);
    columns.forEach((column, index) => cell(index, column.title, y + 1));
    doc.y = y + headerHeight;
  };
  // Outer frame and column rules from the header down to `to`.
  const closeTable = (to: number) => {
    doc.lineWidth(0.8).strokeColor(BORDER);
    doc.rect(left, tableTop, width, to - tableTop).stroke();
    for (let index = 1; index < columns.length; index += 1) {
      doc
        .moveTo(columnLeft(index), tableTop)
        .lineTo(columnLeft(index), to)
        .stroke();
    }
  };

  // Totals block, measured first so the table can stretch down to meet it.
  const totals: Array<[string, string, boolean]> = [
    ["Subtotal", money(invoice.subtotalMinor), false],
  ];
  const taxableMinor = invoice.lines
    .filter((line) => line.taxable)
    .reduce((sum, line) => sum + line.amountMinor, 0);
  if (invoice.taxLines.length > 0 && taxableMinor !== invoice.subtotalMinor) {
    totals.push(["Taxable amount", money(taxableMinor), false]);
  }
  for (const tax of invoice.taxLines) {
    totals.push([
      `${tax.name} ${formatRate(tax.rateBasisPoints)}`,
      money(tax.amountMinor),
      false,
    ]);
  }
  totals.push([`Total ${invoice.currency}`, money(invoice.totalMinor), true]);
  if (invoice.status === "issued" && invoice.paidMinor > 0) {
    totals.push(["Paid", money(invoice.paidMinor), false]);
    totals.push(["Balance due", money(invoice.outstandingMinor), true]);
  }
  const showTaxNote =
    taxableMinor !== invoice.subtotalMinor || invoice.taxLines.length > 0;
  const totalRowHeight = 24;
  doc.font("Helvetica").fontSize(BODY);
  const notesHeight = invoice.notes
    ? 22 + doc.heightOfString(invoice.notes, { width, lineGap: 2 })
    : 0;
  // Where to pay: the account chosen on the invoice, else the one in its currency.
  const bank =
    invoice.bankAccount ??
    pickBankAccount(settings?.bankAccounts ?? [], invoice.currency);
  const bankHeight = bank ? 16 + bankDetailsHeight(doc, bank, width) : 0;
  const totalsHeight =
    10 +
    totals.length * totalRowHeight +
    (showTaxNote ? 22 : 0) +
    notesHeight +
    bankHeight;

  drawHeader();
  for (const line of invoice.lines) {
    doc.font("Helvetica").fontSize(BODY);
    const rowHeight =
      doc.heightOfString(line.description, { width: columns[0].width - 16 }) +
      16;
    if (doc.y + rowHeight > bottom()) {
      closeTable(doc.y);
      doc.addPage();
      drawHeader();
    }
    const y = doc.y;
    doc.font("Helvetica").fontSize(BODY).fillColor(INK);
    cell(0, line.description, y);
    const priced =
      line.quantity !== null &&
      line.quantity !== undefined &&
      line.unitAmountMinor !== null &&
      line.unitAmountMinor !== undefined;
    cell(1, priced ? quantityText(line.quantity!) : "", y);
    cell(2, priced ? money(line.unitAmountMinor!) : "", y);
    cell(3, money(line.amountMinor), y);
    doc
      .moveTo(left, y + rowHeight)
      .lineTo(left + width, y + rowHeight)
      .lineWidth(0.6)
      .strokeColor(BORDER)
      .stroke();
    doc.y = y + rowHeight;
  }

  // Stretch the table to meet the totals at the foot of the page, so the
  // printed invoice fills the sheet; if they do not fit, they go overleaf.
  const fillTo = bottom() - totalsHeight;
  if (doc.y <= fillTo) {
    closeTable(fillTo);
    doc.y = fillTo;
  } else {
    closeTable(doc.y);
    doc.addPage();
  }

  // Totals, right-aligned under the amount column.
  doc.y += 10;
  const labelX = left + width * 0.46;
  for (const [label, value, strong] of totals) {
    const y = doc.y;
    doc
      .font(strong ? "Helvetica-Bold" : "Helvetica")
      .fontSize(strong ? 12.5 : BODY);
    doc.fillColor(strong ? PRIMARY : INK);
    doc.text(label, labelX + 8, y + 5, {
      width: width * 0.3,
      lineBreak: false,
    });
    doc.text(value, columnLeft(3) + 8, y + 5, {
      width: columns[3].width - 16,
      align: "right",
      lineBreak: false,
    });
    if (strong) {
      doc
        .moveTo(labelX, y)
        .lineTo(left + width, y)
        .lineWidth(1)
        .strokeColor(PRIMARY)
        .stroke();
    }
    doc.y = y + totalRowHeight;
  }
  if (showTaxNote) {
    doc.font("Helvetica").fontSize(LABEL).fillColor(MUTED);
    doc.text(
      "Each tax line is a percentage of the taxable amount.",
      left,
      doc.y + 8,
      { width },
    );
    doc.y += 2;
  }

  if (invoice.notes) {
    doc.font("Helvetica-Bold").fontSize(BODY).fillColor(PRIMARY);
    doc.text("Notes", left, doc.y + 8, { width });
    doc.font("Helvetica").fontSize(BODY).fillColor(INK);
    doc.text(invoice.notes, left, doc.y + 2, { width, lineGap: 2 });
  }
  if (bank) drawBankDetails(doc, bank, left, doc.y + 16, width);
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
  invoices: Array<{ invoice: InvoiceView; job: JobRecord }>;
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
    cell(1, job.fileNumber, y);
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
  for (const { invoice, job } of invoices) {
    doc.addPage();
    const start = doc.bufferedPageRange().count - 1;
    const one = { invoice, job, settings };
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
