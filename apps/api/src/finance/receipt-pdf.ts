import PDFDocument from "pdfkit";
import { drawLogo } from "../assets/logo";
import type { BusinessSettings } from "@bjh/contracts";
import type {
  BatchReceiptLine,
  CustomerCreditRecord,
  InvoicePaymentRecord,
  JobRecord,
} from "../database/database.port";
import { formatInvoiceAmount } from "./invoice-pdf";
import type { InvoiceView } from "./invoices.service";

// Same palette as the other PDFs.
const PRIMARY = "#0b3fae";
const SECONDARY = "#5c9fd6";
const INK = "#17324d";
const MUTED = "#526b7d";
const BORDER = "#d7e3ed";
const MARK_RED = "#b3261e";

const PAGE_MARGIN = 40;
const LOGO_HEIGHT = 40;

// Print type scale (pt): body text 11, small labels 9, footer 9.
const BODY = 11;
const LABEL = 9;
// Space kept above the bottom margin for the page footer.
const FOOTER_SPACE = 24;

export const methodLabels: Record<InvoicePaymentRecord["method"], string> = {
  cash: "Cash",
  bank_transfer: "Bank transfer",
  cheque: "Cheque",
  mobile_money: "Mobile money",
  other: "Other",
};

export interface ReceiptPdfInput {
  payment: InvoicePaymentRecord;
  invoice: InvoiceView;
  job: JobRecord;
  /** null until the business settings are configured (D03). */
  settings: BusinessSettings | null;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(value));
}

/**
 * A conventional receipt for one payment staff recorded. It acknowledges the
 * amount, method and invoice; it makes no claim that a bank verified the
 * payment. A reversed payment is stamped REVERSED with its reason.
 */
export function renderReceiptPdf(
  input: ReceiptPdfInput,
  options: { compress?: boolean } = {},
): Promise<Buffer> {
  const { payment, invoice, job, settings } = input;
  const money = (minor: number) => formatInvoiceAmount(minor, invoice.currency);
  return drawReceipt(
    {
      receiptNumber: payment.receiptNumber ?? "",
      amount: money(payment.amountMinor),
      cells: [
        ["Received from", job.customerCompanyName],
        ["Date received", formatDate(payment.receivedOn)],
        ["In payment of invoice", invoice.invoiceNumber ?? "-"],
        ["Job file", job.fileNumber],
        ["Payment method", methodLabels[payment.method]],
        ["Reference", payment.reference ?? "-"],
        ["Invoice total", money(invoice.totalMinor)],
        ["Invoice balance now", money(invoice.outstandingMinor)],
      ],
      note: payment.note,
      reversal: payment.reversal,
      settings,
    },
    options,
  );
}

/**
 * The receipt for money received on account (client walkthrough, 2026-11-03):
 * a payment not set against any invoice, kept as credit for later invoices.
 */
export function renderCreditReceiptPdf(
  input: { credit: CustomerCreditRecord; settings: BusinessSettings | null },
  options: { compress?: boolean } = {},
): Promise<Buffer> {
  const { credit, settings } = input;
  const money = (minor: number) => formatInvoiceAmount(minor, credit.currency);
  return drawReceipt(
    {
      receiptNumber: credit.receiptNumber,
      amount: money(credit.amountMinor),
      cells: [
        ["Received from", credit.companyName],
        ["Date received", formatDate(credit.receivedOn)],
        ["In payment of", "On account (credit)"],
        ["Payment method", methodLabels[credit.method]],
        ["Reference", credit.reference ?? "-"],
        ["Credit left to apply", money(credit.availableMinor)],
      ],
      note: credit.note,
      reversal: credit.reversal,
      settings,
    },
    options,
  );
}

/**
 * One receipt for one payment that settled several invoices (Evans,
 * 2026-11-04): the amount received, then each invoice with what it got and
 * what it still owes. A reversed line says so; the whole receipt is stamped
 * REVERSED only when every line was reversed.
 */
