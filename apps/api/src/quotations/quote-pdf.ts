import PDFDocument from "pdfkit";
import { quoteBasisLabels, quoteLineTotalMinor } from "@bjh/contracts";
import type { BusinessSettings } from "@bjh/contracts";
import type {
  QuoteLineRecord,
  QuoteRecord,
  QuoteVersionRecord,
} from "../database/database.port";

// Colours match the document layout preview (apps/web/app/styles.css).
const PRIMARY = "#0b3fae";
const SECONDARY = "#5c9fd6";
const INK = "#17324d";
const MUTED = "#526b7d";
const BORDER = "#d7e3ed";
const CANVAS = "#f4f8fc";
const DRAFT_RED = "#b3261e";

const PAGE_MARGIN = 50;

export interface QuotePdfInput {
  quote: QuoteRecord;
  version: QuoteVersionRecord;
  /** null until the business settings are configured (D03). */
  settings: BusinessSettings | null;
}

/** Why the PDF carries a DRAFT mark, or null when it is a clean issued copy. */
export function quoteDraftReason(input: QuotePdfInput): string | null {
  if (input.version.status === "draft") return "Draft - not yet issued";
  if (!input.settings) return "Draft - business settings not configured";
  return null;
}

/** 25000 + USD -> "$250"; 150050 + GHS -> "GHS 1,500.50". */
export function formatQuoteAmount(minor: number, currency: string): string {
  const whole = minor % 100 === 0;
  return new Intl.NumberFormat("en", {
    style: "currency",
    currency,
    currencyDisplay: currency === "USD" ? "narrowSymbol" : "code",
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  })
    .format(minor / 100)
    .replace(/\p{Zs}/gu, " ");
}

function amountText(
  line: QuoteLineRecord,
  minor: number | null,
  currency: string,
): string {
  if (minor === null) return line.basis === "at_cost" ? "At cost" : "-";
  const money = formatQuoteAmount(minor, currency);
  return line.basis === "at_cost" ? `At cost - ${money}` : money;
}

function basisText(line: QuoteLineRecord): string {
  if (line.basis === "at_cost" && line.basisNote) return line.basisNote;
  const label = quoteBasisLabels[line.basis];
  return line.basisNote ? `${label} - ${line.basisNote}` : label;
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(iso));
}

/** Groups consecutive lines that share a heading, as printed in the samples. */
export function groupLines(
  lines: QuoteLineRecord[],
): Array<{ heading: string; lines: QuoteLineRecord[] }> {
  const sections: Array<{ heading: string; lines: QuoteLineRecord[] }> = [];
  for (const line of lines) {
    const heading = line.section ?? "Charges";
    const last = sections[sections.length - 1];
    if (last && last.heading === heading) last.lines.push(line);
    else sections.push({ heading, lines: [line] });
  }
  return sections;
}

