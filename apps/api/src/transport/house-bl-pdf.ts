import PDFDocument from "pdfkit";
import { drawLogo } from "../assets/logo";
import {
  parseDocumentTableRows,
  sumTableColumn,
  transportDocumentFields,
  transportDocumentTitles,
} from "@bjh/contracts";
import { packagesInWords } from "./packages-in-words";
import type { TransportDocumentPdfInput } from "./transport-document-pdf";

// Same palette as the other PDFs.
const PRIMARY = "#0b3fae";
const INK = "#17324d";
const MUTED = "#526b7d";
const BORDER = "#c3d3e3";
const BAND = "#eef4fb";
const WHITE = "#ffffff";
const MARK_RED = "#b3261e";

const PAGE_MARGIN = 40;
const LOGO_HEIGHT = 40;
const TEXT = 11;
const SMALL = 9;
const FOOTER_SPACE = 12;

const DRAFT_NOTE =
  "Draft prepared from supplied particulars; shipment and issue details remain subject to confirmation. No receipt of cargo or loading on board is certified by this unsigned draft.";

/** 1000 prints as 1,000; text that is not a number prints as typed. */
function shown(value: string): string {
  const parsed = Number(value.replace(/,/g, ""));
  return value.trim() !== "" && Number.isFinite(parsed)
    ? parsed.toLocaleString("en-US", { maximumFractionDigits: 3 })
    : value;
}

const blank = "_".repeat(34);

/**
 * The house bill of lading, drawn like the sample BJH's client sent: issuer
 * header, boxes for parties, route and vessel, then one table row per
 * container (goods, packages, gross weight, volume) with a total row and the
 * packages in words, the terms boxes and the signature line.
 */
