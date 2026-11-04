import PDFDocument from "pdfkit";
import type { BusinessSettings } from "@bjh/contracts";
import type { JobRecord } from "../database/database.port";
import type { InvoiceView } from "./invoices.service";

// Same palette as the quote and waybill PDFs.
const PRIMARY = "#0b3fae";
const INK = "#17324d";
const MUTED = "#526b7d";
const BORDER = "#d7e3ed";
const CANVAS = "#f4f8fc";
const MARK_RED = "#b3261e";

const PAGE_MARGIN = 50;

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
  const { invoice, job, settings } = input;
  const draftReason = invoiceDraftReason(input);
  const issuerName = settings?.issuer.name ?? "Issuer details not configured";
  const money = (minor: number) => formatInvoiceAmount(minor, invoice.currency);

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
  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const left = PAGE_MARGIN;
  const width = doc.page.width - PAGE_MARGIN * 2;
  const bottom = () => doc.page.height - PAGE_MARGIN - 20;

  // Brand block, invoice number on the right.
  doc.font("Helvetica-Bold").fontSize(16).fillColor(PRIMARY);
  doc.text(issuerName, left, PAGE_MARGIN, { width: width * 0.6 });
  doc.font("Helvetica").fontSize(8.5).fillColor(MUTED);
  const contact = [
    settings?.issuer.address,
    [settings?.issuer.phone, settings?.issuer.email, settings?.issuer.website]
      .filter(Boolean)
      .join("  |  "),
  ].filter(Boolean);
  for (const row of contact) {
    doc.text(String(row), left, doc.y, { width: width * 0.6 });
  }
  const brandBottom = doc.y;
  doc.font("Helvetica-Bold").fontSize(8).fillColor(PRIMARY);
  doc.text("INVOICE", left + width * 0.6, PAGE_MARGIN, {
    width: width * 0.4,
    align: "right",
    characterSpacing: 1,
  });
  doc.font("Helvetica-Bold").fontSize(15).fillColor(INK);
  doc.text(
    invoice.invoiceNumber ?? "Not yet numbered",
    left + width * 0.6,
    PAGE_MARGIN + 13,
    { width: width * 0.4, align: "right" },
  );
  doc.y = Math.max(brandBottom, PAGE_MARGIN + 34) + 6;
  doc
    .moveTo(left, doc.y)
    .lineTo(left + width, doc.y)
    .lineWidth(2)
    .strokeColor(PRIMARY)
    .stroke();
  doc.y += 12;

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
  const cellHeight = 38;
  const gridTop = doc.y;
  cells.forEach(([label, value], index) => {
    const x = left + (index % 2) * cellWidth;
    const y = gridTop + Math.floor(index / 2) * cellHeight;
    doc
      .lineWidth(0.7)
      .strokeColor(BORDER)
      .rect(x, y, cellWidth, cellHeight)
      .stroke();
    doc.font("Helvetica").fontSize(7.5).fillColor(MUTED);
    doc.text(label.toUpperCase(), x + 8, y + 7, {
      width: cellWidth - 16,
      characterSpacing: 0.5,
    });
    doc.font("Helvetica-Bold").fontSize(9.5).fillColor(INK);
    doc.text(value, x + 8, y + 19, {
      width: cellWidth - 16,
      height: 16,
      ellipsis: true,
    });
  });
  doc.y = gridTop + cellHeight * 2 + 16;

  // Lines table.
  // Description | Qty | Unit price | Amount; Qty and unit price are blank on
  // a line given as one amount.
  const columns = [
    { title: "Description", width: width * 0.46 },
    { title: "Qty", width: width * 0.1 },
    { title: `Unit price (${invoice.currency})`, width: width * 0.2 },
    { title: `Amount (${invoice.currency})`, width: width * 0.24 },
  ];
  const columnLeft = (index: number) =>
    left + columns.slice(0, index).reduce((sum, item) => sum + item.width, 0);
  const cell = (index: number, text: string, y: number) =>
    doc.text(text, columnLeft(index) + 6, y + 6, {
      width: columns[index].width - 12,
      align: index === 0 ? "left" : "right",
    });
  const quantityText = (value: number) =>
    new Intl.NumberFormat("en-GH", { maximumFractionDigits: 3 }).format(value);
  const drawHeader = () => {
    const y = doc.y;
    doc.rect(left, y, width, 20).fillAndStroke(CANVAS, BORDER);
    doc.font("Helvetica-Bold").fontSize(8.5).fillColor(PRIMARY);
    columns.forEach((column, index) => cell(index, column.title, y));
    doc.y = y + 20;
  };
  drawHeader();
  for (const line of invoice.lines) {
    doc.font("Helvetica").fontSize(9.5);
    const rowHeight =
      doc.heightOfString(line.description, { width: columns[0].width - 12 }) +
      12;
    if (doc.y + rowHeight > bottom()) {
      doc.addPage();
      drawHeader();
    }
    const y = doc.y;
    doc.fillColor(INK);
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
      .lineWidth(0.7)
      .strokeColor(BORDER)
      .stroke();
    doc.y = y + rowHeight;
  }

  // Totals block, right-aligned under the amount column.
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
  if (doc.y + totals.length * 20 + 40 > bottom()) doc.addPage();
  doc.y += 8;
  const labelX = left + width * 0.45;
  for (const [label, value, strong] of totals) {
    const y = doc.y;
    doc.font(strong ? "Helvetica-Bold" : "Helvetica").fontSize(9.5);
    doc.fillColor(strong ? PRIMARY : INK);
    doc.text(label, labelX, y, { width: width * 0.27, lineBreak: false });
    doc.text(value, columnLeft(3) + 6, y, {
      width: columns[3].width - 12,
      align: "right",
      lineBreak: false,
    });
    doc.y = y + 18;
  }
  if (taxableMinor !== invoice.subtotalMinor || invoice.taxLines.length > 0) {
    doc.moveDown(0.4);
    doc.font("Helvetica").fontSize(8).fillColor(MUTED);
    doc.text(
      "Each tax line is a percentage of the taxable amount.",
      left,
      doc.y,
      { width },
    );
  }

  if (invoice.notes) {
    doc.moveDown(1);
    doc.font("Helvetica-Bold").fontSize(9.5).fillColor(PRIMARY);
    doc.text("Notes", left, doc.y, { width });
    doc.font("Helvetica").fontSize(9.5).fillColor(INK);
    doc.text(invoice.notes, left, doc.y + 2, { width, lineGap: 2 });
  }

  // Footer plus DRAFT / VOID marks on every page.
  const range = doc.bufferedPageRange();
  for (let index = range.start; index < range.start + range.count; index += 1) {
    doc.switchToPage(index);
    const { height, width: pageWidth } = doc.page;
    doc.page.margins.bottom = 0;
    doc.font("Helvetica").fontSize(7.5).fillColor(MUTED);
    doc.text(
      `${issuerName}  |  ${invoice.invoiceNumber ?? "Draft invoice"}  |  Page ${index + 1} of ${range.count}`,
      left,
      height - 34,
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

  doc.end();
  return done;
}
