"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { paymentMethodKeys } from "@bjh/contracts";
import type { PaymentMethod } from "@bjh/contracts";
import { plainMessage } from "../ErrorPopup";
import { methodLabels } from "../jobs/JobInvoices";
import { getOutstandingInvoices, recordInvoicePayment } from "../jobs/jobApi";
import type { OutstandingInvoice } from "../jobs/jobApi";
import styles from "../jobs/jobs.module.css";
import { formatMoney, toMinor } from "../quotes/quoteApi";

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Records a payment a customer made outside the system against one of their
 * unpaid invoices, without opening the job. The same API call and rules as the
 * job's invoice list apply.
 */
export function RecordPayment({ onRecorded }: { onRecorded: () => void }) {
  const [open, setOpen] = useState(false);
  const [invoices, setInvoices] = useState<OutstandingInvoice[] | null>(null);
  const [customerId, setCustomerId] = useState("");
  const [invoiceId, setInvoiceId] = useState("");
  const [amount, setAmount] = useState("");
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
  const theirs = (invoices ?? []).filter(
    (row) => row.customerCompanyId === customerId,
  );
  const invoice = theirs.find((row) => row.invoiceId === invoiceId);

  function chooseInvoice(row?: OutstandingInvoice) {
    setInvoiceId(row?.invoiceId ?? "");
    setAmount(row ? (row.outstandingMinor / 100).toFixed(2) : "");
  }

  function chooseCustomer(id: string, from: OutstandingInvoice[]) {
    setCustomerId(id);
    const mine = from.filter((row) => row.customerCompanyId === id);
    chooseInvoice(mine.length === 1 ? mine[0] : undefined);
  }

  function start() {
    setNotice("");
    setError("");
    setInvoices(null);
    setCustomerId("");
    chooseInvoice();
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
        if (owing.size === 1)
          chooseCustomer([...owing][0], result.invoices);
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
    if (!invoice) return;
    const minor = toMinor(amount);
    if (minor === undefined || Number.isNaN(minor)) {
      setError("Enter the amount as a number such as 250 or 250.50");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const payment = await recordInvoicePayment(
        invoice.jobId,
        invoice.invoiceId,
        {
          amountMinor: minor,
          receivedOn,
          method,
          reference: reference.trim() || undefined,
          note: note.trim() || undefined,
        },
      );
      setOpen(false);
      setNotice(
        `Recorded ${formatMoney(minor, invoice.currency)} against ${invoice.invoiceNumber}` +
          (payment.receiptNumber ? `, receipt ${payment.receiptNumber}.` : "."),
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
              <label className={styles.field}>
                Invoice
                <select
                  disabled={!customerId}
                  onChange={(event) =>
                    chooseInvoice(
                      theirs.find((row) => row.invoiceId === event.target.value),
                    )
                  }
                  required
                  value={invoiceId}
                >
                  <option value="">Choose an invoice</option>
                  {theirs.map((row) => (
                    <option key={row.invoiceId} value={row.invoiceId}>
                      {row.invoiceNumber} · {row.fileNumber} · owing{" "}
                      {formatMoney(row.outstandingMinor, row.currency)}
                    </option>
                  ))}
                </select>
              </label>
              <label className={styles.field}>
                Amount received{invoice ? ` (${invoice.currency})` : ""}
                <input
                  inputMode="decimal"
                  onChange={(event) => setAmount(event.target.value)}
                  required
                  value={amount}
                />
              </label>
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
                disabled={saving || !invoice}
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
