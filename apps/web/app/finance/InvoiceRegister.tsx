"use client";

import Link from "next/link";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { listCustomers } from "../customers/customerApi";
import type { CustomerCompany } from "../customers/customerApi";
import { FinanceTabs } from "../invoices/FinanceTabs";
import {
  fetchInvoicePdf,
  fetchInvoiceSummaryPdf,
  sendInvoiceSummary,
  issueInvoices,
  listAllInvoices,
} from "../jobs/jobApi";
import type { InvoiceRegisterRow } from "../jobs/jobApi";
import styles from "../jobs/jobs.module.css";
import { formatMoney } from "../quotes/quoteApi";
import { ErrorPopup } from "../ErrorPopup";
import { CustomerCredits } from "./CustomerCredits";
import cards from "./finance.module.css";

type Filter = "all" | "owing" | InvoiceRegisterRow["paymentStatus"];

const filters: Array<[Filter, string]> = [
  ["all", "All invoices"],
  ["owing", "Still owing"],
  ["draft", "Drafts"],
  ["unpaid", "Unpaid"],
  ["partial", "Part paid"],
  ["paid", "Paid"],
  ["void", "Void"],
];

const statusLabels: Record<InvoiceRegisterRow["paymentStatus"], string> = {
  draft: "Draft",
  unpaid: "Unpaid",
  partial: "Part paid",
  paid: "Paid",
  void: "Void",
};

const matches = (row: InvoiceRegisterRow, filter: Filter) =>
  filter === "all" ||
  (filter === "owing"
    ? row.outstandingMinor > 0
    : row.paymentStatus === filter);

/** Sums by currency, as "GHS 1,200.00 · USD 300.00". */
function perCurrency(
  rows: InvoiceRegisterRow[],
  amount: (row: InvoiceRegisterRow) => number,
) {
  const totals = new Map<string, number>();
  for (const row of rows) {
    totals.set(row.currency, (totals.get(row.currency) ?? 0) + amount(row));
  }
  const parts = [...totals]
    .filter(([, minor]) => minor > 0)
    .map(([currency, minor]) => formatMoney(minor, currency));
  return parts.length > 0 ? parts.join(" · ") : "Nothing";
}

/**
 * Finance's invoices (Evans, 2026-11-04): every invoice, drafts to paid,
 * where Finance starts a new invoice and records payments, for one invoice
 * or simply for a client.
 */
