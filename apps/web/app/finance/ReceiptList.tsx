"use client";

import Link from "next/link";
import { Fragment, useEffect, useMemo, useState } from "react";
import { canWorkFinance } from "../auth/roleAccess";
import { useStaffAccess } from "../auth/useStaffAccess";
import {
  fetchCreditReceiptPdf,
  fetchPaymentSummaryPdf,
  fetchReceiptPdf,
  sendPaymentSummary,
  listCredits,
  listReceipts,
  sendReceipt,
} from "../jobs/jobApi";
import type { CustomerCredit, Receipt } from "../jobs/jobApi";
import { methodLabels } from "../jobs/JobInvoices";
import type { PaymentMethod } from "@bjh/contracts";
import { formatMoney } from "../quotes/quoteApi";
import styles from "../jobs/jobs.module.css";
import { ErrorPopup } from "../ErrorPopup";
import cards from "./finance.module.css";

type Payment = { key: string; rows: Receipt[] };

/** What a customer paid, not counting reversals, as "GHS 1,200.00 · USD 300.00". */
function received(payments: Payment[], credits: CustomerCredit[]) {
  const totals = new Map<string, number>();
  const add = (currency: string, minor: number) =>
    totals.set(currency, (totals.get(currency) ?? 0) + minor);
  for (const { rows } of payments) {
    for (const row of rows)
      if (!row.reversed) add(row.currency, row.amountMinor);
  }
  for (const credit of credits) {
    if (!credit.reversal) add(credit.currency, credit.amountMinor);
  }
  const parts = [...totals]
    .filter(([, minor]) => minor > 0)
    .map(([currency, minor]) => formatMoney(minor, currency));
  return parts.length > 0 ? parts.join(" · ") : "Nothing";
}

/**
 * Money received, each with its receipt. Finance sees every customer's
 * payments (including money held as credit) and can email a payment's
 * receipt; a customer sees their own receipts to download. Staff see one
 * row per customer that opens to its payments (Evans, 2026-11-04).
 */