export function renderQuotePdf(
  input: QuotePdfInput,
  options: { compress?: boolean } = {},
): Promise<Buffer> {
  const { quote, version, settings } = input;
  const draftReason = quoteDraftReason(input);
  const issuerName = settings?.issuer.name ?? "Issuer details not configured";

  const doc = new PDFDocument({
    size: "A4",
    margin: PAGE_MARGIN,
    bufferPages: true,
    compress: options.compress ?? true,
    info: {
      Title: `${version.title}${quote.quoteNumber ? ` (${quote.quoteNumber})` : ""}`,
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
  const ensure = (height: number) => {
    if (doc.y + height > bottom()) doc.addPage();
  };
  const heading = (text: string) => {
    ensure(40);
    doc.moveDown(0.8);
    doc.font("Helvetica-Bold").fontSize(11).fillColor(PRIMARY).text(text, left);
    doc.moveDown(0.3);
  };
  const paragraph = (text: string) => {
    doc.font("Helvetica").fontSize(9.5).fillColor(INK).text(text, left, doc.y, {
      width,
      lineGap: 2,
    });
  };

  // Brand block: issuer identity over a blue rule.
  doc.font("Helvetica-Bold").fontSize(16).fillColor(PRIMARY);
  doc.text(issuerName, left, PAGE_MARGIN, { width });
  const contact = [
    settings?.issuer.address,
    [settings?.issuer.phone, settings?.issuer.email, settings?.issuer.website]
      .filter(Boolean)
      .join("  |  "),
  ].filter(Boolean);
  doc.font("Helvetica").fontSize(8.5).fillColor(MUTED);
  for (const row of contact) doc.text(String(row), left, doc.y, { width });
  doc.moveDown(0.4);
  doc
    .moveTo(left, doc.y)
    .lineTo(left + width, doc.y)
    .lineWidth(2)
    .strokeColor(PRIMARY)
    .stroke();
  doc.moveDown(0.8);

  doc
    .font("Helvetica-Bold")
    .fontSize(8)
    .fillColor(PRIMARY)
    .text("QUOTATION", left, doc.y, { characterSpacing: 1 });
  doc.moveDown(0.2);
  doc.font("Helvetica-Bold").fontSize(18).fillColor(INK);
  doc.text(version.title, left, doc.y, { width });
  if (version.subtitle) {
    doc.font("Helvetica").fontSize(10.5).fillColor(MUTED);
    doc.text(version.subtitle, left, doc.y, { width });
  }
  doc.moveDown(0.8);

  // Metadata grid: reference, date, prepared for, shipment.
  const cells: Array<[string, string]> = [
    [
      "Quote reference",
      `${quote.quoteNumber ?? "Not yet numbered"} (version ${version.versionNumber})`,
    ],
    [
      "Date",
      version.issuedAt ? formatDate(version.issuedAt) : "Not yet issued",
    ],
    ["Prepared for", quote.customerCompanyName],
    ["Shipment", version.shipmentScope ?? "-"],
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
  doc.x = left;
  doc.y = gridTop + cellHeight * 2 + 14;

  if (version.intro) paragraph(version.intro);

  // Charge tables, one per heading.
  for (const section of groupLines(version.lines)) {
    const sized = section.lines.some((line) => line.sizeAmountsMinor !== null);
    const hasSingleAmount = section.lines.some(
      (line) => line.sizeAmountsMinor === null && line.amountMinor !== null,
    );
    const basisWidth = hasSingleAmount ? 0.23 : 0.28;
    const amountWidth = hasSingleAmount ? 0.15 : 0;
    const sizeWidth =
      Math.min(hasSingleAmount ? 0.34 : 0.4, 0.2 * version.sizeLabels.length) /
      Math.max(version.sizeLabels.length, 1);
    const chargeWidth =
      1 - basisWidth - amountWidth - sizeWidth * version.sizeLabels.length;
    const columns = sized
      ? [
          {
            title: "Charge",
            width: width * chargeWidth,
          },
          ...version.sizeLabels.map((title) => ({
            title,
            width: width * sizeWidth,
          })),
          ...(hasSingleAmount
            ? [{ title: "Amount", width: width * amountWidth }]
            : []),
          { title: "Basis", width: width * basisWidth },
        ]
      : [
          { title: "Charge", width: width * 0.3 },
          { title: "Size", width: width * 0.09 },
          { title: "Qty", width: width * 0.07 },
          { title: "Unit price", width: width * 0.15 },
          { title: "Total", width: width * 0.16 },
          { title: "Basis", width: width * 0.23 },
        ];
    const drawHeader = () => {
      const y = doc.y;
      doc.rect(left, y, width, 20).fillAndStroke(CANVAS, BORDER);
      let x = left;
      doc.font("Helvetica-Bold").fontSize(8.5).fillColor(PRIMARY);
      for (const column of columns) {
        doc.text(column.title, x + 6, y + 6, { width: column.width - 12 });
        x += column.width;
      }
      doc.y = y + 20;
    };
    heading(section.heading);
    ensure(60);
    drawHeader();
    for (const line of section.lines) {
      const cellsText = sized
        ? [
            line.description,
            ...version.sizeLabels.map((_, at) =>
              amountText(
                line,
                line.sizeAmountsMinor?.[at] ?? null,
                version.currency,
              ),
            ),
            ...(hasSingleAmount
              ? [
                  line.sizeAmountsMinor === null
                    ? amountText(line, line.amountMinor, version.currency)
                    : "-",
                ]
              : []),
            basisText(line),
          ]
        : [
            line.description,
            line.containerSize ?? "",
            String(line.quantity),
            amountText(line, line.amountMinor, version.currency),
            amountText(line, quoteLineTotalMinor(line), version.currency),
            basisText(line),
          ];
      doc.font("Helvetica").fontSize(9);
      // The charge's description, if any, sits under its name in smaller type.
      const detailsHeight = line.details
        ? doc
            .fontSize(8)
            .heightOfString(line.details, { width: columns[0].width - 12 }) + 2
        : 0;
      doc.fontSize(9);
      const rowHeight =
        Math.max(
          ...cellsText.map(
            (text, index) =>
              doc.heightOfString(text, { width: columns[index].width - 12 }) +
              (index === 0 ? detailsHeight : 0),
          ),
        ) + 12;
      if (doc.y + rowHeight > bottom()) {
        doc.addPage();
        drawHeader();
      }
      const y = doc.y;
      let x = left;
      cellsText.forEach((text, index) => {
        doc.fillColor(INK).text(text, x + 6, y + 6, {
          width: columns[index].width - 12,
        });
        if (index === 0 && line.details) {
          doc
            .fontSize(8)
            .fillColor(MUTED)
            .text(line.details, x + 6, doc.y + 2, {
              width: columns[index].width - 12,
            })
            .fontSize(9);
        }
        x += columns[index].width;
      });
      doc
        .moveTo(left, y + rowHeight)
        .lineTo(left + width, y + rowHeight)
        .lineWidth(0.7)
        .strokeColor(BORDER)
        .stroke();
      doc.y = y + rowHeight;
    }
  }

  // A quote of unit prices adds up; one priced per size column does not.
  if (version.lines.every((line) => line.sizeAmountsMinor === null)) {
    const total = version.lines.reduce(
      (sum, line) => sum + (quoteLineTotalMinor(line) ?? 0),
      0,
    );
    doc.moveDown(0.4);
    doc.font("Helvetica-Bold").fontSize(10).fillColor(INK);
    doc.text(
      `Total: ${formatQuoteAmount(total, version.currency)}${
        version.lines.some((line) => line.amountMinor === null)
          ? " (at-cost items are billed as incurred)"
          : ""
      }`,
      left,
      doc.y,
      { width, align: "right" },
    );
  }

  doc.moveDown(0.6);
  doc.font("Helvetica-Bold").fontSize(9).fillColor(INK);
  doc.text("Currency ", left, doc.y, { continued: true });
  doc
    .font("Helvetica")
    .text(`All amounts are in ${version.currency} unless otherwise stated.`);
  if (version.atCostNote) {
    doc.moveDown(0.3);
    paragraph(version.atCostNote);
  }

  if (version.procedureSteps.length > 0) {
    heading("Clearance procedure");
    version.procedureSteps.forEach((step, index) => {
      ensure(30);
      paragraph(`${index + 1}. ${step}`);
      doc.moveDown(0.2);
    });
  }
  if (version.requiredDocuments.length > 0) {
    heading("Documents required");
    for (const item of version.requiredDocuments) {
      ensure(20);
      paragraph(`- ${item}`);
    }
    if (version.documentsNote) {
      doc.moveDown(0.3);
      paragraph(version.documentsNote);
    }
  }
  if (version.timeline) {
    heading("Timeline");
    paragraph(version.timeline);
  }
  if (version.terms.length > 0) {
    heading("Important terms");
    for (const item of version.terms) {
      ensure(24);
      paragraph(`- ${item}`);
      doc.moveDown(0.2);
    }
  }

  // Acceptance: BJH on the left, the client on the right.
  ensure(110);
  doc.moveDown(1.6);
  const signatureTop = doc.y;
  const half = width / 2 - 12;
  [
    [`For ${issuerName}`, left],
    ["Accepted by client", left + width / 2 + 12],
  ].forEach(([title, x]) => {
    doc.font("Helvetica-Bold").fontSize(9.5).fillColor(PRIMARY);
    doc.text(String(title), Number(x), signatureTop, { width: half });
    ["Name and signature", "Date"].forEach((label, row) => {
      const y = signatureTop + 34 + row * 34;
      doc
        .moveTo(Number(x), y)
        .lineTo(Number(x) + half, y)
        .lineWidth(0.7)
        .strokeColor(SECONDARY)
        .stroke();
      doc.font("Helvetica").fontSize(7.5).fillColor(MUTED);
      doc.text(label, Number(x), y + 3, { width: half });
    });
  });

  // Footer and DRAFT marks on every page.
  const range = doc.bufferedPageRange();
  for (let index = range.start; index < range.start + range.count; index += 1) {
    doc.switchToPage(index);
    const { height, width: pageWidth } = doc.page;
    doc.page.margins.bottom = 0;
    doc.font("Helvetica").fontSize(7.5).fillColor(MUTED);
    doc.text(
      `${issuerName}  |  Page ${index + 1} of ${range.count}`,
      left,
      height - 34,
      { width, align: "center", lineBreak: false },
    );
    if (draftReason) {
      doc.save();
      doc.fillColor(DRAFT_RED).opacity(0.1);
      doc.rotate(-35, { origin: [pageWidth / 2, height / 2] });
      doc.font("Helvetica-Bold").fontSize(110);
      doc.text("DRAFT", 0, height / 2 - 60, {
        width: pageWidth,
        align: "center",
        lineBreak: false,
      });
      doc.restore();
      doc.opacity(1).font("Helvetica-Bold").fontSize(8).fillColor(DRAFT_RED);
      doc.text(draftReason.toUpperCase(), left, 24, {
        width,
        align: "right",
        lineBreak: false,
      });
    }
  }

  doc.end();
  return done;
}
