import PDFDocument from "pdfkit";
import { drawLogo } from "../assets/logo";
import type { BusinessSettings } from "@bjh/contracts";
import type {
  ClientJobReportRow,
  ClientJobReportView,
} from "./client-job-report.service";

// Same palette as the invoice, quote, statement and job report PDFs.
const PRIMARY = "#0b3fae";
const INK = "#17324d";
const MUTED = "#526b7d";
const BORDER = "#d7e3ed";
const CANVAS = "#f4f8fc";

const PAGE_MARGIN = 36;
const LOGO_HEIGHT = 44;
const CELL_PADDING = 5;

const serviceLabels: Record<string, string> = {
  sea_import: "Sea import",
  sea_export: "Sea export",
  air_import: "Air import",
  air_export: "Air export",
  warehousing: "Warehousing",
  road_transport: "Road transport",
};

/** The sample's columns, with their share of the page width. */
const columns = [
  // Wide enough for a file number such as BJH/SI/2026/0001 on one line.
  { title: "Job No.", weight: 13 },
  { title: "Customer", weight: 11 },
  { title: "BL / AWB No.", weight: 11 },
  { title: "Description of Goods", weight: 14 },
  { title: "Vessel / Flight", weight: 11 },
  { title: "ETA", weight: 9 },
  { title: "Port of Discharge", weight: 9 },
  { title: "Status / Remarks", weight: 14 },
  { title: "Completion Date", weight: 9 },
];

/** YYYY-MM-DD as DD/MM/YYYY, the way the client's own sheets write it. */
const dayMonthYear = (value: string | null) =>
  value ? value.split("-").reverse().join("/") : "";

function cells(row: ClientJobReportRow): string[] {
  return [
    row.fileNumber,
    row.customer,
    row.billNumbers.join("\n"),
    row.goods ?? "",
    row.vessel ?? "",
    dayMonthYear(row.eta),
    row.portOfDischarge ?? "",
    row.status,
    dayMonthYear(row.completionDate),
  ];
}

export interface ClientJobReportPdfInput {
  report: ClientJobReportView;
  settings: BusinessSettings | null;
}

/** A customer's jobs, one line each, as a status update for the client: A4 landscape. */
export function renderClientJobReportPdf(
  input: ClientJobReportPdfInput,
  options: { compress?: boolean } = {},
): Promise<Buffer> {
  const { report, settings } = input;
  const issuer = settings?.issuer;
  const issuerName = issuer?.name ?? "Issuer details not configured";
  const doc = new PDFDocument({
    size: "A4",
    layout: "landscape",
    margin: PAGE_MARGIN,
    bufferPages: true,
    compress: options.compress ?? true,
    info: {
      Title: `Client job report - ${report.company.name}`,
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
  const totalWeight = columns.reduce((sum, column) => sum + column.weight, 0);
  const widths = columns.map((column) => (column.weight / totalWeight) * width);
  const titles = columns.map((column) => column.title);
  const bottom = () => doc.page.height - PAGE_MARGIN - 24;

  const drawRow = (row: string[], header: boolean) => {
    doc.font(header ? "Helvetica-Bold" : "Helvetica").fontSize(10);
    const height =
      Math.max(
        ...row.map((text, index) =>
          doc.heightOfString(text, {
            width: widths[index] - CELL_PADDING * 2,
            align: header ? "center" : "left",
          }),
        ),
      ) +
      CELL_PADDING * 2;
    if (doc.y + height > bottom()) {
      doc.addPage();
      if (!header) drawRow(titles, true);
    }
    const y = doc.y;
    if (header) doc.rect(left, y, width, height).fill(CANVAS);
    doc
      .font(header ? "Helvetica-Bold" : "Helvetica")
      .fontSize(10)
      .fillColor(INK);
    let x = left;
    row.forEach((text, index) => {
      doc.text(text, x + CELL_PADDING, y + CELL_PADDING, {
        width: widths[index] - CELL_PADDING * 2,
        align: header ? "center" : "left",
      });
      x += widths[index];
    });
    doc
      .moveTo(left, y + height)
      .lineTo(left + width, y + height)
      .lineWidth(0.5)
      .strokeColor(BORDER)
      .stroke();
    doc.y = y + height;
  };

  const drawTable = (heading: string, rows: ClientJobReportRow[]) => {
    // Keep a heading with at least its header row and first job.
    if (doc.y + 70 > bottom()) doc.addPage();
    doc.font("Helvetica-Bold").fontSize(13).fillColor(PRIMARY);
    doc.text(heading, left, doc.y, { width });
    doc.moveDown(0.4);
    drawRow(titles, true);
    for (const row of rows) drawRow(cells(row), false);
    doc.moveDown(1.2);
  };

  // Letterhead: the logo (or the issuer's name) on the left, its address on
  // the right, then a rule.
  const top = PAGE_MARGIN;
  const logoHeight = drawLogo(doc, left, top, LOGO_HEIGHT);
  if (logoHeight) {
    doc.y = top + logoHeight;
  } else {
    doc.font("Helvetica-Bold").fontSize(16).fillColor(PRIMARY);
    doc.text(issuerName, left, top, { width: width / 2 });
  }
  const contact = [issuer?.phone, issuer?.email, issuer?.website].filter(
    (part): part is string => Boolean(part),
  );
  if (issuer?.address) {
    doc.font("Helvetica").fontSize(10).fillColor(MUTED);
    doc.text(issuer.address, left + width / 2, top, {
      width: width / 2,
      align: "right",
    });
  }
  doc.y = Math.max(doc.y, top + (logoHeight || 22)) + 8;
  doc
    .moveTo(left, doc.y)
    .lineTo(left + width, doc.y)
    .lineWidth(0.75)
    .strokeColor(PRIMARY)
    .stroke();
  doc.y += 14;

  doc.font("Helvetica-Bold").fontSize(20).fillColor(INK);
  doc.text("Client Job Report", left, doc.y, { width });
  doc.moveDown(0.3);
  doc.font("Helvetica").fontSize(12).fillColor(INK);
  doc.text(report.company.name, left, doc.y, { width });
  doc.fontSize(10.5).fillColor(MUTED);
  doc.text(`Generated on ${dayMonthYear(report.generatedOn)}`, left, doc.y, {
    width,
  });
  doc.moveDown(1);

  if (report.sections.length === 0 && report.completed.length === 0) {
    doc.font("Helvetica").fontSize(10).fillColor(MUTED);
    doc.text("There are no jobs to report.", left, doc.y, { width });
  }
  for (const section of report.sections) {
    drawTable(
      serviceLabels[section.serviceLine] ?? section.serviceLine,
      section.rows,
    );
  }
  if (report.completed.length > 0) {
    drawTable("Completed jobs", report.completed);
  }

  // Contact line and page numbers on every page, as the sample's footer.
  const range = doc.bufferedPageRange();
  for (let index = 0; index < range.count; index += 1) {
    doc.switchToPage(range.start + index);
    // Writing inside the bottom margin would otherwise start a new page.
    doc.page.margins.bottom = 0;
    const y = doc.page.height - 28;
    doc
      .moveTo(left, y - 6)
      .lineTo(left + width, y - 6)
      .lineWidth(0.5)
      .strokeColor(BORDER)
      .stroke();
    doc.font("Helvetica").fontSize(9).fillColor(MUTED);
    doc.text(
      [...contact, `Page ${index + 1} of ${range.count}`].join("  -  "),
      left,
      y,
      { width, align: "center", lineBreak: false },
    );
  }
  doc.end();
  return done;
}