export function ReceiptList({ reloadKey = 0 }: { reloadKey?: number }) {
  const { roles } = useStaffAccess();
  const isStaff = roles.length > 0;
  const canSend = canWorkFinance(roles);
  const [receipts, setReceipts] = useState<Receipt[] | null>(null);
  const [credits, setCredits] = useState<CustomerCredit[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [customer, setCustomer] = useState("");
  const [method, setMethod] = useState<PaymentMethod | "">("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // The customer whose payment summary is waiting for "Yes, send".
  const [sending, setSending] = useState<string | null>(null);

  // One row per payment: the invoices one payment settled share a receipt.
  const payments = useMemo(() => {
    const byKey = new Map<string, Receipt[]>();
    for (const receipt of receipts ?? []) {
      const key = receipt.batchId ?? receipt.paymentId;
      byKey.set(key, [...(byKey.get(key) ?? []), receipt]);
    }
    return [...byKey.entries()].map(([key, rows]) => ({ key, rows }));
  }, [receipts]);

  const customerNames = useMemo(
    () =>
      [
        ...new Set([
          ...(receipts ?? []).map((item) => item.customerCompanyName),
          ...credits.map((item) => item.companyName),
        ]),
      ].sort(),
    [receipts, credits],
  );

  // ISO dates compare correctly as strings.
  const keep = (
    name: string,
    paymentMethod: PaymentMethod,
    receivedOn: string,
    text: string,
  ) =>
    (!customer || name === customer) &&
    (!method || paymentMethod === method) &&
    (!from || receivedOn >= from) &&
    (!to || receivedOn <= to) &&
    (!search.trim() ||
      text.toLowerCase().includes(search.trim().toLowerCase()));
  const shownReceipts = payments.filter(({ rows: [first, ...rest] }) =>
    keep(
      first.customerCompanyName,
      first.method,
      first.receivedOn,
      [first, ...rest]
        .map(
          (r) =>
            `${r.customerCompanyName} ${r.invoiceNumber} ${r.fileNumber} ${r.receiptNumber} ${r.reference ?? ""}`,
        )
        .join(" "),
    ),
  );

  function toggleExpanded(key: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }
  const shownCredits = credits.filter((c) =>
    keep(
      c.companyName,
      c.method,
      c.receivedOn,
      `${c.companyName} ${c.receiptNumber} ${c.reference ?? ""}`,
    ),
  );
  const hasAny = (receipts?.length ?? 0) + credits.length > 0;

  useEffect(() => {
    listReceipts()
      .then(setReceipts)
      .catch((cause: unknown) =>
        setError(
          cause instanceof Error
            ? cause.message
            : "Receipts could not be loaded",
        ),
      );
  }, [reloadKey]);

  useEffect(() => {
    // Credits are finance-only. Money later applied from a credit has no
    // receipt of its own, so listing the credit counts it once.
    if (!canSend) return;
    listCredits()
      .then(setCredits)
      .catch(() => setError("Payments held as credit could not be loaded"));
  }, [canSend, reloadKey]);

  async function openCredit(credit: CustomerCredit) {
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

  async function openSummary(companyId: string) {
    const tab = window.open("", "_blank");
    setError("");
    try {
      const url = URL.createObjectURL(
        await fetchPaymentSummaryPdf({ companyId, from, to, method }),
      );
      if (tab) tab.location.href = url;
      else window.location.href = url;
    } catch (cause) {
      tab?.close();
      setError(cause instanceof Error ? cause.message : "The PDF failed");
    }
  }

  async function sendSummary(companyId: string, name: string) {
    setSending(null);
    setError("");
    setNotice("");
    try {
      await sendPaymentSummary({ companyId, from, to, method });
      setNotice(`The payment summary is on its way to ${name}.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Sending failed");
    }
  }

  async function open(receipt: Receipt) {
    // Opened first so the browser treats it as a click, not a pop-up.
    const tab = window.open("", "_blank");
    setError("");
    try {
      const url = URL.createObjectURL(
        await fetchReceiptPdf(
          receipt.jobId,
          receipt.invoiceId,
          receipt.paymentId,
        ),
      );
      if (tab) tab.location.href = url;
      else window.location.href = url;
    } catch (cause) {
      tab?.close();
      setError(cause instanceof Error ? cause.message : "The PDF failed");
    }
  }

  async function email(receipt: Receipt) {
    setError("");
    setNotice("");
    try {
      await sendReceipt(receipt.jobId, receipt.invoiceId, receipt.paymentId);
      setNotice(
        `Receipt ${receipt.receiptNumber} is on its way to the client.`,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Sending failed");
    }
  }

  // Staff see one row per customer; their payments show when it is opened.
  const groups = [
    ...new Set([
      ...shownReceipts.map((item) => item.rows[0].customerCompanyName),
      ...shownCredits.map((item) => item.companyName),
    ]),
  ]
    .sort()
    .map((name) => ({
      name,
      payments: shownReceipts.filter(
        (item) => item.rows[0].customerCompanyName === name,
      ),
      credits: shownCredits.filter((item) => item.companyName === name),
    }));
  // Searching, or one customer, shows the payments straight away.
  const openAll = groups.length === 1 || search.trim() !== "";

  function paymentRow({ key, rows }: Payment, nested = false) {
    const [receipt] = rows;
    const standing = rows.filter((row) => !row.reversed);
    const total = rows.reduce((sum, row) => sum + row.amountMinor, 0);
    const isOpen = expanded.has(key);
    return (
      <tr className={nested ? cards.invoiceRow : undefined} key={key}>
        <td data-label="Date">{receipt.receivedOn}</td>
        {isStaff && (
          <td data-label="Customer" data-wide>
            {nested ? "" : receipt.customerCompanyName}
          </td>
        )}
        <th scope="row">
          {formatMoney(total, receipt.currency)}
          {standing.length === 0 && (
            <span className={styles.badge}> Reversed</span>
          )}
          {standing.length > 0 && standing.length < rows.length && (
            <span className={styles.badge}> Part reversed</span>
          )}
          <br />
          <span className={styles.muted}>{methodLabels[receipt.method]}</span>
        </th>
        {rows.length === 1 ? (
          <td data-label="For" data-wide>
            {receipt.invoiceNumber}
            <br />
            <Link
              className={styles.link}
              href={`/finance/jobs/${receipt.jobId}`}
            >
              {receipt.fileNumber}
            </Link>
          </td>
        ) : (
          <td data-label="For" data-wide>
            <button
              aria-expanded={isOpen}
              className={styles.textButton}
              onClick={() => toggleExpanded(key)}
              type="button"
            >
              {rows.length} invoices {isOpen ? "▴" : "▾"}
            </button>
            {isOpen && (
              <ul className={cards.paymentInvoices}>
                {rows.map((row) => (
                  <li key={row.paymentId}>
                    {row.invoiceNumber} ·{" "}
                    {formatMoney(row.amountMinor, row.currency)}
                    {row.reversed && " (reversed)"}
                    <br />
                    <Link
                      className={styles.link}
                      href={`/finance/jobs/${row.jobId}`}
                    >
                      {row.fileNumber}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </td>
        )}
        <td data-label="Receipt" data-wide>
          <span className={styles.muted}>{receipt.receiptNumber}</span>
          <div className={styles.actions}>
            <button
              className={styles.textButton}
              onClick={() => void open(receipt)}
              type="button"
            >
              Download
            </button>
            {canSend && standing.length > 0 && (
              <button
                className={styles.textButton}
                onClick={() => void email(standing[0])}
                type="button"
              >
                Email
              </button>
            )}
          </div>
        </td>
      </tr>
    );
  }

  function creditRow(credit: CustomerCredit, nested = false) {
    return (
      <tr className={nested ? cards.invoiceRow : undefined} key={credit.id}>
        <td data-label="Date">{credit.receivedOn}</td>
        <td data-label="Customer" data-wide>
          {nested ? "" : credit.companyName}
        </td>
        <th scope="row">
          {formatMoney(credit.amountMinor, credit.currency)}
          {credit.reversal && <span className={styles.badge}> Reversed</span>}
          <br />
          <span className={styles.muted}>{methodLabels[credit.method]}</span>
        </th>
        <td data-label="For" data-wide>
          Credit on account
          {credit.availableMinor > 0 &&
            credit.availableMinor < credit.amountMinor &&
            ` (${formatMoney(credit.availableMinor, credit.currency)} left)`}
        </td>
        <td data-label="Receipt" data-wide>
          <span className={styles.muted}>{credit.receiptNumber}</span>
          <div className={styles.actions}>
            <button
              className={styles.textButton}
              onClick={() => void openCredit(credit)}
              type="button"
            >
              Download
            </button>
          </div>
        </td>
      </tr>
    );
  }

  return (
    <section className={styles.card} aria-labelledby="receipts-title">
      <h2 id="receipts-title">
        {isStaff ? "Payments received" : "Your receipts"}
      </h2>
      <ErrorPopup message={error} />
      {notice && <p className={styles.notice}>{notice}</p>}
      {receipts === null && !error && <p role="status">Loading receipts…</p>}
      {receipts?.length === 0 && credits.length === 0 && (
        <p className={styles.muted}>
          {isStaff ? "No payments yet." : "No receipts yet."}
        </p>
      )}
      {receipts && hasAny && (
        <div className={cards.filters}>
          <label className={styles.field}>
            Search
            <input
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Receipt, invoice, file number or reference"
              type="search"
              value={search}
            />
          </label>
          {isStaff && (
            <label className={styles.field}>
              Customer
              <select
                onChange={(event) => setCustomer(event.target.value)}
                value={customer}
              >
                <option value="">All customers</option>
                {customerNames.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className={styles.field}>
            Method
            <select
              onChange={(event) =>
                setMethod(event.target.value as PaymentMethod | "")
              }
              value={method}
            >
              <option value="">All methods</option>
              {Object.entries(methodLabels).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            From
            <input
              onChange={(event) => setFrom(event.target.value)}
              type="date"
              value={from}
            />
          </label>
          <label className={styles.field}>
            To
            <input
              onChange={(event) => setTo(event.target.value)}
              type="date"
              value={to}
            />
          </label>
        </div>
      )}
      {receipts &&
        hasAny &&
        shownReceipts.length + shownCredits.length === 0 && (
          <p className={styles.muted}>No payments match these filters.</p>
        )}
      {shownReceipts.length + shownCredits.length > 0 && (
        <div className={`${styles.tableScroll} ${cards.scrollBox}`}>
          <table className={styles.table} data-cards>
            <thead>
              <tr>
                <th scope="col">Date</th>
                {isStaff && <th scope="col">Customer</th>}
                <th scope="col">Amount</th>
                <th scope="col">For</th>
                <th scope="col">Receipt</th>
              </tr>
            </thead>
            <tbody>
              {!isStaff && shownReceipts.map((payment) => paymentRow(payment))}
              {!isStaff && shownCredits.map((credit) => creditRow(credit))}
              {isStaff &&
                groups.map(({ name, payments: theirs, credits: held }) => {
                  const open = openAll || expanded.has(`client:${name}`);
                  const count = theirs.length + held.length;
                  const companyId =
                    theirs[0]?.rows[0].customerCompanyId ?? held[0].companyId;
                  const latest = [
                    ...theirs.map((item) => item.rows[0].receivedOn),
                    ...held.map((item) => item.receivedOn),
                  ].sort()[count - 1];
                  return (
                    <Fragment key={`client:${name}`}>
                      <tr className={cards.clientRow} data-group>
                        <td>{latest}</td>
                        <td>
                          <button
                            aria-expanded={open}
                            className={cards.clientToggle}
                            onClick={() => toggleExpanded(`client:${name}`)}
                            type="button"
                          >
                            <span aria-hidden="true">{open ? "▾" : "▸"}</span>{" "}
                            {name}
                          </button>
                        </td>
                        <th scope="row">
                          {received(theirs, held)}
                          <br />
                          <span className={styles.muted}>
                            {count} {count === 1 ? "payment" : "payments"}
                          </span>
                        </th>
                        <td />
                        <td>
                          <button
                            className={styles.textButton}
                            onClick={() => void openSummary(companyId)}
                            type="button"
                          >
                            Download
                          </button>{" "}
                          {canSend &&
                            (sending === companyId ? (
                              <>
                                Email the summary to the client?{" "}
                                <button
                                  className={styles.textButton}
                                  onClick={() =>
                                    void sendSummary(companyId, name)
                                  }
                                  type="button"
                                >
                                  Yes, send
                                </button>{" "}
                                <button
                                  className={styles.textButton}
                                  onClick={() => setSending(null)}
                                  type="button"
                                >
                                  Cancel
                                </button>
                              </>
                            ) : (
                              <button
                                className={styles.textButton}
                                onClick={() => setSending(companyId)}
                                type="button"
                              >
                                Send
                              </button>
                            ))}
                        </td>
                      </tr>
                      {open &&
                        theirs.map((payment) => paymentRow(payment, true))}
                      {open && held.map((credit) => creditRow(credit, true))}
                    </Fragment>
                  );
                })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