export function renderBatchReceiptPdf(
  input: { lines: BatchReceiptLine[]; settings: BusinessSettings | null },
  options: { compress?: boolean } = {},
): Promise<Buffer> {
  const { lines, settings } = input;
  const [first] = lines;
  const money = (minor: number) => formatInvoiceAmount(minor, first.currency);
  const total = lines.reduce((sum, line) => sum + line.payment.amountMinor, 0);
  const reversed = lines.filter((line) => line.payment.reversal);
  return drawReceipt(
    {
      receiptNumber: first.payment.receiptNumber ?? "",
      amount: money(total),
      cells: [
        ["Received from", first.customerCompanyName],
        ["Date received", formatDate(first.payment.receivedOn)],
        ["Payment method", methodLabels[first.payment.method]],
        ["Reference", first.payment.reference ?? "-"],
      ],
      invoices: lines.map((line) => [
        line.invoiceNumber,
        line.fileNumber,
        money(line.payment.amountMinor) +
          (line.payment.reversal ? " (reversed)" : ""),
        money(line.invoiceOutstandingMinor),
      ]),
      note: first.payment.note,
      reversal:
        reversed.length === lines.length ? reversed[0].payment.reversal : null,
      settings,
    },
    options,
  );
}

export interface PaymentSummaryLine {
  receivedOn: string;
  receiptNumber: string;
  paidFor: string;
  method: InvoicePaymentRecord["method"];
  currency: string;
  amountMinor: number;
  reversed: boolean;
}

/**
 * A customer's payments on one page (Evans, 2026-11-04): the total received,
 * then each payment with its receipt number. Reversed payments are listed but
 * not counted. It is a summary, not a receipt: it has no number of its own.
 */
export function renderPaymentSummaryPdf(
  input: {
    companyName: string;
    from: string | null;
    to: string | null;
    lines: PaymentSummaryLine[];
    settings: BusinessSettings | null;
  },
  options: { compress?: boolean } = {},
): Promise<Buffer> {
  const { lines, settings } = input;
  const issuerName = settings?.issuer.name ?? "Issuer details not configured";
  const doc = new PDFDocument({
    size: "A4",
    margin: PAGE_MARGIN,
    compress: options.compress ?? true,
    info: { Title: `Payments from ${input.companyName}`, Author: issuerName },
  });
  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
  const left = PAGE_MARGIN;
  const width = doc.page.width - PAGE_MARGIN * 2;

  const bottom = doc.page.height - PAGE_MARGIN - FOOTER_SPACE;

  const logoHeight = drawLogo(doc, left, PAGE_MARGIN, LOGO_HEIGHT);
  doc.font("Helvetica-Bold").fontSize(20).fillColor(PRIMARY);
  doc.text(issuerName, left, PAGE_MARGIN + (logoHeight ? logoHeight + 6 : 0), {
    width: width * 0.5,
  });
  const brandBottom = doc.y;
  doc.font("Helvetica-Bold").fontSize(11).fillColor(PRIMARY);
  doc.text("PAYMENT SUMMARY RECEIPT", left + width * 0.5, PAGE_MARGIN, {
    width: width * 0.5,
    align: "right",
    characterSpacing: 1.5,
  });
  doc.y = Math.max(brandBottom, PAGE_MARGIN + 28) + 10;
  doc
    .moveTo(left, doc.y)
    .lineTo(left + width, doc.y)
    .lineWidth(2.5)
    .strokeColor(PRIMARY)
    .stroke();
  doc.y += 18;

  const period =
    input.from || input.to
      ? `${input.from ? formatDate(input.from) : "First payment"} to ${input.to ? formatDate(input.to) : "today"}`
      : "All payments";
  doc.font("Helvetica").fontSize(LABEL).fillColor(MUTED);
  doc.text("RECEIVED FROM", left, doc.y, { characterSpacing: 0.5 });
  doc.font("Helvetica-Bold").fontSize(14).fillColor(INK);
  doc.text(input.companyName, left, doc.y + 3, { width });
  doc.font("Helvetica").fontSize(BODY).fillColor(MUTED);
  doc.text(period, left, doc.y + 3, { width });
  doc.y += 16;

  const totals = new Map<string, number>();
  for (const line of lines) {
    if (line.reversed) continue;
    totals.set(
      line.currency,
      (totals.get(line.currency) ?? 0) + line.amountMinor,
    );
  }
  const columns: Array<[string, number, "left" | "right"]> = [
    ["DATE", 0.21, "left"],
    ["RECEIPT", 0.25, "left"],
    ["PAID FOR", 0.23, "left"],
    ["METHOD", 0.14, "left"],
    ["AMOUNT", 0.17, "right"],
  ];
  const row = (values: string[], header: boolean) => {
    const cell = (share: number, align: "left" | "right") => ({
      width: width * share - 12,
      align,
      characterSpacing: header ? 0.5 : 0,
    });
    doc
      .font(header ? "Helvetica-Bold" : "Helvetica")
      .fontSize(header ? LABEL : 10)
      .fillColor(header ? PRIMARY : INK);
    const height = Math.max(
      ...columns.map(([, share, align], index) =>
        doc.heightOfString(values[index], cell(share, align)),
      ),
    );
    if (doc.y + height + 20 > bottom) doc.addPage();
    const top = doc.y;
    let x = left;
    columns.forEach(([, share, align], index) => {
      doc.text(values[index], x + 6, top + 9, cell(share, align));
      x += width * share;
    });
    const rowBottom = top + Math.max(30, height + 18);
    doc
      .moveTo(left, rowBottom)
      .lineTo(left + width, rowBottom)
      .lineWidth(header ? 1 : 0.6)
      .strokeColor(BORDER)
      .stroke();
    doc.y = rowBottom;
  };
  row(
    columns.map(([label]) => label),
    true,
  );
  for (const line of lines) {
    row(
      [
        formatDate(line.receivedOn),
        line.receiptNumber,
        line.paidFor,
        methodLabels[line.method],
        formatInvoiceAmount(line.amountMinor, line.currency) +
          (line.reversed ? " (reversed)" : ""),
      ],
      false,
    );
  }

  // The summing-up under the table: one total per currency, then the count.
  if (doc.y + (totals.size + 1) * 26 + 80 > bottom) {
    doc.addPage();
  }
  doc.y += 12;
  const labelX = left + width * 0.45;
  const valueX = left + width * 0.72;
  for (const [currency, minor] of totals.size > 0
    ? totals
    : new Map([["", 0]])) {
    const y = doc.y;
    doc.font("Helvetica-Bold").fontSize(12.5).fillColor(PRIMARY);
    doc.text(
      currency ? `Total received ${currency}` : "Total received",
      labelX,
      y,
      {
        width: width * 0.27,
        lineBreak: false,
      },
    );
    doc.text(
      currency ? formatInvoiceAmount(minor, currency) : "Nothing",
      valueX,
      y,
      { width: width * 0.28 - 6, align: "right", lineBreak: false },
    );
    doc.y = y + 24;
  }
  doc.font("Helvetica").fontSize(BODY).fillColor(MUTED);
  doc.text(
    `${lines.length} ${lines.length === 1 ? "payment" : "payments"}`,
    labelX,
    doc.y,
    { width: width * 0.55 - 6 },
  );
  doc.y += 24;

  doc
    .font("Helvetica")
    .fontSize(LABEL + 1)
    .fillColor(MUTED);
  doc.text(
    "This summary lists payments recorded by " +
      `${issuerName}. Each payment's receipt, by its number, is the record ` +
      "of that payment. Reversed payments are not counted in the total. " +
      "It is not a bank confirmation.",
    left,
    doc.y,
    { width },
  );

  doc.end();
  return done;
}

