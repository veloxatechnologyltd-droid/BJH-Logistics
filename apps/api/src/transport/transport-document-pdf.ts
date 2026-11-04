import PDFDocument from "pdfkit";
import {
  transportDocumentFields,
  transportDocumentTitles,
} from "@bjh/contracts";
import type { BusinessSettings } from "@bjh/contracts";
import type {
  JobRecord,
  TransportDocumentRecord,
} from "../database/database.port";

// Same palette as the other PDFs.
const PRIMARY = "#0b3fae";
const SECONDARY = "#5c9fd6";
const INK = "#17324d";
const MUTED = "#526b7d";
const BORDER = "#d7e3ed";
const MARK_RED = "#b3261e";

const PAGE_MARGIN = 40;

// Print type scale (pt): body text 11, small labels 9, footer 9.
const BODY = 11;
const LABEL = 9;
// Space kept above the bottom margin for the page footer.
const FOOTER_SPACE = 24;

/** Fields that get the full width of the page rather than half of it. */
const fullWidth = new Set([
  "containers",
  "goods",
  "shipmentLines",
  "handlingInformation",
]);

export interface TransportDocumentPdfInput {
  document: TransportDocumentRecord;
  job: JobRecord;
  /** null until the business settings are configured (D03). */
  settings: BusinessSettings | null;
}

/** Why the PDF carries a DRAFT mark, or null for an issued copy. */
export function transportDocumentDraftReason(
  input: TransportDocumentPdfInput,
): string | null {
  if (input.document.status === "draft") return "Draft - not yet issued";
  return null;
}

/**
 * A house B/L, house air waybill or air manifest, laid out from its field list:
 * issuer header and number, then the fields in their groups (two to a row,
 * wide ones across the page), and a signature line.
 */
