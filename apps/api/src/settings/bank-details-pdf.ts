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
const GROUP_GAP = 8;

type Row = [label: string, value: string];

/**
 * Accounts at the same bank with the same account name share one block, so a
 * bank's GHS and USD numbers sit together (as on a carrier's invoice).
 */
function byBank(accounts: readonly BankAccount[]): BankAccount[][] {
  const groups = new Map<string, BankAccount[]>();
  for (const account of accounts) {
    const key = [
      account.bankName,
      account.branch,
      account.accountName,
      account.swiftCode,
    ].join("|");
    groups.set(key, [...(groups.get(key) ?? []), account]);
  }
  return [...groups.values()];
}

/** Two columns of label and value for one bank; empty details are left out. */
function columns(group: BankAccount[]): [Row[], Row[]] {
  const keep = (rows: Array<[string, string | null]>): Row[] =>
    rows.filter((row): row is Row => Boolean(row[1]));
  const [first] = group;
  return [
    keep([
      ["Bank", first.bankName],
      ["Branch", first.branch],
      ["SWIFT code", first.swiftCode],
    ]),
    keep([
      ["Account name", first.accountName],
      ...group.map((account): [string, string] => [
        `Account number (${account.currency})`,
        account.accountNumber,
      ]),
      ["Address", first.address],
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

function groupHeight(
  doc: PDFKit.PDFDocument,
  group: BankAccount[],
  valueWidth: number,
) {
  return Math.max(
    ...columns(group).map((rows) =>
      rows.reduce(
        (sum, [, value]) => sum + rowHeight(doc, value, valueWidth),
        0,
      ),
    ),
  );
}

/** How tall `drawBankDetails` will be for these accounts at this width. */
export function bankDetailsHeight(
  doc: PDFKit.PDFDocument,
  accounts: readonly BankAccount[],
  width: number,
): number {
  const valueWidth = columnWidth(width) - LABEL_WIDTH;
  const groups = byBank(accounts);
  return (
    TITLE_HEIGHT +
    groups.reduce(
      (sum, group) => sum + groupHeight(doc, group, valueWidth) + GROUP_GAP,
      0,
    ) +
    PADDING -
    GROUP_GAP
  );
}

/**
 * A framed "Bank payment details" box at (x, y) holding every account given,
 * one block per bank; returns its height. Printed on quotes and invoices so the
 * client knows where to pay.
 */
export function drawBankDetails(
  doc: PDFKit.PDFDocument,
  accounts: readonly BankAccount[],
  x: number,
  y: number,
  width: number,
): number {
  const height = bankDetailsHeight(doc, accounts, width);
  doc.lineWidth(0.8).strokeColor(BORDER).rect(x, y, width, height).stroke();
  doc.font("Helvetica-Bold").fontSize(9).fillColor(PRIMARY);
  doc.text("BANK PAYMENT DETAILS", x + PADDING, y + 8, {
    width: width - PADDING * 2,
    characterSpacing: 0.5,
    lineBreak: false,
  });
  const valueWidth = columnWidth(width) - LABEL_WIDTH;
  let groupY = y + TITLE_HEIGHT;
  byBank(accounts).forEach((group, groupIndex) => {
    if (groupIndex > 0) {
      const ruleY = groupY - GROUP_GAP / 2;
      doc
        .moveTo(x + PADDING, ruleY)
        .lineTo(x + width - PADDING, ruleY)
        .lineWidth(0.5)
        .strokeColor(BORDER)
        .stroke();
    }
    columns(group).forEach((rows, index) => {
      const left = x + PADDING + index * (columnWidth(width) + PADDING);
      let rowY = groupY;
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
    groupY += groupHeight(doc, group, valueWidth) + GROUP_GAP;
  });
  return height;
}