export function renderHouseBlPdf(
  input: TransportDocumentPdfInput,
  options: { compress?: boolean } = {},
): Promise<Buffer> {
  const { document, settings } = input;
  const fields = document.fields;
  const issuerName = settings?.issuer.name ?? "Issuer details not configured";
  const title = transportDocumentTitles[document.kind];
  const isDraft = document.status === "draft";

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
  const ensure = (height: number) => {
    if (doc.y + height > bottom()) doc.addPage();
  };

  // Logo on the left; the issuer's name and details beside it.
  const logoHeight = drawLogo(doc, left, PAGE_MARGIN, LOGO_HEIGHT);
  const textX = left + (logoHeight ? 110 : 0);
  const textWidth = width - (textX - left);
  doc.font("Helvetica-Bold").fontSize(14).fillColor(PRIMARY);
  doc.text(issuerName.toUpperCase(), textX, PAGE_MARGIN + 2, {
    width: textWidth,
  });
  doc.font("Helvetica").fontSize(SMALL).fillColor(MUTED);
  for (const row of [
    settings?.issuer.address,
    [settings?.issuer.phone, settings?.issuer.email]
      .filter(Boolean)
      .join("  |  "),
  ].filter(Boolean)) {
    doc.text(String(row), textX, doc.y + 2, { width: textWidth });
  }
  doc.y = Math.max(doc.y, PAGE_MARGIN + logoHeight) + 8;
  doc
    .moveTo(left, doc.y)
    .lineTo(left + width, doc.y)
    .lineWidth(0.8)
    .strokeColor(BORDER)
    .stroke();
  doc.y += 10;

  doc.font("Helvetica-Bold").fontSize(22).fillColor(PRIMARY);
  doc.text("HOUSE BILL OF LADING", left, doc.y, { width });
  if (isDraft) {
    doc.font("Helvetica-Bold").fontSize(SMALL).fillColor(MUTED);
    doc.text("DRAFT - FOR REVIEW / NOT ISSUED", left, doc.y + 2, {
      width,
      characterSpacing: 0.3,
    });
  }
  doc.y += 12;

  // A box with a small label and lines of text; empty lines show a rule to
  // write on, as in the sample.
  const gap = 0;
  const half = (width - gap) / 2;
  type Box = {
    label: string;
    lines: string[];
    blanks?: number;
    compact?: boolean;
  };
  const boxLines = (box: Box) => {
    const lines = box.lines.filter((line) => line.trim() !== "");
    const rules = Math.max(0, (box.blanks ?? 0) - lines.length);
    return [...lines, ...Array.from({ length: rules }, () => blank)];
  };
  const boxHeight = (box: Box) => {
    doc.font("Helvetica").fontSize(TEXT);
    const body = boxLines(box).reduce(
      (sum, line) => sum + doc.heightOfString(line, { width: half - 20 }) + 3,
      0,
    );
    return Math.max(box.compact ? 34 : 40, SMALL + 15 + body);
  };
  const drawBox = (box: Box, x: number, y: number, height: number) => {
    doc.lineWidth(0.8).strokeColor(BORDER).rect(x, y, half, height).stroke();
    doc
      .font("Helvetica-Bold")
      .fontSize(SMALL - 1)
      .fillColor(MUTED);
    doc.text(box.label.toUpperCase(), x + 10, y + 6, {
      width: half - 20,
      characterSpacing: 0.3,
    });
    let lineY = y + 6 + SMALL + 4;
    for (const line of boxLines(box)) {
      doc.font("Helvetica").fontSize(TEXT).fillColor(INK);
      doc.text(line, x + 10, lineY, { width: half - 20 });
      lineY += doc.heightOfString(line, { width: half - 20 }) + 3;
    }
  };
  const boxRow = (a: Box, b: Box) => {
    const height = Math.max(boxHeight(a), boxHeight(b));
    ensure(height);
    const y = doc.y;
    drawBox(a, left, y, height);
    drawBox(b, left + half + gap, y, height);
    doc.y = y + height;
  };
  const lines = (value: string | undefined) =>
    (value ?? "").split("\n").map((line) => line.trim());

  const vesselVoyage = [fields.vessel, fields.voyage]
    .filter(Boolean)
    .join(" / ");
  const rows = parseDocumentTableRows(
    document.kind,
    transportDocumentFields.house_bl.find((f) => f.key === "containers")!,
    fields.containers,
  );
  const columns =
    transportDocumentFields.house_bl.find((f) => f.key === "containers")
      ?.columns ?? [];
  const totalFor = (key: string) => sumTableColumn(rows, key);

  boxRow(
    { label: "Shipper / exporter", lines: lines(fields.shipper), blanks: 2 },
    {
      label: "House B/L number",
      lines: [
        document.documentNumber ?? "Not yet numbered",
        `Master B/L no.: ${fields.masterReference ?? blank.slice(0, 22)}`,
      ],
    },
  );
  boxRow(
    {
      label: "Consignee",
      lines: lines(fields.consignee),
      blanks: 2,
    },
    { label: "Notify party", lines: lines(fields.notifyParty), blanks: 3 },
  );
  boxRow(
    { label: "Port of loading", lines: [fields.portOfLoading ?? ""] },
    { label: "Port of discharge", lines: [fields.portOfDischarge ?? ""] },
  );
  const containerCount = rows.length;
  const sizeText =
    fields.containerSize ||
    (containerCount > 0
      ? `${containerCount} container${containerCount === 1 ? "" : "s"}`
      : "");
  boxRow(
    { label: "Vessel / voyage", lines: [vesselVoyage] },
    { label: "Container quantity / size", lines: [sizeText] },
  );

  // Cargo particulars: the description, then one row per container.
  doc.font("Helvetica-Bold").fontSize(13).fillColor(PRIMARY);
  ensure(60);
  doc.text("CARGO PARTICULARS", left, doc.y + 8, { width });
  doc.y += 4;
  if (fields.goods) {
    doc.font("Helvetica").fontSize(TEXT).fillColor(INK);
    doc.text(`Description of goods: ${fields.goods}`, left, doc.y, { width });
  }
  doc.y += 8;

  const share = width / columns.reduce((sum, column) => sum + column.width, 0);
  const cells = columns.map((column) => ({
    key: column.key,
    title: column.label,
    w: column.width * share,
    right: Boolean(column.sum),
  }));
  const pad = 8;
  const measure = (texts: string[], font: string, size: number) => {
    doc.font(font).fontSize(size);
    return Math.max(
      ...texts.map((text, index) =>
        doc.heightOfString(text || " ", { width: cells[index].w - pad * 2 }),
      ),
    );
  };
  const headerTexts = cells.map((cell) => cell.title);
  const drawLine = (
    texts: string[],
    kind: "header" | "body" | "total",
    shade: boolean,
    reserve = 0,
  ) => {
    const font = kind === "body" ? "Helvetica" : "Helvetica-Bold";
    const size = kind === "header" ? 10 : TEXT;
    const height = measure(texts, font, size) + 12;
    if (doc.y + height + reserve > bottom()) {
      doc.addPage();
      if (kind !== "header") drawLine(headerTexts, "header", false);
    }
    const y = doc.y;
    doc
      .lineWidth(0.8)
      .rect(left, y, width, height)
      .fillAndStroke(
        kind === "header" ? PRIMARY : shade || kind === "total" ? BAND : WHITE,
        BORDER,
      );
    doc
      .font(font)
      .fontSize(size)
      .fillColor(kind === "header" ? WHITE : INK);
    let x = left;
    texts.forEach((text, index) => {
      doc.text(text, x + pad, y + 6, {
        width: cells[index].w - pad * 2,
        align: cells[index].right ? "right" : "left",
      });
      x += cells[index].w;
    });
    doc.y = y + height;
  };

  ensure(120);
  drawLine(headerTexts, "header", false);
  rows.forEach((row, index) => {
    drawLine(
      cells.map((cell) =>
        cell.right ? shown(row[cell.key] ?? "") : (row[cell.key] ?? ""),
      ),
      "body",
      index % 2 === 1,
      // The last row keeps the total row with it.
      index === rows.length - 1 ? 40 : 0,
    );
  });
  if (rows.length === 0) {
    drawLine(
      cells.map(() => ""),
      "body",
      false,
      40,
    );
  }
  const totalTexts = cells.map((cell, index) => {
    if (index === 0) return "TOTAL";
    const total = cell.right ? totalFor(cell.key) : null;
    if (total !== null) return shown(total);
    return cell.key === "goods" ? sizeText : "";
  });
  drawLine(totalTexts, "total", true);

  const packageTotal = totalFor("packages");
  const words =
    packageTotal === null ? null : packagesInWords(Number(packageTotal));
  if (words) {
    doc.font("Helvetica-Bold").fontSize(TEXT).fillColor(PRIMARY);
    doc.text(`Total packages in words: ${words}`, left, doc.y + 8, { width });
  }
  doc.y += 14;

  // The terms boxes and the signature stay together on one page.
  ensure(2 * 34 + 76);

  // Terms boxes: two to a row.
  const term = (label: string, value: string | undefined): Box => ({
    label,
    lines: [value ?? ""],
    blanks: 1,
    compact: true,
  });
  boxRow(
    term("Freight terms / payable at", fields.freightTerms),
    term("Shipped on board date", fields.shippedOnBoard),
  );
  boxRow(
    term("Place / date of issue", fields.placeAndDateOfIssue),
    term("Number of original bills of lading", fields.originals),
  );

  // Details from before this layout, only when they were filled in.
  const other = (
    [
      ["Forwarding agent", fields.forwardingAgent],
      ["Port delivery agent", fields.deliveryAgent],
      ["Place of receipt", fields.placeOfReceipt],
      ["Final place of delivery", fields.placeOfDelivery],
      ["Container status (FCL/LCL)", fields.containerStatus],
      ["Gross weight (kg)", fields.grossWeight],
      ["Measurement (CBM)", fields.measurement],
      ["Signed for the shipper by", fields.signatory],
    ] as const
  ).filter(([, value]) => value);
  for (let index = 0; index < other.length; index += 2) {
    const [a, b] = [other[index], other[index + 1]];
    boxRow(
      { label: a[0], lines: lines(a[1]) },
      b ? { label: b[0], lines: lines(b[1]) } : { label: "", lines: [] },
    );
  }

  // Signature line at the foot of the last page.
  const signatureTop = Math.max(doc.y + 14, bottom() - (isDraft ? 62 : 44));
  doc.font("Helvetica-Bold").fontSize(TEXT).fillColor(PRIMARY);
  doc.text(`For ${issuerName}`, left, signatureTop + 14, { width: half });
  const lineX = left + half + 10;
  doc
    .moveTo(lineX, signatureTop + 24)
    .lineTo(left + width - 10, signatureTop + 24)
    .lineWidth(0.8)
    .strokeColor(INK)
    .stroke();
  doc.font("Helvetica").fontSize(SMALL).fillColor(MUTED);
  doc.text("Authorized signature / stamp", lineX, signatureTop + 28, {
    width: half - 20,
  });
  if (isDraft) {
    doc
      .moveTo(left, signatureTop + 42)
      .lineTo(left + width, signatureTop + 42)
      .lineWidth(0.8)
      .strokeColor(BORDER)
      .stroke();
    doc
      .font("Helvetica")
      .fontSize(SMALL - 1)
      .fillColor(MUTED);
    doc.text(DRAFT_NOTE, left, signatureTop + 46, { width: width - 40 });
  }

  // Footer, DRAFT and VOID marks on every page.
  const draftReason = isDraft ? "Draft - not yet issued" : null;
  const range = doc.bufferedPageRange();
  for (let index = range.start; index < range.start + range.count; index += 1) {
    doc.switchToPage(index);
    const { height, width: pageWidth } = doc.page;
    doc.page.margins.bottom = 0;
    doc.font("Helvetica").fontSize(SMALL).fillColor(MUTED);
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
