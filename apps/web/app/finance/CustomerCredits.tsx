"use client";

import { useCallback, useEffect, useState } from "react";
import { plainMessage } from "../ErrorPopup";
import { methodLabels } from "../jobs/JobInvoices";
import {
  applyCredit,
  fetchCreditReceiptPdf,
  getOutstandingInvoices,
  listCredits,
  reverseCredit,
} from "../jobs/jobApi";
import type { CustomerCredit, OutstandingInvoice } from "../jobs/jobApi";
import styles from "../jobs/jobs.module.css";
import { formatMoney, toMinor } from "../quotes/quoteApi";
import cards from "./finance.module.css";

const amountText = (minor: number) => (minor / 100).toFixed(2);

/** What is left across credits, per currency: "GHS 40.00 · USD 250.00". */
function perCurrency(credits: CustomerCredit[]) {
  const totals = new Map<string, number>();
  for (const credit of credits) {
    totals.set(
      credit.currency,
      (totals.get(credit.currency) ?? 0) + credit.availableMinor,
    );
  }
  return [...totals]
    .map(([currency, minor]) => formatMoney(minor, currency))
    .join(" · ");
}

/**
 * Money customers paid that is not yet set against an invoice. Finance sets
 * it against the customer's unpaid invoices in the same currency (oldest
 * first by default), or reverses a credit recorded by mistake.
 */
