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

// --- Invoice layout: one column per bank, mobile money listed beneath. ---

const isMobileMoney = (group: BankAccount[]) =>
  /mobile\s*money|momo/i.test(group[0].bankName);

const CELL_PAD = 10;
const LINE = 13;

type Line = [label: string, value: string | null];

/** What one bank's column says: its name, then label and value lines. */
function bankColumn(group: BankAccount[]): { title: string; lines: Line[] } {
  const [first] = group;
  return {
    title: first.bankName.toUpperCase(),
    lines: [
      ["Account name:", first.accountName],
      ...group.map((account): Line => [
        `${account.currency} account:`,
        account.accountNumber,
      ]),
      ["SWIFT:", first.swiftCode],
      ["Branch:", first.branch],
    ].filter((line): line is Line => Boolean(line[1])),
  };
}

function mobileLines(group: BankAccount[]): Line[] {
  return group.flatMap((account): Line[] => [
    ["Number / code:", account.accountNumber],
    ["Account name:", account.accountName],
  ]);
}

/** A label in regular type followed by its value in bold, on one line. */
function labelled(
  doc: PDFKit.PDFDocument,
  [label, value]: Line,
  x: number,
  y: number,
  width: number,
  boldValue: boolean,
) {
  doc.font("Helvetica").fontSize(FONT_SIZE).fillColor(INK);
  doc.text(`${label} `, x, y, { width, continued: true, lineBreak: false });
  doc.font(boldValue ? "Helvetica-Bold" : "Helvetica").text(value ?? "", {
    continued: false,
    lineBreak: false,
  });
}

/** Only account numbers are bold, as on the BJH invoice sample. */
const boldLine = ([label]: Line) =>
  /account:$|code:$/.test(label) && label !== "Account name:";

function layout(accounts: readonly BankAccount[]) {
  const groups = byBank(accounts);
  return {
    banks: groups.filter((group) => !isMobileMoney(group)).map(bankColumn),
    mobile: groups.filter(isMobileMoney),
  };
}

/** How tall `drawPaymentDetails` will be for these accounts. */
export function paymentDetailsHeight(accounts: readonly BankAccount[]): number {
  const { banks, mobile } = layout(accounts);
  let height = 0;
  for (let index = 0; index < banks.length; index += 2) {
    const row = banks.slice(index, index + 2);
    height +=
      26 + CELL_PAD * 2 + Math.max(...row.map((b) => b.lines.length)) * LINE;
  }
  if (mobile.length > 0) height += 8;
  for (const group of mobile) height += 16 + mobileLines(group).length * LINE;
  return height;
}

/**
 * The "Payment details" of an invoice at (x, y): a table with one column per
 * bank (two to a row) and each mobile-money number beneath it; returns its
 * height.
 */
export function drawPaymentDetails(
  doc: PDFKit.PDFDocument,
  accounts: readonly BankAccount[],
  x: number,
  y: number,
  width: number,
): number {
  const { banks, mobile } = layout(accounts);
  const columnWidth = width / 2;
  let top = y;
  for (let index = 0; index < banks.length; index += 2) {
    const row = banks.slice(index, index + 2);
    const body = Math.max(...row.map((bank) => bank.lines.length)) * LINE;
    const height = 26 + CELL_PAD * 2 + body;
    row.forEach((bank, column) => {
      const left = x + column * columnWidth;
      doc
        .lineWidth(0.8)
        .rect(left, top, columnWidth, 26)
        .fillAndStroke("#f1f5fa", BORDER);
      doc.font("Helvetica-Bold").fontSize(FONT_SIZE).fillColor(INK);
      doc.text(bank.title, left + CELL_PAD, top + 8, {
        width: columnWidth - CELL_PAD * 2,
        lineBreak: false,
      });
      doc
        .lineWidth(0.8)
        .strokeColor(BORDER)
        .rect(left, top + 26, columnWidth, height - 26)
        .stroke();
      bank.lines.forEach((line, lineIndex) =>
        labelled(
          doc,
          line,
          left + CELL_PAD,
          top + 26 + CELL_PAD + lineIndex * LINE,
          columnWidth - CELL_PAD * 2,
          boldLine(line),
        ),
      );
    });
    top += height;
  }
  if (mobile.length > 0) top += 8;
  for (const group of mobile) {
    doc.font("Helvetica-Bold").fontSize(FONT_SIZE).fillColor(INK);
    doc.text(group[0].bankName, x, top + 4, { width, lineBreak: false });
    const lines = mobileLines(group);
    lines.forEach((line, lineIndex) =>
      labelled(
        doc,
        line,
        x,
        top + 16 + lineIndex * LINE,
        width,
        boldLine(line),
      ),
    );
    top += 16 + lines.length * LINE;
  }
  return top - y;
}
