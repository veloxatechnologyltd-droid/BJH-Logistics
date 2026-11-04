import PDFDocument from "pdfkit";
import type { BusinessSettings } from "@bjh/contracts";
import type {
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

interface ReceiptLayout {
  receiptNumber: string;
  amount: string;
  cells: Array<[string, string]>;
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