export function CustomerCredits({
  companyId = "",
  reloadKey = 0,
  onChanged,
}: {
  companyId?: string;
  reloadKey?: number;
  onChanged?: () => void;
}) {
  const [credits, setCredits] = useState<CustomerCredit[] | null>(null);
  const [applying, setApplying] = useState<CustomerCredit | null>(null);
  const [owing, setOwing] = useState<OutstandingInvoice[]>([]);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [reversing, setReversing] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setCredits(await listCredits(companyId));
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Credits could not be loaded",
      );
    }
  }, [companyId]);

  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  const open = (credits ?? []).filter((credit) => credit.availableMinor > 0);
  if (credits === null || open.length === 0) {
    return error ? <p className={styles.error}>{error}</p> : null;
  }

  async function startApply(credit: CustomerCredit) {
    setError("");
    setApplying(credit);
    try {
      const { invoices } = await getOutstandingInvoices(credit.companyId);
      const rows = invoices
        .filter((row) => row.currency === credit.currency)
        .sort(
          (a, b) =>
            (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") ||
            a.invoiceNumber.localeCompare(b.invoiceNumber),
        );
      setOwing(rows);
      let left = credit.availableMinor;
      const next: Record<string, string> = {};
      for (const row of rows) {
        if (left <= 0) break;
        const part = Math.min(left, row.outstandingMinor);
        next[row.invoiceId] = amountText(part);
        left -= part;
      }
      setAmounts(next);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Invoices could not be loaded",
      );
    }
  }

  async function act(action: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await action();
      setApplying(null);
      setReversing(null);
      setReason("");
      await load();
      onChanged?.();
    } catch (cause) {
      setError(
        plainMessage(
          cause instanceof Error ? cause.message : "The action failed",
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  function apply(credit: CustomerCredit) {
    const allocations = owing
      .filter((row) => row.invoiceId in amounts)
      .map((row) => ({
        invoiceId: row.invoiceId,
        amountMinor: toMinor(amounts[row.invoiceId] ?? "") ?? Number.NaN,
      }));
    if (
      allocations.length === 0 ||
      allocations.some(
        (item) => Number.isNaN(item.amountMinor) || item.amountMinor < 1,
      )
    ) {
      setError("Tick at least one invoice and give each an amount");
      return;
    }
    void act(() => applyCredit(credit.id, allocations));
  }

  // Opened in a new tab first so the browser does not block it as a pop-up.
  async function openReceipt(credit: CustomerCredit) {
    const tab = window.open("", "_blank");
    setError("");
    try {
      const url = URL.createObjectURL(await fetchCreditReceiptPdf(credit.id));
      if (tab) tab.location.href = url;
      else window.location.href = url;
    } catch (cause) {
      tab?.close();
      setError(cause instanceof Error ? cause.message : "The PDF failed");
    }
  }

  return (
    <details className={`${styles.card} ${cards.credits}`}>
      <summary className={cards.creditsSummary}>
        <h2>Credit on customers&apos; accounts</h2>
        <span className={cards.creditsTotal}>
          {open.length} {open.length === 1 ? "credit" : "credits"} ·{" "}
          {perCurrency(open)} left
        </span>
        <span className={cards.creditsToggle} />
      </summary>
      <p className={styles.muted}>
        Money received that is not yet set against an invoice.
      </p>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      <ul className={`${styles.itemList} ${cards.creditList}`}>
        {open.map((credit) => (
          <li key={credit.id}>
            <div>
              <strong>
                {credit.companyName}:{" "}
                {formatMoney(credit.availableMinor, credit.currency)} left
              </strong>
              <small>
                {formatMoney(credit.amountMinor, credit.currency)} received{" "}
                {credit.receivedOn} · {methodLabels[credit.method]} · receipt{" "}
                {credit.receiptNumber}
                {credit.reference ? ` · ${credit.reference}` : ""}
              </small>
              {applying?.id === credit.id && (
                <div className={cards.allocations}>
                  {owing.length === 0 ? (
                    <p className={styles.muted}>
                      Nothing is owing in {credit.currency} for this customer.
                    </p>
                  ) : (
                    <ul className={cards.allocationList}>
                      {owing.map((row) => (
                        <li key={row.invoiceId}>
                          <label className={cards.allocationRow}>
                            <input
                              checked={row.invoiceId in amounts}
                              onChange={() =>
                                setAmounts((current) => {
                                  const next = { ...current };
                                  if (row.invoiceId in next)
                                    delete next[row.invoiceId];
                                  else
                                    next[row.invoiceId] = amountText(
                                      Math.min(
                                        row.outstandingMinor,
                                        credit.availableMinor,
                                      ),
                                    );
                                  return next;
                                })
                              }
                              type="checkbox"
                            />
                            <span>
                              {row.invoiceNumber}
                              <small>
                                {row.fileNumber ?? "No job"} · owing{" "}
                                {formatMoney(
                                  row.outstandingMinor,
                                  row.currency,
                                )}
                              </small>
                            </span>
                          </label>
                          <input
                            aria-label={`Credit for ${row.invoiceNumber}`}
                            className={cards.allocationAmount}
                            disabled={!(row.invoiceId in amounts)}
                            inputMode="decimal"
                            onChange={(event) =>
                              setAmounts((current) => ({
                                ...current,
                                [row.invoiceId]: event.target.value,
                              }))
                            }
                            value={amounts[row.invoiceId] ?? ""}
                          />
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className={styles.actions}>
                    {owing.length > 0 && (
                      <button
                        className={styles.button}
                        disabled={busy}
                        onClick={() => apply(credit)}
                        type="button"
                      >
                        Apply credit
                      </button>
                    )}
                    <button
                      className={styles.secondaryButton}
                      onClick={() => setApplying(null)}
                      type="button"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
              {reversing === credit.id && (
                <div className={styles.actions}>
                  <input
                    aria-label="Why the credit is reversed"
                    maxLength={500}
                    onChange={(event) => setReason(event.target.value)}
                    placeholder="Reason, for example recorded twice"
                    value={reason}
                  />
                  <button
                    className={styles.button}
                    disabled={busy || !reason.trim()}
                    onClick={() =>
                      void act(() => reverseCredit(credit.id, reason.trim()))
                    }
                    type="button"
                  >
                    Reverse
                  </button>
                  <button
                    className={styles.secondaryButton}
                    onClick={() => setReversing(null)}
                    type="button"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
            {applying?.id !== credit.id && reversing !== credit.id && (
              <div className={styles.actions}>
                <button
                  className={styles.textButton}
                  onClick={() => void startApply(credit)}
                  type="button"
                >
                  Apply to invoices
                </button>
                <button
                  className={styles.textButton}
                  onClick={() => void openReceipt(credit)}
                  type="button"
                >
                  Receipt
                </button>
                {credit.appliedMinor === 0 && (
                  <button
                    className={styles.textButton}
                    onClick={() => {
                      setReversing(credit.id);
                      setReason("");
                    }}
                    type="button"
                  >
                    Reverse
                  </button>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}
