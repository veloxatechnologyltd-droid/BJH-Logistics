"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { paymentMethodKeys } from "@bjh/contracts";
import type { PaymentMethod } from "@bjh/contracts";
import { plainMessage } from "../ErrorPopup";
import { listCustomers } from "../customers/customerApi";
import { methodLabels } from "../jobs/JobInvoices";
import { getOutstandingInvoices, recordPayments } from "../jobs/jobApi";
import type { OutstandingInvoice } from "../jobs/jobApi";
import styles from "../jobs/jobs.module.css";
import { formatMoney, toMinor } from "../quotes/quoteApi";
import { popularCurrencies } from "../settings/business/BusinessSettingsForm";
import { getSettings } from "../settings/business/settingsApi";
import cards from "./finance.module.css";

const today = () => new Date().toISOString().slice(0, 10);

const amountText = (minor: number) => (minor / 100).toFixed(2);

const readMinor = (text: string | undefined) => {
  const minor = toMinor(text ?? "");
  return minor !== undefined && !Number.isNaN(minor) ? minor : null;
};

/** Oldest first: earliest due date, then invoice number. */
const oldestFirst = (a: OutstandingInvoice, b: OutstandingInvoice) =>
  (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") ||
  a.invoiceNumber.localeCompare(b.invoiceNumber);

/**
 * Records a payment a customer made outside the system, of any amount: choose
 * the customer and currency and type what they paid. It is set against their
 * unpaid invoices, oldest first (change the ticks and amounts as needed), and
 * whatever is left over, or all of it when nothing is owing, is kept as
 * credit on their account with its own receipt. Saved all or nothing.
 * Opened from one invoice, it starts with that customer, currency and
 * invoice filled in; opened for one customer, with that customer.
 */
export function RecordPayment({
  onRecorded,
  invoiceId,
  companyId,
  label = "Record payment",
  compact = false,
  startOpen = false,
  payAll = false,
}: {
  onRecorded: () => void;
  /** Start with this unpaid invoice ticked for what it still owes. */
  invoiceId?: string;
  /** Start with this customer chosen. */
  companyId?: string;
  label?: string;
  /** A small text button, for use on a list row. */
  compact?: boolean;
  /** Open the form straight away (a job's "Record payment" link). */
  startOpen?: boolean;
  /** With companyId: tick everything they owe and fill in the total (one currency only). */
  payAll?: boolean;
}) {
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const [invoices, setInvoices] = useState<OutstandingInvoice[] | null>(null);
  const [customers, setCustomers] = useState<Array<[string, string]>>([]);
  const [configured, setConfigured] = useState<string[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [currency, setCurrency] = useState("");
  const [received, setReceived] = useState("");
  // A ticked invoice has an entry here: the amount it receives, as typed.
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [receivedOn, setReceivedOn] = useState(today());
  const [method, setMethod] = useState<PaymentMethod>("bank_transfer");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (open) dialog.current?.showModal();
    else dialog.current?.close();
  }, [open]);

  const theirs = useMemo(
    () =>
      (invoices ?? [])
        .filter((row) => row.customerCompanyId === customerId)
        .sort(oldestFirst),
    [invoices, customerId],
  );
  const owedCurrencies = useMemo(
    () => [...new Set(theirs.map((row) => row.currency))].sort(),
    [theirs],
  );
  const currencyChoices = [
    ...new Set([
      ...owedCurrencies,
      ...(configured.length > 0 ? configured : popularCurrencies),
    ]),
  ];
  // One payment is in one currency, so a customer owing in two currencies pays one at a time.
  const shown = theirs.filter((row) => row.currency === currency);
  const ticked = shown.filter((row) => row.invoiceId in amounts);
  const allocated = ticked.reduce(
    (sum, row) => sum + (readMinor(amounts[row.invoiceId]) ?? 0),
    0,
  );
  const receivedMinor = readMinor(received);
  const leftover = receivedMinor === null ? null : receivedMinor - allocated;

  /** Sets the amount against the shown invoices, oldest first, up to what each owes. */
  function spread(text: string, rows: OutstandingInvoice[]) {
    let left = readMinor(text) ?? 0;
    const next: Record<string, string> = {};
    for (const row of rows) {
      if (left <= 0) break;
      const part = Math.min(left, row.outstandingMinor);
      next[row.invoiceId] = amountText(part);
      left -= part;
    }
    setAmounts(next);
  }

  function chooseCurrency(code: string, mine: OutstandingInvoice[]) {
    setCurrency(code);
    spread(
      received,
      mine.filter((row) => row.currency === code),
    );
  }

  function chooseCustomer(id: string, from: OutstandingInvoice[]) {
    setCustomerId(id);
    const mine = from
      .filter((row) => row.customerCompanyId === id)
      .sort(oldestFirst);
    const codes = [...new Set(mine.map((row) => row.currency))];
    if (codes.length === 1) chooseCurrency(codes[0], mine);
    else {
      setCurrency(codes.length === 0 ? (configured[0] ?? "GHS") : "");
      setAmounts({});
    }
  }

  function toggle(row: OutstandingInvoice) {
    setAmounts((current) => {
      const next = { ...current };
      if (row.invoiceId in next) delete next[row.invoiceId];
      else next[row.invoiceId] = amountText(row.outstandingMinor);
      return next;
    });
  }

  const allTicked = shown.length > 0 && ticked.length === shown.length;

  /** Ticks every shown invoice at what it owes, or clears them all. */
  function toggleAll() {
    setAmounts(
      allTicked
        ? {}
        : Object.fromEntries(
            shown.map((row) => [
              row.invoiceId,
              amountText(row.outstandingMinor),
            ]),
          ),
    );
  }

  const opened = useRef(false);
  useEffect(() => {
    if (!startOpen || opened.current) return;
    opened.current = true;
    start();
  });

  function start() {
    setNotice("");
    setError("");
    setInvoices(null);
    setCustomerId("");
    setCurrency("");
    setReceived("");
    setAmounts({});
    setReceivedOn(today());
    setMethod("bank_transfer");
    setReference("");
    setNote("");
    setOpen(true);
    getSettings()
      .then((result) => {
        if (result.current) setConfigured(result.current.settings.currencies);
      })
      .catch(() => undefined);
    Promise.all([getOutstandingInvoices(""), listCustomers("")])
      .then(([result, all]) => {
        setInvoices(result.invoices);
        // Every customer can pay: those who owe are listed first.
        const owing = new Set(
          result.invoices.map((row) => row.customerCompanyId),
        );
        setCustomers(
          all
            .map((item): [string, string] => [item.id, item.companyName])
            .sort(
              (a, b) =>
                Number(owing.has(b[0])) - Number(owing.has(a[0])) ||
                a[1].localeCompare(b[1]),
            ),
        );
        const row = invoiceId
          ? result.invoices.find((item) => item.invoiceId === invoiceId)
          : undefined;
        if (row) {
          setCustomerId(row.customerCompanyId);
          setCurrency(row.currency);
          setReceived(amountText(row.outstandingMinor));
          setAmounts({ [row.invoiceId]: amountText(row.outstandingMinor) });
        } else if (companyId) {
          chooseCustomer(companyId, result.invoices);
          const mine = result.invoices.filter(
            (item) => item.customerCompanyId === companyId,
          );
          if (payAll && new Set(mine.map((item) => item.currency)).size === 1) {
            setReceived(
              amountText(
                mine.reduce((sum, item) => sum + item.outstandingMinor, 0),
              ),
            );
            setAmounts(
              Object.fromEntries(
                mine.map((item) => [
                  item.invoiceId,
                  amountText(item.outstandingMinor),
                ]),
              ),
            );
          }
        }
      })
      .catch((cause) =>
        setError(
          plainMessage(
            cause instanceof Error
              ? cause.message
              : "Customers and unpaid invoices could not be loaded",
          ),
        ),
      );
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (receivedMinor === null || receivedMinor < 1) {
      setError("Enter the amount received, written like 250 or 250.50");
      return;
    }
    const allocations: Array<{ invoiceId: string; amountMinor: number }> = [];
    for (const row of ticked) {
      const minor = readMinor(amounts[row.invoiceId]);
      if (minor === null || minor < 1 || minor > row.outstandingMinor) {
        setError(
          `The amount for ${row.invoiceNumber} must be more than zero and at most ${formatMoney(row.outstandingMinor, row.currency)}`,
        );
        return;
      }
      allocations.push({ invoiceId: row.invoiceId, amountMinor: minor });
    }
    if (allocated > receivedMinor) {
      setError(
        `The invoices add up to ${formatMoney(allocated, currency)}, more than the ${formatMoney(receivedMinor, currency)} received`,
      );
      return;
    }
    setSaving(true);
    setError("");
    try {
      const result = await recordPayments({
        companyId: customerId,
        currency,
        totalMinor: receivedMinor,
        receivedOn,
        method,
        reference: reference.trim() || undefined,
        note: note.trim() || undefined,
        allocations,
      });
      setOpen(false);
      const parts = [
        `Recorded ${formatMoney(result.totalMinor, result.currency)}`,
      ];
      if (result.payments.length > 0) {
        parts.push(
          `${result.payments.length === 1 ? "1 invoice" : `${result.payments.length} invoices`} paid, one receipt each`,
        );
      }
      if (result.credit) {
        parts.push(
          `${formatMoney(result.credit.amountMinor, result.credit.currency)} kept as credit, receipt ${result.credit.receiptNumber}`,
        );
      }
      setNotice(`${parts.join(". ")}.`);
      onRecorded();
    } catch (cause) {
      setError(
        plainMessage(
          cause instanceof Error
            ? cause.message
            : "The payment could not be saved",
        ),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <button
        className={compact ? styles.textButton : styles.button}
        onClick={start}
        type="button"
      >
        {label}
      </button>
      {notice && (
        <p className={styles.notice} role="status">
          {notice}
        </p>
      )}
      <dialog
        aria-labelledby={titleId}
        className={styles.dialog}
        onCancel={() => setOpen(false)}
        ref={dialog}
        style={{ width: "min(94vw, 560px)" }}
      >
        {open && (
          <form className={styles.form} onSubmit={submit}>
            <h2 id={titleId}>Record payment received</h2>
            {!invoices && !error && <p className={styles.muted}>Loading…</p>}
            {invoices && (
              <>
                <label className={styles.field}>
                  Customer
                  <select
                    onChange={(event) =>
                      chooseCustomer(event.target.value, invoices)
                    }
                    required
                    value={customerId}
                  >
                    <option value="">Choose a customer</option>
                    {customers.map(([id, name]) => (
                      <option key={id} value={id}>
                        {name}
                      </option>
                    ))}
                  </select>
                </label>
                {customerId && (
                  <label className={styles.field}>
                    Currency
                    <select
                      onChange={(event) =>
                        chooseCurrency(event.target.value, theirs)
                      }
                      required
                      value={currency}
                    >
                      <option value="">Choose a currency</option>
                      {currencyChoices.map((code) => (
                        <option key={code} value={code}>
                          {code}
                          {owedCurrencies.includes(code) ? " (owing)" : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {customerId && currency && (
                  <label className={styles.field}>
                    Amount received ({currency})
                    <input
                      inputMode="decimal"
                      onChange={(event) => {
                        setReceived(event.target.value);
                        spread(event.target.value, shown);
                      }}
                      placeholder="Any amount, for example 1500 or 1500.50"
                      required
                      value={received}
                    />
                  </label>
                )}
                {customerId && currency && shown.length === 0 && (
                  <p className={styles.muted}>
                    Nothing is owing in {currency}: the whole amount is kept as
                    credit on the customer&apos;s account.
                  </p>
                )}
                {shown.length > 0 && (
                  <fieldset className={cards.allocations}>
                    <legend>Set against invoices (oldest first)</legend>
                    <label className={cards.selectAll}>
                      <input
                        checked={allTicked}
                        onChange={toggleAll}
                        ref={(box) => {
                          if (box)
                            box.indeterminate = ticked.length > 0 && !allTicked;
                        }}
                        type="checkbox"
                      />
                      All invoices ({shown.length})
                    </label>
                    <ul className={cards.allocationList}>
                      {shown.map((row) => (
                        <li key={row.invoiceId}>
                          <label className={cards.allocationRow}>
                            <input
                              checked={row.invoiceId in amounts}
                              onChange={() => toggle(row)}
                              type="checkbox"
                            />
                            <span>
                              {row.invoiceNumber}
                              <small>
                                {row.fileNumber} · owing{" "}
                                {formatMoney(
                                  row.outstandingMinor,
                                  row.currency,
                                )}
                                {row.overdue ? " · overdue" : ""}
                              </small>
                            </span>
                          </label>
                          <input
                            aria-label={`Amount for ${row.invoiceNumber}`}
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
                    <p className={cards.allocationTotal}>
                      {formatMoney(allocated, currency)} on {ticked.length}{" "}
                      {ticked.length === 1 ? "invoice" : "invoices"}
                    </p>
                  </fieldset>
                )}
                {leftover !== null && leftover > 0 && (
                  <p className={styles.notice}>
                    {formatMoney(leftover, currency)} will be kept as credit on
                    the customer&apos;s account, with its own receipt.
                  </p>
                )}
                {leftover !== null && leftover < 0 && (
                  <p className={styles.error}>
                    The invoices add up to more than the amount received.
                  </p>
                )}
                <label className={styles.field}>
                  Date received
                  <input
                    max={today()}
                    onChange={(event) => setReceivedOn(event.target.value)}
                    required
                    type="date"
                    value={receivedOn}
                  />
                </label>
                <label className={styles.field}>
                  Method
                  <select
                    onChange={(event) =>
                      setMethod(event.target.value as PaymentMethod)
                    }
                    value={method}
                  >
                    {paymentMethodKeys.map((key) => (
                      <option key={key} value={key}>
                        {methodLabels[key]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={styles.field}>
                  Reference (optional)
                  <input
                    maxLength={200}
                    onChange={(event) => setReference(event.target.value)}
                    value={reference}
                  />
                </label>
                <label className={styles.field}>
                  Note (optional)
                  <input
                    maxLength={2000}
                    onChange={(event) => setNote(event.target.value)}
                    value={note}
                  />
                </label>
              </>
            )}
            {error && (
              <p className={styles.error} role="alert">
                {error}
              </p>
            )}
            <div className={styles.actions}>
              {invoices && (
                <button
                  className={styles.button}
                  disabled={
                    saving ||
                    !customerId ||
                    !currency ||
                    receivedMinor === null ||
                    (leftover !== null && leftover < 0)
                  }
                  type="submit"
                >
                  Save payment
                </button>
              )}
              <button
                className={styles.secondaryButton}
                onClick={() => setOpen(false)}
                type="button"
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </dialog>
    </div>
  );
}