export function renderTransportDocumentPdf(
  input: TransportDocumentPdfInput,
  options: { compress?: boolean } = {},
): Promise<Buffer> {
  const { document, job, settings } = input;
  const issuerName = settings?.issuer.name ?? "Issuer details not configured";
  const title = transportDocumentTitles[document.kind];
  const draftReason = transportDocumentDraftReason(input);

  const doc = new PDFDocument({
    size: "A4",
    margin: PAGE_MARGIN,
    bufferPages: true,
    compress: options.compress ?? true,
    info: {
      Title: `${title} ${document.documentNumber ?? "(draft)"}`,
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

  // Issuer block, document type and number on the right.
  doc.font("Helvetica-Bold").fontSize(20).fillColor(PRIMARY);
  doc.text(issuerName, left, PAGE_MARGIN, { width: width * 0.45 });
  doc.font("Helvetica").fontSize(10).fillColor(MUTED);
  const contact = [
    settings?.issuer.address,
    [settings?.issuer.phone, settings?.issuer.email]
      .filter(Boolean)
      .join("  |  "),
  ].filter(Boolean);
  for (const row of contact) {
    doc.text(String(row), left, doc.y + 2, { width: width * 0.45 });
  }
  const brandBottom = doc.y;
  doc.font("Helvetica-Bold").fontSize(10).fillColor(PRIMARY);
  doc.text(title.toUpperCase(), left + width * 0.45, PAGE_MARGIN, {
    width: width * 0.55,
    align: "right",
    characterSpacing: 0.6,
  });
  doc.font("Helvetica-Bold").fontSize(18).fillColor(INK);
  doc.text(
    document.documentNumber ?? "Not yet numbered",
    left + width * 0.45,
    PAGE_MARGIN + 18,
    { width: width * 0.55, align: "right" },
  );
  doc.font("Helvetica").fontSize(10).fillColor(MUTED);
  doc.text(
    `Job file ${job.fileNumber}`,
    left + width * 0.45,
    PAGE_MARGIN + 44,
    {
      width: width * 0.55,
      align: "right",
    },
  );
  doc.y = Math.max(brandBottom, PAGE_MARGIN + 60) + 10;
  doc
    .moveTo(left, doc.y)
    .lineTo(left + width, doc.y)
    .lineWidth(2.5)
    .strokeColor(PRIMARY)
    .stroke();
  doc.y += 16;

  const definitions = transportDocumentFields[document.kind];
  const groups = [...new Set(definitions.map((field) => field.group))];
  const gap = 8;
  const half = (width - gap) / 2;

  // A label can wrap in a narrow box; the value starts below it.
  const labelHeight = (label: string, boxWidth: number) => {
    doc.font("Helvetica").fontSize(LABEL);
    return doc.heightOfString(label.toUpperCase(), {
      width: boxWidth - 20,
      characterSpacing: 0.4,
    });
  };
  const boxHeight = (label: string, value: string, boxWidth: number) => {
    const head = labelHeight(label, boxWidth);
    doc.font("Helvetica").fontSize(BODY);
    return Math.max(
      38,
      head + doc.heightOfString(value || " ", { width: boxWidth - 20 }) + 14,
    );
  };
  const drawBox = (
    label: string,
    value: string,
    x: number,
    y: number,
    boxWidth: number,
    height: number,
  ) => {
    doc
      .lineWidth(0.8)
      .strokeColor(BORDER)
      .rect(x, y, boxWidth, height)
      .stroke();
    doc.font("Helvetica").fontSize(LABEL).fillColor(MUTED);
    doc.text(label.toUpperCase(), x + 10, y + 8, {
      width: boxWidth - 20,
      characterSpacing: 0.4,
    });
    const valueTop = y + 8 + labelHeight(label, boxWidth) + 5;
    doc.font("Helvetica").fontSize(BODY).fillColor(INK);
    doc.text(value, x + 10, valueTop, { width: boxWidth - 20 });
  };

  type Definition = (typeof definitions)[number];
  const drawRow = (row: Definition[]) => {
    const columns = row.length;
    const columnWidth = (width - gap * (columns - 1)) / columns;
    const values = row.map((field) => document.fields[field.key] ?? "");
    const height = Math.max(
      ...values.map((value, index) =>
        boxHeight(row[index].label, value, columnWidth),
      ),
    );
    if (doc.y + height > bottom()) doc.addPage();
    const y = doc.y;
    row.forEach((field, index) => {
      drawBox(
        field.label,
        values[index],
        left + index * (columnWidth + gap),
        y,
        columnWidth,
        height,
      );
    });
    doc.y = y + height;
  };

  for (const group of groups) {
    const inGroup = definitions.filter((field) => field.group === group);
    if (doc.y + 70 > bottom()) doc.addPage();
    doc.font("Helvetica-Bold").fontSize(BODY).fillColor(PRIMARY);
    doc.text(group.toUpperCase(), left, doc.y, { characterSpacing: 0.8 });
    doc.y += 4;

    // Short fields sit three to a row, party and text blocks two to a row,
    // and the wide fields take the full width.
    let buffer: Definition[] = [];
    const flush = () => {
      if (buffer.length > 0) drawRow(buffer);
      buffer = [];
    };
    for (const field of inGroup) {
      if (fullWidth.has(field.key)) {
        flush();
        drawRow([field]);
        continue;
      }
      const capacity = field.multiline ? 2 : 3;
      if (
        buffer.length > 0 &&
        (Boolean(buffer[0].multiline) !== Boolean(field.multiline) ||
          buffer.length >= capacity)
      ) {
        flush();
      }
      buffer.push(field);
    }
    flush();
    doc.y += 6;
  }

  // Signature line for the issuer.
  // It sits at the foot of the last page.
  if (doc.y + 50 > bottom()) doc.addPage();
  const signatureTop = Math.max(doc.y + 4, bottom() - 50);
  doc.font("Helvetica-Bold").fontSize(BODY).fillColor(PRIMARY);
  doc.text(`For ${issuerName}`, left, signatureTop, { width: half });
  for (const [index, label] of ["Name and signature", "Date"].entries()) {
    const x = left + index * (half + gap);
    doc
      .moveTo(x, signatureTop + 36)
      .lineTo(x + half, signatureTop + 36)
      .lineWidth(0.8)
      .strokeColor(SECONDARY)
      .stroke();
    doc.font("Helvetica").fontSize(LABEL).fillColor(MUTED);
    doc.text(label, x, signatureTop + 40, { width: half });
  }

  // Footer, DRAFT and VOID marks on every page.
  const range = doc.bufferedPageRange();
  for (let index = range.start; index < range.start + range.count; index += 1) {
    doc.switchToPage(index);
    const { height, width: pageWidth } = doc.page;
    doc.page.margins.bottom = 0;
    doc.font("Helvetica").fontSize(LABEL).fillColor(MUTED);
    doc.text(
      `${issuerName}  |  ${document.documentNumber ?? "Draft"}  |  Page ${index + 1} of ${range.count}`,
      left,
      height - PAGE_MARGIN + 6,
      { width, align: "center", lineBreak: false },
    );
    const mark =
      document.status === "void" ? "VOID" : draftReason ? "DRAFT" : null;
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
        (document.status === "void"
          ? `Void - ${document.voidReason ?? ""}`
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
