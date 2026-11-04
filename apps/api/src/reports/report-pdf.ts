import PDFDocument from "pdfkit";
import type { BusinessSettings } from "@bjh/contracts";

// Same palette as the invoice, quote, statement and job report PDFs.
const PRIMARY = "#0b3fae";
const INK = "#17324d";
const MUTED = "#526b7d";
const BORDER = "#d7e3ed";
const CANVAS = "#f4f8fc";

const PAGE_MARGIN = 40;

export interface ReportColumn {
  header: string;
  /** Relative width; the columns of one table share the page in proportion. */
  width: number;
  align?: "left" | "right";
}

export type ReportBlock =
  | { kind: "heading"; text: string }
  | {
      kind: "kpis";
      items: Array<{ label: string; value: string; note?: string }>;
    }
  | {
      kind: "table";
      columns: ReportColumn[];
      rows: string[][];
      /** A bold closing row, such as totals. */
      total?: string[];
      /** Said instead of the table when there are no rows. */
      empty: string;
    }
  | { kind: "bars"; rows: Array<[string, number]>; empty: string }
  | { kind: "note"; text: string };

/** What a report says, before it is drawn. */
export interface ReportDocument {
  title: string;
  /** The period or "as of" line under the title. */
  subtitle: string;
  orientation: "portrait" | "landscape";
  blocks: ReportBlock[];
}

export interface ReportPdfInput {
  document: ReportDocument;
  settings: BusinessSettings | null;
  /** YYYY-MM-DD */
  generatedOn: string;
}

function formatDay(value: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));
}