export function InvoiceRegister() {
  const [rows, setRows] = useState<InvoiceRegisterRow[] | null>(null);
  const [customers, setCustomers] = useState<CustomerCompany[]>([]);
  const [companyId, setCompanyId] = useState("");
  const [filter, setFilter] = useState<Filter>("owing");
  const [search, setSearch] = useState("");
  const [opened, setOpened] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  // The client whose drafts are waiting for "Yes, issue".
  const [issuing, setIssuing] = useState<string | null>(null);
  // The client whose summary is waiting for "Yes, send".
  const [sending, setSending] = useState<string | null>(null);
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      setRows(await listAllInvoices(companyId));
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Invoices could not be loaded",
      );
    }
  }, [companyId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    listCustomers("")
      .then(setCustomers)
      .catch(() => undefined);
  }, []);

  async function openPdf(file: () => Promise<Blob>) {
    // Opened first so the browser treats it as a click, not a pop-up.
    const tab = window.open("", "_blank");
    setError("");
    try {
      const url = URL.createObjectURL(await file());
      if (tab) tab.location.href = url;
      else window.location.href = url;
    } catch (cause) {
      tab?.close();
      setError(cause instanceof Error ? cause.message : "The PDF failed");
    }
  }

  async function send(companyId: string, name: string) {
    setSending(null);
    setError("");
    setNotice("");
    try {
      await sendInvoiceSummary(companyId);
      setNotice(`The invoices still owing are on their way to ${name}.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Sending failed");
    }
  }

  async function issueAll(companyId: string, invoiceIds: string[]) {
    setIssuing(null);
    setError("");
    try {
      await issueInvoices(companyId, invoiceIds);
      await load();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "The invoices were not issued",
      );
    }
  }

  const all = useMemo(() => rows ?? [], [rows]);
  const shown = useMemo(() => {
    const text = search.trim().toLowerCase();
    return all.filter(
      (row) =>
        matches(row, filter) &&
        (!text ||
          [row.invoiceNumber ?? "", row.fileNumber, row.customerCompanyName]
            .join(" ")
            .toLowerCase()
            .includes(text)),
    );
  }, [all, filter, search]);
  // One row per client; their invoices show when the row is opened.
  const groups = useMemo(() => {
    const byClient = new Map<string, InvoiceRegisterRow[]>();
    for (const row of shown) {
      byClient.set(row.customerCompanyId, [
        ...(byClient.get(row.customerCompanyId) ?? []),
        row,
      ]);
    }
    return [...byClient.values()];
  }, [shown]);
  // Searching, or one client, shows the invoices straight away.
  const openAll = groups.length === 1 || search.trim() !== "";
  const toggleClient = (id: string) =>
    setOpened((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const owing = all.filter((row) => row.outstandingMinor > 0);
  const overdue = owing.filter((row) => row.overdue);
  const drafts = all.filter((row) => row.status === "draft");

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Invoices</h1>
          <p className={styles.muted}>
            Every invoice, by client. Open a client to see their invoices, or
            pay all they owe at once. Payments are recorded on the Payments
            page.
          </p>
        </div>
        <div className={styles.toolbar}>
          <Link className={styles.primaryLink} href="/finance/invoices/new">
            New invoice
          </Link>
        </div>
      </header>
      <FinanceTabs active="/invoices" />
      <ErrorPopup message={error} />
      {notice && <p className={styles.notice}>{notice}</p>}

      <div className={cards.board}>
        <div className={`${cards.kpis} ${cards.twoKpis}`}>
          <div className={cards.kpi}>
            <span>Overdue</span>
            <strong
              className={overdue.length > 0 ? cards.owingText : undefined}
            >
              {rows ? perCurrency(overdue, (row) => row.outstandingMinor) : "…"}
            </strong>
            <small>
              {overdue.length} {overdue.length === 1 ? "invoice" : "invoices"}
            </small>
          </div>
          <div className={cards.kpi}>
            <span>Drafts not issued</span>
            <strong>{rows ? drafts.length : "…"}</strong>
            <small>The client sees an invoice once it is issued</small>
          </div>
        </div>
      </div>

      <CustomerCredits companyId={companyId} onChanged={() => void load()} />

      <section className={styles.card} aria-labelledby="register-title">
        <h2 id="register-title">All invoices</h2>
        <div className={cards.filters}>
          <label className={styles.field}>
            Search
            <input
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Invoice, file number or client"
              type="search"
              value={search}
            />
          </label>
          <label className={styles.field}>
            Show
            <select
              onChange={(event) => setFilter(event.target.value as Filter)}
              value={filter}
            >
              {filters.map(([key, label]) => (
                <option key={key} value={key}>
                  {label} ({all.filter((row) => matches(row, key)).length})
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            Client
            <select
              onChange={(event) => setCompanyId(event.target.value)}
              value={companyId}
            >
              <option value="">All clients</option>
              {customers.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.companyName}
                </option>
              ))}
            </select>
          </label>
        </div>
        {!rows && !error && <p role="status">Loading invoices…</p>}
        {rows && shown.length === 0 && (
          <p className={styles.muted}>
            No invoices here.{" "}
            <Link className={styles.link} href="/finance/invoices/new">
              Create one
            </Link>
          </p>
        )}
        {shown.length > 0 && (
          <div className={cards.board}>
            <div className={`${cards.tableWrap} ${cards.scrollBox}`}>
              <table className={cards.cardTable}>
                <thead>
                  <tr>
                    <th scope="col">Client and invoices</th>
                    <th scope="col">Status</th>
                    <th scope="col">Due</th>
                    <th className={cards.num} scope="col">
                      Total
                    </th>
                    <th className={cards.num} scope="col">
                      Owing
                    </th>
                    <th scope="col">
                      <span className={cards.srOnly}>Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map((rows) => {
                    const first = rows[0];
                    const id = first.customerCompanyId;
                    const open = openAll || opened.has(id);
                    const owed = rows.filter((row) => row.outstandingMinor > 0);
                    const drafts = rows.filter((row) => row.status === "draft");
                    return (
                      <Fragment key={id}>
                        <tr className={cards.clientRow}>
                          <td className={cards.jobCell}>
                            <button
                              aria-expanded={open}
                              className={cards.clientToggle}
                              onClick={() => toggleClient(id)}
                              type="button"
                            >
                              <span aria-hidden="true">{open ? "▾" : "▸"}</span>{" "}
                              {first.customerCompanyName}
                            </button>
                            <span className={cards.customerName}>
                              {rows.length}{" "}
                              {rows.length === 1 ? "invoice" : "invoices"}
                            </span>
                          </td>
                          <td data-label="Status">
                            {owed.length > 0 && (
                              <span className={styles.badge}>
                                {owed.length} owing
                              </span>
                            )}
                            {rows.some((row) => row.overdue) && (
                              <span className={styles.error}> overdue</span>
                            )}
                          </td>
                          <td data-label="Due">-</td>
                          <td className={cards.num} data-label="Total">
                            {perCurrency(rows, (row) => row.totalMinor)}
                          </td>
                          <td
                            className={`${cards.num}${owed.length > 0 ? ` ${cards.owingText}` : ""}`}
                            data-label="Owing"
                          >
                            {owed.length > 0
                              ? perCurrency(owed, (row) => row.outstandingMinor)
                              : "-"}
                          </td>
                          <td className={cards.rowActions}>
                            <button
                              className={styles.textButton}
                              onClick={() =>
                                void openPdf(() =>
                                  fetchInvoiceSummaryPdf(
                                    id,
                                    rows.map((row) => row.invoiceId),
                                  ),
                                )
                              }
                              type="button"
                            >
                              Download
                            </button>{" "}
                            {owed.length > 0 &&
                              (sending === id ? (
                                <>
                                  Email {owed.length} owing{" "}
                                  {owed.length === 1 ? "invoice" : "invoices"}{" "}
                                  to the client?{" "}
                                  <button
                                    className={styles.textButton}
                                    onClick={() =>
                                      void send(id, first.customerCompanyName)
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
                                  </button>{" "}
                                </>
                              ) : (
                                <>
                                  <button
                                    className={styles.textButton}
                                    onClick={() => setSending(id)}
                                    type="button"
                                  >
                                    Send
                                  </button>{" "}
                                </>
                              ))}
                            {drafts.length > 1 &&
                              (issuing === id ? (
                                <>
                                  Checked the {drafts.length} drafts? Issue them
                                  and tell the client?{" "}
                                  <button
                                    className={styles.textButton}
                                    onClick={() =>
                                      void issueAll(
                                        id,
                                        drafts.map((row) => row.invoiceId),
                                      )
                                    }
                                    type="button"
                                  >
                                    Yes, issue
                                  </button>{" "}
                                  <button
                                    className={styles.textButton}
                                    onClick={() => setIssuing(null)}
                                    type="button"
                                  >
                                    Cancel
                                  </button>{" "}
                                </>
                              ) : (
                                <>
                                  <button
                                    className={styles.textButton}
                                    onClick={() => {
                                      // The drafts in one PDF, the client opened
                                      // to list them, then "Yes, issue" if right.
                                      setIssuing(id);
                                      setOpened((current) =>
                                        new Set(current).add(id),
                                      );
                                      void openPdf(() =>
                                        fetchInvoiceSummaryPdf(
                                          id,
                                          drafts.map((row) => row.invoiceId),
                                        ),
                                      );
                                    }}
                                    type="button"
                                  >
                                    Review all
                                  </button>{" "}
                                </>
                              ))}
                            {owed.length > 0 && (
                              <Link
                                className={styles.textButton}
                                href={`/finance/receipts?pay=${id}&all=1`}
                              >
                                Payment
                              </Link>
                            )}
                          </td>
                        </tr>
                        {open &&
                          rows.map((row) => (
                            <tr
                              className={cards.invoiceRow}
                              key={row.invoiceId}
                            >
                              <td className={cards.jobCell}>
                                <Link
                                  className={styles.link}
                                  href={`/finance/jobs/${row.jobId}/invoices/${row.invoiceId}`}
                                >
                                  {row.invoiceNumber ?? "Draft invoice"}
                                </Link>
                                <span className={cards.customerName}>
                                  job {row.fileNumber}
                                </span>
                              </td>
                              <td data-label="Status">
                                <span className={styles.badge}>
                                  {statusLabels[row.paymentStatus]}
                                </span>
                              </td>
                              <td data-label="Due">
                                {row.dueDate ?? "-"}
                                {row.overdue && (
                                  <span className={styles.error}> overdue</span>
                                )}
                              </td>
                              <td className={cards.num} data-label="Total">
                                {formatMoney(row.totalMinor, row.currency)}
                              </td>
                              <td
                                className={`${cards.num}${row.outstandingMinor > 0 ? ` ${cards.owingText}` : ""}`}
                                data-label="Owing"
                              >
                                {row.status === "issued"
                                  ? formatMoney(
                                      row.outstandingMinor,
                                      row.currency,
                                    )
                                  : "-"}
                              </td>
                              <td className={cards.rowActions}>
                                {row.outstandingMinor > 0 ? (
                                  <Link
                                    className={styles.textButton}
                                    href={`/finance/receipts?invoice=${row.invoiceId}`}
                                  >
                                    Record payment
                                  </Link>
                                ) : (
                                  <Link
                                    className={styles.textButton}
                                    href={`/finance/jobs/${row.jobId}/invoices/${row.invoiceId}`}
                                  >
                                    {row.status === "draft"
                                      ? "Review & issue"
                                      : "Open"}
                                  </Link>
                                )}
                                {row.status === "draft" && (
                                  <>
                                    {" "}
                                    <button
                                      className={styles.textButton}
                                      onClick={() =>
                                        void openPdf(() =>
                                          fetchInvoicePdf(
                                            row.jobId,
                                            row.invoiceId,
                                          ),
                                        )
                                      }
                                      type="button"
                                    >
                                      Preview PDF
                                    </button>
                                  </>
                                )}
                              </td>
                            </tr>
                          ))}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
