import PDFDocument from "pdfkit";
import type { BusinessSettings } from "@bjh/contracts";
import { formatInvoiceAmount } from "./invoice-pdf";
import type { StatementView } from "./statements.service";

// Same palette as the invoice, quote and waybill PDFs.
const PRIMARY = "#0b3fae";
const INK = "#17324d";
const MUTED = "#526b7d";
const BORDER = "#d7e3ed";
const CANVAS = "#f4f8fc";

const PAGE_MARGIN = 40;

export interface StatementPdfInput {
  statement: StatementView;
  /** null until the business settings are configured (D03). */
  settings: BusinessSettings | null;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(value));
}

function periodText(from: string | null, to: string | null): string {
  if (from && to) return `${formatDate(from)} to ${formatDate(to)}`;
  if (from) return `From ${formatDate(from)}`;
  if (to) return `Up to ${formatDate(to)}`;
  return "All invoices and payments";
}

/** A customer's statement of account: one table per currency, balance running down the page. */
export function renderStatementPdf(
  input: StatementPdfInput,
  options: { compress?: boolean } = {},
): Promise<Buffer> {
  const { statement, settings } = input;
  const issuerName = settings?.issuer.name ?? "Issuer details not configured";

  const doc = new PDFDocument({
    size: "A4",
    layout: "landscape",
    margin: PAGE_MARGIN,
    bufferPages: true,
    compress: options.compress ?? true,
    info: {
      Title: `Statement of account - ${statement.company.name}`,
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

  // Brand block, document title on the right.
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
  doc.text("STATEMENT OF ACCOUNT", left + width * 0.6, PAGE_MARGIN, {
    width: width * 0.4,
    align: "right",
    characterSpacing: 1,
  });
  doc.font("Helvetica-Bold").fontSize(15).fillColor(INK);
  doc.text(statement.company.name, left + width * 0.6, PAGE_MARGIN + 13, {
    width: width * 0.4,
    align: "right",
  });
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
    [
      "Customer",
      statement.company.customerNumber
        ? `${statement.company.name} (${statement.company.customerNumber})`
        : statement.company.name,
    ],
    ["Period", periodText(statement.from, statement.to)],
    ["Statement date", formatDate(statement.generatedOn)],
  ];
  const cellWidth = width / cells.length;
  const cellHeight = 38;
  const gridTop = doc.y;
  cells.forEach(([label, value], index) => {
    const x = left + index * cellWidth;
    doc
      .lineWidth(0.7)
      .strokeColor(BORDER)
      .rect(x, gridTop, cellWidth, cellHeight)
      .stroke();
    doc.font("Helvetica").fontSize(7.5).fillColor(MUTED);
    doc.text(label.toUpperCase(), x + 8, gridTop + 7, {
      width: cellWidth - 16,
      characterSpacing: 0.5,
    });
    doc.font("Helvetica-Bold").fontSize(9.5).fillColor(INK);
    doc.text(value, x + 8, gridTop + 19, {
      width: cellWidth - 16,
      height: 16,
      ellipsis: true,
    });
  });
  doc.y = gridTop + cellHeight + 16;

  const columns = [
    { title: "Date", width: 70, align: "left" as const },
    { title: "Type", width: 55, align: "left" as const },
    {
      title: "Reference",
      width: width - 70 - 55 - 95 * 3,
      align: "left" as const,
    },
    { title: "Debit", width: 95, align: "right" as const },
    { title: "Credit", width: 95, align: "right" as const },
    { title: "Balance", width: 95, align: "right" as const },
  ];
  const referenceWidth = columns[2].width - 12;

  const drawRow = (
    values: string[],
    options: { bold?: boolean; fill?: string; height: number },
  ) => {
    const y = doc.y;
    if (options.fill) {
      doc
        .rect(left, y, width, options.height)
        .fillAndStroke(options.fill, BORDER);
    }
    doc
      .font(options.bold ? "Helvetica-Bold" : "Helvetica")
      .fontSize(8.5)
      .fillColor(INK);
    let x = left;
    columns.forEach((column, index) => {
      doc.text(values[index] ?? "", x + 6, y + 6, {
        width: column.width - 12,
        align: column.align,
      });
      x += column.width;
    });
    doc
      .moveTo(left, y + options.height)
      .lineTo(left + width, y + options.height)
      .lineWidth(0.7)
      .strokeColor(BORDER)
      .stroke();
    doc.y = y + options.height;
  };

  const drawHeader = () => {
    const y = doc.y;
    doc.rect(left, y, width, 20).fillAndStroke(CANVAS, BORDER);
    doc.font("Helvetica-Bold").fontSize(8.5).fillColor(PRIMARY);
    let x = left;
    for (const column of columns) {
      doc.text(column.title, x + 6, y + 6, {
        width: column.width - 12,
        align: column.align,
      });
      x += column.width;
    }
    doc.y = y + 20;
  };

  if (statement.sections.length === 0) {
    doc.font("Helvetica").fontSize(10).fillColor(MUTED);
    doc.text("No invoices or payments in this period.", left, doc.y, { width });
  }

  for (const section of statement.sections) {
    const money = (minor: number) =>
      formatInvoiceAmount(minor, section.currency);
    if (doc.y + 20 + 3 * 24 > bottom()) doc.addPage();
    doc.font("Helvetica-Bold").fontSize(10).fillColor(PRIMARY);
    doc.text(`Amounts in ${section.currency}`, left, doc.y, { width });
    doc.y += 6;
    drawHeader();

    if (statement.from) {
      drawRow(
        [
          formatDate(statement.from),
          "",
          "Opening balance",
          "",
          "",
          money(section.openingMinor),
        ],
        { bold: true, height: 24 },
      );
    }
    for (const line of section.lines) {
      doc.font("Helvetica").fontSize(8.5);
      const height =
        Math.max(
          doc.heightOfString(line.reference, { width: referenceWidth }),
          doc.heightOfString("Payment", { width: columns[1].width - 12 }),
        ) + 12;
      if (doc.y + height > bottom()) {
        doc.addPage();
        drawHeader();
      }
      drawRow(
        [
          formatDate(line.date),
          line.kind === "invoice" ? "Invoice" : "Payment",
          line.reference,
          line.debitMinor ? money(line.debitMinor) : "",
          line.creditMinor ? money(line.creditMinor) : "",
          money(line.balanceMinor),
        ],
        { height },
      );
    }
    if (doc.y + 26 > bottom()) {
      doc.addPage();
      drawHeader();
    }
    drawRow(
      [
        "",
        "",
        "Closing balance",
        money(section.debitMinor),
        money(section.creditMinor),
        money(section.closingMinor),
      ],
      { bold: true, fill: CANVAS, height: 26 },
    );
    doc.y += 22;
  }

  // Footer on every page.
  const range = doc.bufferedPageRange();
  for (let index = range.start; index < range.start + range.count; index += 1) {
    doc.switchToPage(index);
    const { height } = doc.page;
    doc.page.margins.bottom = 0;
    doc.font("Helvetica").fontSize(7.5).fillColor(MUTED);
    doc.text(
      `${issuerName}  |  Statement of account  |  ${statement.company.name}  |  Page ${index + 1} of ${range.count}`,
      left,
      height - 28,
      { width, align: "center", lineBreak: false },
    );
  }

  doc.end();
  return done;
}