/** Any report as a PDF: a header, then its blocks in order, with page numbers. */
export function renderReportPdf(
  input: ReportPdfInput,
  options: { compress?: boolean } = {},
): Promise<Buffer> {
  const { document, settings } = input;
  const issuerName = settings?.issuer.name ?? "Issuer details not configured";
  const doc = new PDFDocument({
    size: "A4",
    layout: document.orientation,
    margin: PAGE_MARGIN,
    bufferPages: true,
    compress: options.compress ?? true,
    info: { Title: document.title, Author: issuerName },
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

  // Header.
  doc.font("Helvetica-Bold").fontSize(16).fillColor(PRIMARY);
  doc.text(issuerName, left, PAGE_MARGIN, { width });
  doc.font("Helvetica-Bold").fontSize(14).fillColor(INK);
  doc.text(document.title, left, doc.y + 4, { width });
  doc.font("Helvetica").fontSize(10.5).fillColor(MUTED);
  doc.text(
    `${document.subtitle} · Prepared ${formatDay(input.generatedOn)}`,
    left,
    doc.y + 2,
    { width },
  );
  doc.moveDown(0.8);

  const heading = (text: string) => {
    // Leave room for the first rows too, so a heading is never alone at a page's foot.
    ensure(90);
    doc.font("Helvetica-Bold").fontSize(13).fillColor(PRIMARY);
    doc.text(text, left, doc.y, { width });
    doc
      .moveTo(left, doc.y + 2)
      .lineTo(left + width, doc.y + 2)
      .lineWidth(0.8)
      .strokeColor(BORDER)
      .stroke();
    doc.y += 8;
  };

  const kpis = (
    items: Array<{ label: string; value: string; note?: string }>,
  ) => {
    // Up to five tiles to a row on a wide page, four on a narrow one; more
    // than that split into even rows rather than leaving one tile alone.
    const cap = document.orientation === "landscape" ? 5 : 4;
    const perRow = Math.ceil(items.length / Math.ceil(items.length / cap));
    const gap = 8;
    const tile = (width - gap * (perRow - 1)) / perRow;
    for (let start = 0; start < items.length; start += perRow) {
      ensure(66);
      const y = doc.y;
      items.slice(start, start + perRow).forEach((item, index) => {
        const x = left + index * (tile + gap);
        doc.rect(x, y, tile, 58).fillAndStroke(CANVAS, BORDER);
        doc.font("Helvetica-Bold").fontSize(9).fillColor(MUTED);
        doc.text(item.label.toUpperCase(), x + 8, y + 7, {
          width: tile - 16,
          height: 11,
          ellipsis: true,
          characterSpacing: 0.4,
        });
        // A long amount shrinks to fit its tile instead of running over.
        let size = 16;
        doc.font("Helvetica-Bold");
        while (
          size > 9 &&
          doc.fontSize(size).widthOfString(item.value) > tile - 16
        ) {
          size -= 0.5;
        }
        doc.fontSize(size).fillColor(INK);
        doc.text(item.value, x + 8, y + 20, {
          width: tile - 16,
          lineBreak: false,
        });
        if (item.note) {
          doc.font("Helvetica").fontSize(9).fillColor(MUTED);
          doc.text(item.note, x + 8, y + 42, {
            width: tile - 16,
            height: 11,
            ellipsis: true,
          });
        }
      });
      doc.y = y + 58 + gap;
    }
    doc.moveDown(0.4);
  };

  const table = (block: Extract<ReportBlock, { kind: "table" }>) => {
    if (block.rows.length === 0) {
      doc.font("Helvetica").fontSize(10.5).fillColor(MUTED);
      doc.text(block.empty, left, doc.y, { width });
      doc.moveDown(0.8);
      return;
    }
    const weight = block.columns.reduce((sum, column) => sum + column.width, 0);
    const columns = block.columns.map(
      (column) => (column.width / weight) * width,
    );
    const measure = (cells: string[], bold: boolean) => {
      doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(10);
      return (
        Math.max(
          ...cells.map((text, index) =>
            doc.heightOfString(text, { width: columns[index] - 12 }),
          ),
        ) + 12
      );
    };
    const row = (cells: string[], style: "head" | "body" | "total") => {
      const bold = style !== "body";
      const height = measure(cells, bold);
      if (doc.y + height > bottom()) {
        doc.addPage();
        if (style !== "head")
          row(
            block.columns.map((c) => c.header),
            "head",
          );
      }
      const y = doc.y;
      if (style === "head") {
        doc.rect(left, y, width, height).fillAndStroke(CANVAS, BORDER);
      } else {
        doc
          .moveTo(left, y + height)
          .lineTo(left + width, y + height)
          .lineWidth(0.5)
          .strokeColor(BORDER)
          .stroke();
      }
      doc
        .font(bold ? "Helvetica-Bold" : "Helvetica")
        .fontSize(10)
        .fillColor(style === "body" ? INK : PRIMARY);
      let x = left;
      cells.forEach((text, index) => {
        doc.text(text, x + 6, y + 6, {
          width: columns[index] - 12,
          align: block.columns[index].align ?? "left",
        });
        x += columns[index];
      });
      doc.y = y + height;
    };
    ensure(40);
    row(
      block.columns.map((column) => column.header),
      "head",
    );
    for (const cells of block.rows) row(cells, "body");
    if (block.total) row(block.total, "total");
    doc.moveDown(1);
  };

  const bars = (block: Extract<ReportBlock, { kind: "bars" }>) => {
    const shown = block.rows
      .filter(([, value]) => value > 0)
      .sort((a, b) => b[1] - a[1]);
    if (shown.length === 0) {
      doc.font("Helvetica").fontSize(10.5).fillColor(MUTED);
      doc.text(block.empty, left, doc.y, { width });
      doc.moveDown(0.8);
      return;
    }
    const top = shown[0][1];
    const labelWidth = Math.min(180, width * 0.3);
    const trackWidth = width - labelWidth - 50;
    for (const [label, value] of shown) {
      ensure(22);
      const y = doc.y;
      doc.font("Helvetica").fontSize(10.5).fillColor(INK);
      doc.text(label, left, y + 2, {
        width: labelWidth - 8,
        lineBreak: false,
      });
      doc.rect(left + labelWidth, y + 2, trackWidth, 11).fill(CANVAS);
      doc
        .rect(
          left + labelWidth,
          y + 2,
          Math.max(3, (value / top) * trackWidth),
          11,
        )
        .fill(PRIMARY);
      doc.font("Helvetica-Bold").fontSize(10.5).fillColor(INK);
      doc.text(String(value), left + labelWidth + trackWidth + 8, y + 2, {
        width: 40,
        lineBreak: false,
      });
      doc.y = y + 20;
    }
    doc.moveDown(0.8);
  };

  for (const block of document.blocks) {
    if (block.kind === "heading") heading(block.text);
    else if (block.kind === "kpis") kpis(block.items);
    else if (block.kind === "table") table(block);
    else if (block.kind === "bars") bars(block);
    else {
      ensure(28);
      doc.font("Helvetica").fontSize(10).fillColor(MUTED);
      doc.text(block.text, left, doc.y, { width });
      doc.moveDown(0.8);
    }
  }

  // Page numbers.
  const range = doc.bufferedPageRange();
  for (let index = 0; index < range.count; index += 1) {
    doc.switchToPage(range.start + index);
    // Writing inside the bottom margin would otherwise start a new page.
    doc.page.margins.bottom = 0;
    doc.font("Helvetica").fontSize(9).fillColor(MUTED);
    doc.text(
      `${issuerName}  |  ${document.title}  |  Page ${index + 1} of ${range.count}`,
      left,
      doc.page.height - 28,
      { width, align: "center", lineBreak: false },
    );
  }
  doc.end();
  return done;
}
