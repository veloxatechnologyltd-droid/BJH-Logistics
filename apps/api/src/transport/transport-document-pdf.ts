import PDFDocument from "pdfkit";
import { drawLogo } from "../assets/logo";
import { renderDeliveryDocumentPdf } from "./delivery-document-pdf";
import {
  transportDocumentFields,
  transportDocumentTitles,
} from "@bjh/contracts";
import {
  parseBlContainers,
  parseTableRows,
  sumBlContainerWeights,
  sumTableColumn,
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
const LOGO_HEIGHT = 32;

// Print type scale (pt): body text 11, small labels 9, footer 9.
const BODY = 11;
const LABEL = 9;
// Space kept above the bottom margin for the page footer.
const FOOTER_SPACE = 24;
// Space the signature block needs below the last row of fields.
const SIGNATURE_SPACE = 56;
// The air manifest's certification text sits above the signature block.
const CERTIFICATION =
  "We certify that this manifest accurately reflects the shipment particulars stated on the referenced Master and House Air Waybills. Cargo is declared as non-dangerous unless otherwise supported by the accompanying shipping documents.";
const CERTIFICATION_SPACE = 52;

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
  // These two have their own one-page layouts, drawn like BJH's samples.
  if (
    input.document.kind === "delivery_order" ||
    input.document.kind === "proof_of_delivery"
  ) {
    return renderDeliveryDocumentPdf(input, options);
  }
  const { document, job, settings } = input;
  const issuerName = settings?.issuer.name ?? "Issuer details not configured";
  const title = transportDocumentTitles[document.kind];
  const draftReason = transportDocumentDraftReason(input);

  const doc = new PDFDocument({
    size: "A4",
    // BJH's air manifest sample is a landscape sheet; the others are portrait.
    layout: document.kind === "air_manifest" ? "landscape" : "portrait",
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
  const logoHeight = drawLogo(doc, left, PAGE_MARGIN, LOGO_HEIGHT);
  // With the logo above it, the name is set smaller so the one-page house
  // documents still fit on one page.
  doc
    .font("Helvetica-Bold")
    .fontSize(logoHeight ? 14 : 20)
    .fillColor(PRIMARY);
  doc.text(issuerName, left, PAGE_MARGIN + (logoHeight ? logoHeight + 4 : 0), {
    width: width * 0.45,
  });
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
  doc.y = Math.max(brandBottom, PAGE_MARGIN + 60) + (logoHeight ? 6 : 10);
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

  const certification = document.kind === "air_manifest";
  const lastReserve =
    SIGNATURE_SPACE + (certification ? CERTIFICATION_SPACE : 0);
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
    // The last row keeps the signature block with it: if both do not fit,
    // the row moves to the next page so a signature never stands alone.
    const reserve = row.includes(definitions[definitions.length - 1])
      ? lastReserve
      : 0;
    if (doc.y + height + reserve > bottom()) doc.addPage();
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

  // A house B/L lists its containers as a table with the total weight.
  const drawContainerTable = (rows: ReturnType<typeof parseBlContainers>) => {
    const columns = [
      { title: "Container no.", x: left + 10, w: width * 0.45, align: "left" },
      {
        title: "Seal no.",
        x: left + width * 0.5,
        w: width * 0.25,
        align: "left",
      },
      {
        title: "Weight (kg)",
        x: left + width * 0.75,
        w: width * 0.25 - 10,
        align: "right",
      },
    ] as const;
    const total = sumBlContainerWeights(rows);
    // 12000.5 prints as 12,000.5; text that is not a number prints as typed.
    const shown = (weight: string) => {
      const value = Number(weight.replace(/,/g, ""));
      return weight.trim() !== "" && Number.isFinite(value)
        ? value.toLocaleString("en-US", { maximumFractionDigits: 3 })
        : weight;
    };
    const rowHeight = 16;
    const headerRow = () => {
      // Text moves doc.y, so each row works from the y it started at.
      const y = doc.y;
      doc.rect(left, y, width, rowHeight).fillAndStroke("#eef4fb", BORDER);
      doc.font("Helvetica-Bold").fontSize(LABEL).fillColor(MUTED);
      for (const column of columns) {
        doc.text(column.title.toUpperCase(), column.x, y + 4, {
          width: column.w,
          align: column.align,
          characterSpacing: 0.4,
          lineBreak: false,
        });
      }
      doc.y = y + rowHeight;
    };
    const line = (cells: string[], bold = false) => {
      if (doc.y + rowHeight > bottom()) {
        doc.addPage();
        headerRow();
      }
      const y = doc.y;
      doc
        .lineWidth(0.8)
        .strokeColor(BORDER)
        .rect(left, y, width, rowHeight)
        .stroke();
      doc
        .font(bold ? "Helvetica-Bold" : "Helvetica")
        .fontSize(BODY)
        .fillColor(INK);
      columns.forEach((column, index) => {
        doc.text(cells[index], column.x, y + 3, {
          width: column.w,
          align: column.align,
          lineBreak: false,
        });
      });
      doc.y = y + rowHeight;
    };
    if (doc.y + rowHeight * 3 > bottom()) doc.addPage();
    headerRow();
    for (const row of rows) line([row.number, row.seal, shown(row.weightKg)]);
    if (total !== null && rows.length > 1)
      line(["Total", "", shown(total)], true);
  };

  // A manifest's shipment lines: numbered rows under a header, then a total row.
  const drawColumnsTable = (field: Definition, reserveAfter: number) => {
    const columns = field.columns ?? [];
    const rows = parseTableRows(document.fields[field.key], columns);
    if (rows.length === 0) {
      drawRow([{ ...field, columns: undefined }]);
      return;
    }
    const numbered = document.kind === "air_manifest";
    const numberWidth = numbered ? 30 : 0;
    const share =
      (width - numberWidth) / columns.reduce((t, c) => t + c.width, 0);
    const cells = [
      ...(numbered
        ? [{ title: "No.", w: numberWidth, align: "left" as const }]
        : []),
      ...columns.map((column) => ({
        title: column.label,
        w: column.width * share,
        align: column.sum ? ("right" as const) : ("left" as const),
      })),
    ];
    const pad = 6;
    // 12000.5 prints as 12,000.5; text that is not a number prints as typed.
    const shown = (value: string) => {
      const number = Number(value.replace(/,/g, ""));
      return value.trim() !== "" && Number.isFinite(number)
        ? number.toLocaleString("en-US", { maximumFractionDigits: 3 })
        : value;
    };
    const measure = (texts: string[], font: string, size: number) => {
      doc.font(font).fontSize(size);
      return Math.max(
        ...texts.map((text, index) =>
          doc.heightOfString(text || " ", { width: cells[index].w - pad * 2 }),
        ),
      );
    };
    const drawLine = (
      texts: string[],
      kind: "header" | "body" | "total",
      reserve: number,
    ) => {
      const font = kind === "body" ? "Helvetica" : "Helvetica-Bold";
      const size = kind === "header" ? LABEL : BODY;
      const height = measure(texts, font, size) + 10;
      if (doc.y + height + reserve > bottom()) {
        doc.addPage();
        if (kind !== "header") drawLine(headerTexts, "header", 0);
      }
      const y = doc.y;
      doc
        .lineWidth(0.8)
        .rect(left, y, width, height)
        .fillAndStroke(kind === "body" ? "#ffffff" : "#eef4fb", BORDER);
      doc
        .font(font)
        .fontSize(size)
        .fillColor(kind === "header" ? MUTED : INK);
      let x = left;
      texts.forEach((text, index) => {
        doc.text(
          kind === "header" ? text.toUpperCase() : text,
          x + pad,
          y + 5,
          {
            width: cells[index].w - pad * 2,
            align: cells[index].align,
            characterSpacing: kind === "header" ? 0.4 : 0,
          },
        );
        x += cells[index].w;
      });
      doc.y = y + height;
    };
    const headerTexts = cells.map((cell) => cell.title);
    const totals = columns.map((column) =>
      column.sum ? sumTableColumn(rows, column.key) : null,
    );
    const hasTotal = totals.some((value) => value !== null);
    const firstHeight = measure(headerTexts, "Helvetica-Bold", LABEL) + 10;
    if (doc.y + firstHeight + 40 > bottom()) doc.addPage();
    drawLine(headerTexts, "header", 0);
    rows.forEach((row, index) => {
      drawLine(
        [
          ...(numbered ? [String(index + 1)] : []),
          ...columns.map((column) =>
            column.sum ? shown(row[column.key] ?? "") : (row[column.key] ?? ""),
          ),
        ],
        "body",
        // The last line keeps the total row (and what must follow) with it.
        index === rows.length - 1 ? (hasTotal ? 40 : 0) + reserveAfter : 0,
      );
    });
    if (hasTotal) {
      const label = numbered ? "Manifest total" : "Total";
      const noun =
        document.kind === "air_manifest"
          ? `${rows.length} house air waybill${rows.length === 1 ? "" : "s"}`
          : "";
      const texts = [
        ...(numbered ? [""] : []),
        ...columns.map((column, index) => {
          if (index === 0) return numbered ? "" : label;
          const value = totals[index];
          if (value !== null) return shown(value);
          return index === columns.length - 1 ? noun : "";
        }),
      ];
      // With a number column the label goes in the first real column.
      if (numbered) texts[1] = label;
      drawLine(texts, "total", reserveAfter);
    }
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
      if (field.columns) {
        flush();
        drawColumnsTable(
          field,
          field === definitions[definitions.length - 1] ? lastReserve : 0,
        );
        continue;
      }
      if (
        document.kind === "house_bl" &&
        field.key === "containers" &&
        document.fields.containers
      ) {
        flush();
        drawContainerTable(parseBlContainers(document.fields.containers));
        continue;
      }
      // On the landscape sheet the handling information is a third column.
      const sideBySide =
        field.key === "handlingInformation" && doc.page.width > doc.page.height;
      if (fullWidth.has(field.key) && !sideBySide) {
        flush();
        drawRow([field]);
        continue;
      }
      // A landscape sheet takes more boxes to a row.
      const wide = doc.page.width > doc.page.height;
      const capacity = field.multiline ? (wide ? 3 : 2) : wide ? 5 : 3;
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

  if (certification) {
    if (doc.y + CERTIFICATION_SPACE + 50 > bottom()) doc.addPage();
    doc.font("Helvetica-Bold").fontSize(BODY).fillColor(PRIMARY);
    doc.text("CERTIFICATION", left, doc.y + 4, { characterSpacing: 0.8 });
    doc.font("Helvetica").fontSize(LABEL).fillColor(MUTED);
    doc.text(CERTIFICATION, left, doc.y + 4, { width });
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
