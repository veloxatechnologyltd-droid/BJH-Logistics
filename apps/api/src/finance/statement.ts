import type { StatementEntryRecord } from "../database/database.port";
import { methodLabels } from "./receipt-pdf";

export interface StatementLine {
  /** YYYY-MM-DD */
  date: string;
  kind: "invoice" | "payment";
  reference: string;
  debitMinor: number;
  creditMinor: number;
  /** What the customer owes after this line. */
  balanceMinor: number;
}

/** One currency of a statement: currencies are never added together. */
export interface StatementSection {
  currency: string;
  /** Owed before the first line (zero when the statement starts at the beginning). */
  openingMinor: number;
  lines: StatementLine[];
  debitMinor: number;
  creditMinor: number;
  closingMinor: number;
}

/** The shipment references printed beside an invoice, labelled the way staff write them. */
const referenceLabels: Record<string, string> = {
  container: "CONT#",
  master_bl: "B/L#",
  house_bl: "B/L#",
  master_awb: "AWB#",
  house_awb: "AWB#",
};

function describeInvoice(entry: StatementEntryRecord): string {
  const groups = new Map<string, string[]>();
  for (const reference of entry.jobReferences) {
    const label = referenceLabels[reference.kind];
    if (!label) continue;
    const values = groups.get(label) ?? [];
    if (!values.includes(reference.value)) values.push(reference.value);
    groups.set(label, values);
  }
  return [
    entry.invoiceNumber,
    entry.fileNumber,
    ...[...groups].map(([label, values]) => `${label}: ${values.join(", ")}`),
  ].join(" - ");
}

function describePayment(entry: StatementEntryRecord): string {
  const method = entry.method ? methodLabels[entry.method] : "Payment";
  return [
    entry.receiptNumber ? `Receipt ${entry.receiptNumber}` : "Payment",
    entry.reference ? `${method} (${entry.reference})` : method,
    `for ${entry.invoiceNumber}`,
  ].join(" - ");
}

/**
 * A customer's account as a ledger, one section per currency: invoices add to
 * what is owed, payments take from it, and the balance runs down the page.
 * `from` starts the lines there and folds everything earlier into the opening
 * balance; `to` ignores later entries. Within a day invoices come before
 * payments, so a same-day payment never shows a negative balance.
 */
export function buildStatement(
  entries: StatementEntryRecord[],
  range: { from: string | null; to: string | null },
): StatementSection[] {
  const byCurrency = new Map<string, StatementEntryRecord[]>();
  for (const entry of entries) {
    if (range.to && entry.date > range.to) continue;
    const list = byCurrency.get(entry.currency) ?? [];
    list.push(entry);
    byCurrency.set(entry.currency, list);
  }

  const sections: StatementSection[] = [];
  for (const currency of [...byCurrency.keys()].sort()) {
    const ordered = byCurrency
      .get(currency)!
      .sort(
        (a, b) =>
          a.date.localeCompare(b.date) ||
          Number(a.kind === "payment") - Number(b.kind === "payment") ||
          a.recordedAt.localeCompare(b.recordedAt),
      );
    const signed = (entry: StatementEntryRecord) =>
      entry.kind === "invoice" ? entry.amountMinor : -entry.amountMinor;

    const before = range.from
      ? ordered.filter((entry) => entry.date < range.from!)
      : [];
    const openingMinor = before.reduce((sum, entry) => sum + signed(entry), 0);

    let balanceMinor = openingMinor;
    let debitMinor = 0;
    let creditMinor = 0;
    const lines: StatementLine[] = ordered
      .filter((entry) => !range.from || entry.date >= range.from)
      .map((entry) => {
        balanceMinor += signed(entry);
        const isInvoice = entry.kind === "invoice";
        if (isInvoice) debitMinor += entry.amountMinor;
        else creditMinor += entry.amountMinor;
        return {
          date: entry.date,
          kind: entry.kind,
          reference: isInvoice
            ? describeInvoice(entry)
            : describePayment(entry),
          debitMinor: isInvoice ? entry.amountMinor : 0,
          creditMinor: isInvoice ? 0 : entry.amountMinor,
          balanceMinor,
        };
      });

    if (lines.length === 0 && openingMinor === 0) continue;
    sections.push({
      currency,
      openingMinor,
      lines,
      debitMinor,
      creditMinor,
      closingMinor: balanceMinor,
    });
  }
  return sections;
}
