"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { paymentMethodKeys } from "@bjh/contracts";
import type { PaymentMethod } from "@bjh/contracts";
import { plainMessage } from "../ErrorPopup";
import { methodLabels } from "../jobs/JobInvoices";
import { getOutstandingInvoices, recordPayments } from "../jobs/jobApi";
import type { OutstandingInvoice } from "../jobs/jobApi";
import styles from "../jobs/jobs.module.css";
import { formatMoney, toMinor } from "../quotes/quoteApi";
import cards from "./finance.module.css";

const today = () => new Date().toISOString().slice(0, 10);

const amountText = (minor: number) => (minor / 100).toFixed(2);

/**
 * Records a payment a customer made outside the system: choose the customer,
 * tick all or some of their unpaid invoices, and give each ticked invoice the
 * amount it receives (its full balance by default). One payment can settle
 * several invoices; they are saved together or not at all, each with its own
 * receipt. The same rules as the job's invoice list apply.
 */
export function RecordPayment({ onRecorded }: { onRecorded: () => void }) {
  const [open, setOpen] = useState(false);
  const [invoices, setInvoices] = useState<OutstandingInvoice[] | null>(null);
  const [customerId, setCustomerId] = useState("");
  const [currency, setCurrency] = useState("");
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

  const customers = useMemo(
    () =>
      [
        ...new Map(
          (invoices ?? []).map((row) => [
            row.customerCompanyId,
            row.customerCompanyName,
          ]),
        ),
      ].sort((a, b) => a[1].localeCompare(b[1])),
    [invoices],
  );
  const theirs = useMemo(
    () =>
      (invoices ?? []).filter((row) => row.customerCompanyId === customerId),
    [invoices, customerId],
  );
  const currencies = useMemo(
    () => [...new Set(theirs.map((row) => row.currency))].sort(),
    [theirs],
  );
  // One payment is in one currency, so a customer owing in two currencies pays one at a time.
  const shown = theirs.filter((row) => row.currency === currency);
  const ticked = shown.filter((row) => row.invoiceId in amounts);
  const total = ticked.reduce((sum, row) => {
    const minor = toMinor(amounts[row.invoiceId]);
    return sum + (minor !== undefined && !Number.isNaN(minor) ? minor : 0);
  }, 0);

  /** Start from the invoices of one customer and currency: a lone invoice is ticked for them. */
  function chooseCurrency(code: string, mine: OutstandingInvoice[]) {
    setCurrency(code);
    const rows = mine.filter((row) => row.currency === code);
    setAmounts(
      rows.length === 1
        ? { [rows[0].invoiceId]: amountText(rows[0].outstandingMinor) }
        : {},
    );
  }

  function chooseCustomer(id: string, from: OutstandingInvoice[]) {
    setCustomerId(id);
    const mine = from.filter((row) => row.customerCompanyId === id);
    const codes = [...new Set(mine.map((row) => row.currency))];
    if (codes.length === 1) chooseCurrency(codes[0], mine);
    else {
      setCurrency("");
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

  function toggleAll() {
    setAmounts(
      ticked.length === shown.length
        ? {}
        : Object.fromEntries(
            shown.map((row) => [
              row.invoiceId,
              amountText(row.outstandingMinor),
            ]),
          ),
    );
  }

  function start() {
    setNotice("");
    setError("");
    setInvoices(null);
    setCustomerId("");
    setCurrency("");
    setAmounts({});
    setReceivedOn(today());
    setMethod("bank_transfer");
    setReference("");
    setNote("");
    setOpen(true);
    getOutstandingInvoices("")
      .then((result) => {
        setInvoices(result.invoices);
        const owing = new Set(
          result.invoices.map((row) => row.customerCompanyId),
        );
        // One customer owes: no need to pick them.
        if (owing.size === 1) chooseCustomer([...owing][0], result.invoices);
      })
      .catch((cause) =>
        setError(
          plainMessage(
            cause instanceof Error
              ? cause.message
              : "Unpaid invoices could not be loaded",
          ),
        ),
      );
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (ticked.length === 0) {
      setError("Tick at least one invoice");
      return;
    }
    const allocations: Array<{ invoiceId: string; amountMinor: number }> = [];
    for (const row of ticked) {
      const minor = toMinor(amounts[row.invoiceId]);
      if (
        minor === undefined ||
        Number.isNaN(minor) ||
        minor < 1 ||
        minor > row.outstandingMinor
      ) {
        setError(
          `The amount for ${row.invoiceNumber} must be more than zero and at most ${formatMoney(row.outstandingMinor, row.currency)}, written like 250 or 250.50`,
        );
        return;
      }
      allocations.push({ invoiceId: row.invoiceId, amountMinor: minor });
    }
    setSaving(true);
    setError("");
    try {
      const result = await recordPayments({
        receivedOn,
        method,
        reference: reference.trim() || undefined,
        note: note.trim() || undefined,
        allocations,
      });
      setOpen(false);
      const [first] = result.payments;
      setNotice(
        `Recorded ${formatMoney(result.totalMinor, result.currency)} ` +
          (result.payments.length === 1
            ? `against ${ticked[0].invoiceNumber}` +
              (first.receiptNumber ? `, receipt ${first.receiptNumber}.` : ".")
            : `across ${result.payments.length} invoices, one receipt each.`),
      );
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
      <button className={styles.button} onClick={start} type="button">
        Record payment
      </button>
      {notice && (
        <p className={styles.notice} role="status">
          {notice}
        </p>
      )}
      <dialog
        aria-labelledby="record-payment-title"
        className={styles.dialog}
        onCancel={() => setOpen(false)}
        ref={dialog}
        style={{ width: "min(94vw, 560px)" }}
      >
        <form className={styles.form} onSubmit={submit}>
          <h2 id="record-payment-title">Record payment received</h2>
          {!invoices && !error && <p className={styles.muted}>Loading…</p>}
          {invoices && invoices.length === 0 && (
            <p className={styles.muted}>
              Nothing is owing, so there is no payment to record.
            </p>
          )}
          {invoices && invoices.length > 0 && (
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
              {currencies.length > 1 && (
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
                    {currencies.map((code) => (
                      <option key={code} value={code}>
                        {code}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {shown.length > 0 && (
                <fieldset className={cards.allocations}>
                  <legend>Invoices paid</legend>
                  {shown.length > 1 && (
                    <label className={cards.selectAll}>
                      <input
                        checked={ticked.length === shown.length}
                        onChange={toggleAll}
                        type="checkbox"
                      />
                      Select all ({shown.length})
                    </label>
                  )}
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
                              {formatMoney(row.outstandingMinor, row.currency)}
                              {row.overdue ? " · overdue" : ""}
                            </small>
                          </span>
                        </label>
                        <input
                          aria-label={`Amount received for ${row.invoiceNumber}`}
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
                    Total {formatMoney(total, currency)} on {ticked.length}{" "}
                    {ticked.length === 1 ? "invoice" : "invoices"}
                  </p>
                </fieldset>
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
            {invoices && invoices.length > 0 && (
              <button
                className={styles.button}
                disabled={saving || ticked.length === 0}
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
              {invoices && invoices.length > 0 ? "Cancel" : "Close"}
            </button>
          </div>
        </form>
      </dialog>
    </div>
  );
}
