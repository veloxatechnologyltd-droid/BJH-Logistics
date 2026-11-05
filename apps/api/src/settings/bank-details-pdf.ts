import type { BankAccount } from "@bjh/contracts";

// Same palette as the other printed documents.
const PRIMARY = "#0b3fae";
const INK = "#17324d";
const MUTED = "#526b7d";
const BORDER = "#d7e3ed";

const PADDING = 10;
const TITLE_HEIGHT = 22;
const LABEL_WIDTH = 110;
const FONT_SIZE = 10;
const ROW_GAP = 4;

type Row = [label: string, value: string];

/** Two columns of label and value; empty details are left out. */
function columns(account: BankAccount): [Row[], Row[]] {
  const keep = (rows: Array<[string, string | null]>): Row[] =>
    rows.filter((row): row is Row => Boolean(row[1]));
  return [
    keep([
      ["Bank", account.bankName],
      ["Branch", account.branch],
      ["SWIFT code", account.swiftCode],
    ]),
    keep([
      ["Account name", account.accountName],
      [`Account number (${account.currency})`, account.accountNumber],
      ["Address", account.address],
    ]),
  ];
}

function rowHeight(doc: PDFKit.PDFDocument, value: string, valueWidth: number) {
  doc.font("Helvetica-Bold").fontSize(FONT_SIZE);
  return doc.heightOfString(value, { width: valueWidth }) + ROW_GAP;
}

function columnWidth(width: number) {
  return (width - PADDING * 3) / 2;
}

/** How tall `drawBankDetails` will be for this account at this width. */
export function bankDetailsHeight(
  doc: PDFKit.PDFDocument,
  account: BankAccount,
  width: number,
): number {
  const valueWidth = columnWidth(width) - LABEL_WIDTH;
  const tallest = Math.max(
    ...columns(account).map((rows) =>
      rows.reduce(
        (sum, [, value]) => sum + rowHeight(doc, value, valueWidth),
        0,
      ),
    ),
  );
  return TITLE_HEIGHT + tallest + PADDING;
}

/**
 * A framed "Bank payment details" box at (x, y); returns its height. Printed on
 * quotes and invoices so the client knows where to pay.
 */
export function drawBankDetails(
  doc: PDFKit.PDFDocument,
  account: BankAccount,
  x: number,
  y: number,
  width: number,
): number {
  const height = bankDetailsHeight(doc, account, width);
  doc.lineWidth(0.8).strokeColor(BORDER).rect(x, y, width, height).stroke();
  doc.font("Helvetica-Bold").fontSize(9).fillColor(PRIMARY);
  doc.text("BANK PAYMENT DETAILS", x + PADDING, y + 8, {
    width: width - PADDING * 2,
    characterSpacing: 0.5,
    lineBreak: false,
  });
  const valueWidth = columnWidth(width) - LABEL_WIDTH;
  columns(account).forEach((rows, index) => {
    const left = x + PADDING + index * (columnWidth(width) + PADDING);
    let rowY = y + TITLE_HEIGHT;
    for (const [label, value] of rows) {
      doc.font("Helvetica").fontSize(9).fillColor(MUTED);
      doc.text(label, left, rowY + 1, {
        width: LABEL_WIDTH - 6,
        lineBreak: false,
      });
      doc.font("Helvetica-Bold").fontSize(FONT_SIZE).fillColor(INK);
      doc.text(value, left + LABEL_WIDTH, rowY, { width: valueWidth });
      rowY += rowHeight(doc, value, valueWidth);
    }
  });
  return height;
}
