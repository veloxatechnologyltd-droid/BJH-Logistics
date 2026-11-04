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

const serviceLabels: Record<string, string> = {
  sea_import: "Sea import",
  sea_export: "Sea export",
  air_import: "Air import",
  air_export: "Air export",
  warehousing: "Warehousing",
  road_transport: "Road transport",
};

// Print type scale (pt): body text 11, small labels 9, footer 9.
const BODY = 11;
const LABEL = 9;
// Space kept above the bottom margin for the page footer.
const FOOTER_SPACE = 24;

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
  const bottom = () => doc.page.height - PAGE_MARGIN - FOOTER_SPACE;

  // Brand block, document title on the right.
  doc.font("Helvetica-Bold").fontSize(20).fillColor(PRIMARY);
  doc.text(issuerName, left, PAGE_MARGIN, { width: width * 0.58 });
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
  doc.text("STATEMENT OF ACCOUNT", left + width * 0.58, PAGE_MARGIN, {
    width: width * 0.42,
    align: "right",
    characterSpacing: 1.5,
  });
  doc.font("Helvetica-Bold").fontSize(18).fillColor(INK);
  doc.text(statement.company.name, left + width * 0.58, PAGE_MARGIN + 17, {
    width: width * 0.42,
    align: "right",
  });
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
    [
      "Customer",
      statement.company.customerNumber
        ? `${statement.company.name} (${statement.company.customerNumber})`
        : statement.company.name,
    ],
    ["Period", periodText(statement.from, statement.to)],
    [
      "Service",
      statement.serviceLine
        ? (serviceLabels[statement.serviceLine] ?? statement.serviceLine)
        : "All services",
    ],
    ["Statement date", formatDate(statement.generatedOn)],
  ];
  const cellWidth = width / cells.length;
  const cellHeight = 50;
  const gridTop = doc.y;
  cells.forEach(([label, value], index) => {
    const x = left + index * cellWidth;
    doc
      .lineWidth(0.8)
      .strokeColor(BORDER)
      .rect(x, gridTop, cellWidth, cellHeight)
      .stroke();
    doc.font("Helvetica").fontSize(LABEL).fillColor(MUTED);
    doc.text(label.toUpperCase(), x + 10, gridTop + 9, {
      width: cellWidth - 20,
      characterSpacing: 0.5,
    });
    doc.font("Helvetica-Bold").fontSize(12).fillColor(INK);
    doc.text(value, x + 10, gridTop + 24, {
      width: cellWidth - 20,
      height: 18,
      ellipsis: true,
    });
  });
  doc.y = gridTop + cellHeight + 20;

  const columns = [
    { title: "Date", width: 90, align: "left" as const },
    { title: "Type", width: 62, align: "left" as const },
    {
      title: "Reference",
      width: width - 90 - 62 - 100 * 3,
      align: "left" as const,
    },
    { title: "Debit", width: 100, align: "right" as const },
    { title: "Credit", width: 100, align: "right" as const },
    { title: "Balance", width: 100, align: "right" as const },
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
      .fontSize(BODY)
      .fillColor(INK);
    let x = left;
    columns.forEach((column, index) => {
      doc.text(values[index] ?? "", x + 6, y + 8, {
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
    doc.rect(left, y, width, 28).fillAndStroke(CANVAS, BORDER);
    doc.font("Helvetica-Bold").fontSize(10).fillColor(PRIMARY);
    let x = left;
    for (const column of columns) {
      doc.text(column.title, x + 6, y + 9, {
        width: column.width - 12,
        align: column.align,
      });
      x += column.width;
    }
    doc.y = y + 28;
  };

  if (statement.sections.length === 0) {
    doc.font("Helvetica").fontSize(BODY).fillColor(MUTED);
    doc.text("No invoices or payments in this period.", left, doc.y, { width });
  }

  for (const section of statement.sections) {
    const money = (minor: number) =>
      formatInvoiceAmount(minor, section.currency);
    if (doc.y + 20 + 3 * 30 > bottom()) doc.addPage();
    doc.font("Helvetica-Bold").fontSize(12).fillColor(PRIMARY);
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
        { bold: true, height: 30 },
      );
    }
    for (const line of section.lines) {
      doc.font("Helvetica").fontSize(BODY);
      const height =
        Math.max(
          doc.heightOfString(line.reference, { width: referenceWidth }),
          doc.heightOfString("Payment", { width: columns[1].width - 12 }),
        ) + 16;
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
    if (doc.y + 32 > bottom()) {
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
      { bold: true, fill: CANVAS, height: 32 },
    );
    doc.y += 22;
  }

  // Footer on every page.
  const range = doc.bufferedPageRange();
  for (let index = range.start; index < range.start + range.count; index += 1) {
    doc.switchToPage(index);
    const { height } = doc.page;
    doc.page.margins.bottom = 0;
    doc.font("Helvetica").fontSize(LABEL).fillColor(MUTED);
    doc.text(
      `${issuerName}  |  Statement of account  |  ${statement.company.name}  |  Page ${index + 1} of ${range.count}`,
      left,
      height - PAGE_MARGIN + 6,
      { width, align: "center", lineBreak: false },
    );
  }

  doc.end();
  return done;
}