interface ReceiptLayout {
  receiptNumber: string;
  amount: string;
  cells: Array<[string, string]>;
  /** Invoice, job file, amount paid, balance now: one row per invoice settled. */
  invoices?: Array<[string, string, string, string]>;
  note: string | null;
  reversal: { reason: string } | null;
  settings: BusinessSettings | null;
}

function drawReceipt(
  input: ReceiptLayout,
  options: { compress?: boolean },
): Promise<Buffer> {
  const { receiptNumber, cells, settings } = input;
  const issuerName = settings?.issuer.name ?? "Issuer details not configured";

  const doc = new PDFDocument({
    size: "A4",
    margin: PAGE_MARGIN,
    compress: options.compress ?? true,
    info: {
      Title: `Receipt ${receiptNumber}`.trim(),
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

  const bottom = doc.page.height - PAGE_MARGIN - FOOTER_SPACE;

  // Brand block, receipt number on the right.
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
  doc.text("PAYMENT RECEIPT", left + width * 0.58, PAGE_MARGIN, {
    width: width * 0.42,
    align: "right",
    characterSpacing: 1.5,
  });
  doc.font("Helvetica-Bold").fontSize(18).fillColor(INK);
  doc.text(receiptNumber, left + width * 0.58, PAGE_MARGIN + 17, {
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
  doc.y += 20;

  // Amount received, set apart.
  doc
    .font("Helvetica")
    .fontSize(LABEL + 1)
    .fillColor(MUTED);
  doc.text("AMOUNT RECEIVED", left, doc.y, { characterSpacing: 0.5 });
  doc.font("Helvetica-Bold").fontSize(32).fillColor(INK);
  doc.text(input.amount, left, doc.y + 4, { width });
  doc.y += 18;

  const cellWidth = width / 2;
  const cellHeight = 54;
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
    doc.text(label.toUpperCase(), x + 10, y + 10, {
      width: cellWidth - 20,
      characterSpacing: 0.5,
    });
    doc.font("Helvetica-Bold").fontSize(12).fillColor(INK);
    doc.text(value, x + 10, y + 26, {
      width: cellWidth - 20,
      height: 18,
      ellipsis: true,
    });
  });
  doc.y = gridTop + cellHeight * Math.ceil(cells.length / 2) + 20;

  if (input.invoices) {
    const columns: Array<[string, number, "left" | "right"]> = [
      ["IN PAYMENT OF INVOICE", 0.3, "left"],
      ["JOB FILE", 0.26, "left"],
      ["AMOUNT PAID", 0.22, "right"],
      ["BALANCE NOW", 0.22, "right"],
    ];
    const row = (values: string[], header: boolean) => {
      if (doc.y > bottom - 90) doc.addPage();
      const top = doc.y;
      let x = left;
      doc
        .font("Helvetica-Bold")
        .fontSize(header ? LABEL : BODY)
        .fillColor(header ? PRIMARY : INK);
      const options = (share: number, align: "left" | "right") => ({
        width: width * share - 16,
        align,
        characterSpacing: header ? 0.5 : 0,
      });
      // A long value (a reversed amount) wraps; the row grows to fit it.
      const height = Math.max(
        ...columns.map(([, share, align], index) =>
          doc.heightOfString(values[index], options(share, align)),
        ),
      );
      columns.forEach(([, share, align], index) => {
        doc.text(values[index], x + 8, top + 9, options(share, align));
        x += width * share;
      });
      const rowBottom = top + Math.max(32, height + 18);
      doc
        .moveTo(left, rowBottom)
        .lineTo(left + width, rowBottom)
        .lineWidth(header ? 1 : 0.6)
        .strokeColor(BORDER)
        .stroke();
      doc.y = rowBottom;
    };
    row(
      columns.map(([label]) => label),
      true,
    );
    for (const values of input.invoices) row(values, false);
    doc.y += 20;
  }

  if (input.note) {
    doc.font("Helvetica-Bold").fontSize(BODY).fillColor(PRIMARY);
    doc.text("Note", left, doc.y, { width });
    doc.font("Helvetica").fontSize(BODY).fillColor(INK);
    doc.text(input.note, left, doc.y + 2, { width, lineGap: 2 });
    doc.moveDown(1);
  }

  doc
    .font("Helvetica")
    .fontSize(LABEL + 1)
    .fillColor(MUTED);
  doc.text(
    "This receipt acknowledges a payment recorded by " +
      `${issuerName}. It is not a bank confirmation.`,
    left,
    doc.y,
    { width },
  );

  // Received-by signature, at the foot of the page.
  const signatureTop = Math.max(doc.y + 40, bottom - 72);
  doc.font("Helvetica-Bold").fontSize(BODY).fillColor(PRIMARY);
  doc.text(`Received for ${issuerName}`, left, signatureTop, {
    width: width / 2 - 14,
  });
  const lineY = signatureTop + 52;
  doc
    .moveTo(left, lineY)
    .lineTo(left + width / 2 - 14, lineY)
    .lineWidth(0.8)
    .strokeColor(SECONDARY)
    .stroke();
  doc.font("Helvetica").fontSize(LABEL).fillColor(MUTED);
  doc.text("Name and signature", left, lineY + 4, { width: width / 2 - 14 });

  doc.page.margins.bottom = 0;
  doc.font("Helvetica").fontSize(LABEL).fillColor(MUTED);
  doc.text(
    `${issuerName}  |  Receipt ${receiptNumber}`,
    left,
    doc.page.height - PAGE_MARGIN + 6,
    { width, align: "center", lineBreak: false },
  );

  if (input.reversal) {
    const { height, width: pageWidth } = doc.page;
    doc.save();
    doc.fillColor(MARK_RED).opacity(0.1);
    doc.rotate(-35, { origin: [pageWidth / 2, height / 2] });
    doc.font("Helvetica-Bold").fontSize(90);
    doc.text("REVERSED", 0, height / 2 - 50, {
      width: pageWidth,
      align: "center",
      lineBreak: false,
    });
    doc.restore();
    doc.opacity(1).font("Helvetica-Bold").fontSize(8).fillColor(MARK_RED);
    doc.text(`REVERSED - ${input.reversal.reason}`.toUpperCase(), left, 24, {
      width,
      align: "right",
      lineBreak: false,
    });
  }

  doc.end();
  return done;
}
