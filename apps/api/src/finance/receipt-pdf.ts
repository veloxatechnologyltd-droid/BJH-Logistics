import PDFDocument from "pdfkit";
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

const PAGE_MARGIN = 50;

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

  doc.font("Helvetica-Bold").fontSize(16).fillColor(PRIMARY);
  doc.text(issuerName, left, PAGE_MARGIN, { width: width * 0.6 });
  const brandBottom = doc.y;
  doc.font("Helvetica-Bold").fontSize(8).fillColor(PRIMARY);
  doc.text("PAYMENT SUMMARY RECEIPT", left + width * 0.5, PAGE_MARGIN, {
    width: width * 0.5,
    align: "right",
    characterSpacing: 1,
  });
  doc.y = Math.max(brandBottom, PAGE_MARGIN + 20) + 6;
  doc
    .moveTo(left, doc.y)
    .lineTo(left + width, doc.y)
    .lineWidth(2)
    .strokeColor(PRIMARY)
    .stroke();
  doc.y += 14;

  const period =
    input.from || input.to
      ? `${input.from ? formatDate(input.from) : "First payment"} to ${input.to ? formatDate(input.to) : "today"}`
      : "All payments";
  doc.font("Helvetica").fontSize(9).fillColor(MUTED);
  doc.text("RECEIVED FROM", left, doc.y, { characterSpacing: 0.5 });
  doc.font("Helvetica-Bold").fontSize(12).fillColor(INK);
  doc.text(input.companyName, left, doc.y + 2, { width });
  doc.font("Helvetica").fontSize(9).fillColor(MUTED);
  doc.text(period, left, doc.y + 2, { width });
  doc.y += 12;

  const totals = new Map<string, number>();
  for (const line of lines) {
    if (line.reversed) continue;
    totals.set(
      line.currency,
      (totals.get(line.currency) ?? 0) + line.amountMinor,
    );
  }
  const columns: Array<[string, number, "left" | "right"]> = [
    ["DATE", 0.17, "left"],
    ["RECEIPT", 0.2, "left"],
    ["PAID FOR", 0.29, "left"],
    ["METHOD", 0.14, "left"],
    ["AMOUNT", 0.2, "right"],
  ];
  const row = (values: string[], header: boolean) => {
    const cell = (share: number, align: "left" | "right") => ({
      width: width * share - 12,
      align,
      characterSpacing: header ? 0.5 : 0,
    });
    doc
      .font("Helvetica")
      .fontSize(header ? 7.5 : 8.5)
      .fillColor(header ? MUTED : INK);
    const height = Math.max(
      ...columns.map(([, share, align], index) =>
        doc.heightOfString(values[index], cell(share, align)),
      ),
    );
    if (doc.y + height + 12 > doc.page.height - 60) doc.addPage();
    const top = doc.y;
    let x = left;
    columns.forEach(([, share, align], index) => {
      doc.text(values[index], x + 6, top + 6, cell(share, align));
      x += width * share;
    });
    const bottom = top + Math.max(20, height + 12);
    doc
      .moveTo(left, bottom)
      .lineTo(left + width, bottom)
      .lineWidth(0.7)
      .strokeColor(BORDER)
      .stroke();
    doc.y = bottom;
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
  if (doc.y + (totals.size + 1) * 20 + 60 > doc.page.height - 60) {
    doc.addPage();
  }
  doc.y += 8;
  const labelX = left + width * 0.45;
  const valueX = left + width * 0.72;
  for (const [currency, minor] of totals.size > 0
    ? totals
    : new Map([["", 0]])) {
    const y = doc.y;
    doc.font("Helvetica-Bold").fontSize(10).fillColor(PRIMARY);
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
    doc.y = y + 18;
  }
  doc.font("Helvetica").fontSize(8.5).fillColor(MUTED);
  doc.text(
    `${lines.length} ${lines.length === 1 ? "payment" : "payments"}`,
    labelX,
    doc.y,
    { width: width * 0.55 - 6 },
  );
  doc.y += 18;

  doc.font("Helvetica").fontSize(8.5).fillColor(MUTED);
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

  // Brand block, receipt number on the right.
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
  doc.text("PAYMENT RECEIPT", left + width * 0.6, PAGE_MARGIN, {
    width: width * 0.4,
    align: "right",
    characterSpacing: 1,
  });
  doc.font("Helvetica-Bold").fontSize(15).fillColor(INK);
  doc.text(receiptNumber, left + width * 0.6, PAGE_MARGIN + 13, {
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
  doc.y += 14;

  // Amount received, set apart.
  doc.font("Helvetica").fontSize(9).fillColor(MUTED);
  doc.text("AMOUNT RECEIVED", left, doc.y, { characterSpacing: 0.5 });
  doc.font("Helvetica-Bold").fontSize(24).fillColor(INK);
  doc.text(input.amount, left, doc.y + 2, { width });
  doc.y += 14;

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
  doc.y = gridTop + cellHeight * Math.ceil(cells.length / 2) + 14;

  if (input.invoices) {
    const columns: Array<[string, number, "left" | "right"]> = [
      ["IN PAYMENT OF INVOICE", 0.3, "left"],
      ["JOB FILE", 0.26, "left"],
      ["AMOUNT PAID", 0.22, "right"],
      ["BALANCE NOW", 0.22, "right"],
    ];
    const row = (values: string[], header: boolean) => {
      if (doc.y > doc.page.height - 120) doc.addPage();
      const top = doc.y;
      let x = left;
      doc
        .font(header ? "Helvetica" : "Helvetica-Bold")
        .fontSize(header ? 7.5 : 9.5)
        .fillColor(header ? MUTED : INK);
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
        doc.text(values[index], x + 8, top + 6, options(share, align));
        x += width * share;
      });
      const bottom = top + Math.max(22, height + 12);
      doc
        .moveTo(left, bottom)
        .lineTo(left + width, bottom)
        .lineWidth(0.7)
        .strokeColor(BORDER)
        .stroke();
      doc.y = bottom;
    };
    row(
      columns.map(([label]) => label),
      true,
    );
    for (const values of input.invoices) row(values, false);
    doc.y += 14;
  }

  if (input.note) {
    doc.font("Helvetica-Bold").fontSize(9.5).fillColor(PRIMARY);
    doc.text("Note", left, doc.y, { width });
    doc.font("Helvetica").fontSize(9.5).fillColor(INK);
    doc.text(input.note, left, doc.y + 2, { width, lineGap: 2 });
    doc.moveDown(0.8);
  }

  doc.font("Helvetica").fontSize(8.5).fillColor(MUTED);
  doc.text(
    "This receipt acknowledges a payment recorded by " +
      `${issuerName}. It is not a bank confirmation.`,
    left,
    doc.y,
    { width },
  );

  // Received-by signature.
  doc.y += 40;
  const signatureTop = doc.y;
  doc.font("Helvetica-Bold").fontSize(9.5).fillColor(PRIMARY);
  doc.text(`Received for ${issuerName}`, left, signatureTop, {
    width: width / 2 - 12,
  });
  const lineY = signatureTop + 40;
  doc
    .moveTo(left, lineY)
    .lineTo(left + width / 2 - 12, lineY)
    .lineWidth(0.7)
    .strokeColor(SECONDARY)
    .stroke();
  doc.font("Helvetica").fontSize(7.5).fillColor(MUTED);
  doc.text("Name and signature", left, lineY + 3, { width: width / 2 - 12 });

  doc.page.margins.bottom = 0;
  doc.font("Helvetica").fontSize(7.5).fillColor(MUTED);
  doc.text(
    `${issuerName}  |  Receipt ${receiptNumber}`,
    left,
    doc.page.height - 34,
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
