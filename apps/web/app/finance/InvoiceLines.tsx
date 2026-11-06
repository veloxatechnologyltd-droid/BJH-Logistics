"use client";

import { ChargeOptions } from "../ChargeOptions";
import type { InvoiceLine } from "../jobs/jobApi";
import styles from "../jobs/jobs.module.css";
import { formatMoney, toMinor } from "../quotes/quoteApi";

/** A line as typed: an amount, or a quantity and a unit price. */
export type DraftLine = {
  description: string;
  quantity: string;
  unit: string;
  amount: string;
  taxable: boolean;
};

export const blankLine = (): DraftLine => ({
  description: "",
  quantity: "",
  unit: "",
  amount: "",
  taxable: true,
});

/** "1,250.5" as a number; NaN when it is not one. */
const readQuantity = (text: string) => {
  const cleaned = text.replace(/[,\s]/g, "");
  return /^\d+(\.\d{1,3})?$/.test(cleaned) ? Number(cleaned) : Number.NaN;
};

/** The line's amount in minor units as typed, or null while it cannot be worked out. */
const lineMinor = (line: DraftLine): number | null => {
  if (line.quantity.trim() || line.unit.trim()) {
    const quantity = readQuantity(line.quantity);
    const unit = toMinor(line.unit);
    if (Number.isNaN(quantity) || unit === undefined || Number.isNaN(unit)) {
      return null;
    }
    return Math.round(quantity * unit);
  }
  const minor = toMinor(line.amount);
  return minor === undefined || Number.isNaN(minor) ? null : minor;
};

export const toDraftLines = (lines: InvoiceLine[]): DraftLine[] =>
  lines.map((line) => ({
    description: line.description,
    quantity:
      line.quantity != null && line.unitAmountMinor != null
        ? String(line.quantity)
        : "",
    unit:
      line.quantity != null && line.unitAmountMinor != null
        ? (line.unitAmountMinor / 100).toFixed(2)
        : "",
    amount: (line.amountMinor / 100).toFixed(2),
    taxable: line.taxable,
  }));

/** The typed lines as the API takes them, or the message saying which one is wrong. */
export function parseDraftLines(
  from: DraftLine[],
): { lines: InvoiceLine[] } | { error: string } {
  const parsed: InvoiceLine[] = [];
  for (const line of from) {
    const priced = Boolean(line.quantity.trim() || line.unit.trim());
    const minor = lineMinor(line);
    if (minor === null) {
      return {
        error: priced
          ? `"${line.description || "A line"}" needs a quantity such as 2 or 1.5 and a unit price such as 250.50`
          : "Amounts must be numbers such as 250 or 250.50",
      };
    }
    parsed.push(
      priced
        ? {
            description: line.description.trim(),
            quantity: readQuantity(line.quantity),
            unitAmountMinor: toMinor(line.unit)!,
            amountMinor: minor,
            taxable: line.taxable,
          }
        : {
            description: line.description.trim(),
            amountMinor: minor,
            taxable: line.taxable,
          },
    );
  }
  return { lines: parsed };
}

/**
 * The invoice's charge lines: description, quantity and unit price (or an
 * amount), taxed or not. Used when starting an invoice and on the draft.
 */
export function InvoiceLinesEditor({
  lines,
  onChange,
  currency,
}: {
  lines: DraftLine[];
  onChange: (next: DraftLine[]) => void;
  currency: string;
}) {
  const change = (index: number, patch: Partial<DraftLine>) =>
    onChange(
      lines.map((item, at) => (at === index ? { ...item, ...patch } : item)),
    );
  return (
    <>
      {lines.map((line, index) => (
        <div className={styles.lineRow} key={index}>
          <label className={styles.field}>
            Description
            <input
              list="invoice-charge-options"
              placeholder="Pick or type any charge"
              maxLength={300}
              onChange={(event) =>
                change(index, { description: event.target.value })
              }
              required
              value={line.description}
            />
          </label>
          <label className={styles.field}>
            Qty
            <input
              inputMode="decimal"
              onChange={(event) =>
                change(index, { quantity: event.target.value })
              }
              size={6}
              value={line.quantity}
            />
          </label>
          <label className={styles.field}>
            Unit price
            <input
              inputMode="decimal"
              onChange={(event) => change(index, { unit: event.target.value })}
              size={10}
              value={line.unit}
            />
          </label>
          <label className={styles.field}>
            Amount{currency ? ` (${currency})` : ""}
            {line.quantity.trim() || line.unit.trim() ? (
              <output>
                {lineMinor(line) === null
                  ? "—"
                  : currency
                    ? formatMoney(lineMinor(line)!, currency)
                    : (lineMinor(line)! / 100).toFixed(2)}
              </output>
            ) : (
              <input
                inputMode="decimal"
                onChange={(event) =>
                  change(index, { amount: event.target.value })
                }
                required
                value={line.amount}
              />
            )}
          </label>
          <label>
            <input
              checked={line.taxable}
              onChange={(event) =>
                change(index, { taxable: event.target.checked })
              }
              type="checkbox"
            />{" "}
            Taxed
          </label>
          <button
            className={styles.secondaryButton}
            onClick={() => onChange(lines.filter((_, at) => at !== index))}
            type="button"
          >
            Remove
          </button>
        </div>
      ))}
      <ChargeOptions id="invoice-charge-options" />
      <div className={`${styles.actions} ${styles.spaced}`}>
        <button
          className={styles.secondaryButton}
          onClick={() => onChange([...lines, blankLine()])}
          type="button"
        >
          Add line
        </button>
      </div>
    </>
  );
}
