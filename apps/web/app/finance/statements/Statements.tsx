"use client";

import { useEffect, useState } from "react";
import { listCustomers } from "../../customers/customerApi";
import type { CustomerCompany } from "../../customers/customerApi";
import { ErrorPopup } from "../../ErrorPopup";
import { FinanceTabs } from "../../invoices/FinanceTabs";
import { fetchStatementPdf, getStatement } from "../../jobs/jobApi";
import type { Statement } from "../../jobs/jobApi";
import styles from "../../jobs/jobs.module.css";
import { formatMoney } from "../../quotes/quoteApi";
import { RecordPayment } from "../RecordPayment";
import cards from "../finance.module.css";

/**
 * A customer's statement of account: every issued invoice and payment across
 * their jobs, balance running down the page, one table per currency (never
 * added together). The PDF is what is sent to the customer.
 */
export function Statements() {
  const [customers, setCustomers] = useState<CustomerCompany[]>([]);
  const [companyId, setCompanyId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [statement, setStatement] = useState<Statement | null>(null);
  const [error, setError] = useState("");
  const [reloads, setReloads] = useState(0);

  useEffect(() => {
    listCustomers("")
      .then(setCustomers)
      .catch((cause) =>
        setError(
          cause instanceof Error
            ? cause.message
            : "Customers could not be loaded",
        ),
      );
  }, []);

  useEffect(() => {
    setStatement(null);
    if (!companyId) return;
    let current = true;
    getStatement(companyId, from, to)
      .then((result) => {
        if (current) setStatement(result);
      })
      .catch((cause) => {
        if (current) {
          setError(
            cause instanceof Error
              ? cause.message
              : "The statement could not be loaded",
          );
        }
      });
    return () => {
      current = false;
    };
  }, [companyId, from, to, reloads]);

  async function openPdf() {
    // Opened first so the browser treats it as a click, not a pop-up.
    const tab = window.open("", "_blank");
    setError("");
    try {
      const url = URL.createObjectURL(
        await fetchStatementPdf(companyId, from, to),
      );
      if (tab) tab.location.href = url;
      else window.location.href = url;
    } catch (cause) {
      tab?.close();
      setError(cause instanceof Error ? cause.message : "The PDF failed");
    }
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Statements of account</h1>
        </div>
        <RecordPayment onRecorded={() => setReloads((count) => count + 1)} />
      </header>
      <FinanceTabs active="/finance/statements" />
      <ErrorPopup message={error} />
      <section className={styles.card} aria-label="Choose a statement">
        <div className={cards.statementFilters}>
          <label className={styles.field}>
            Customer
            <select
              onChange={(event) => setCompanyId(event.target.value)}
              value={companyId}
            >
              <option value="">Choose a customer</option>
              {customers.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.companyName}
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
          <button
            className={styles.button}
            disabled={!companyId}
            onClick={() => void openPdf()}
            type="button"
          >
            Download PDF
          </button>
        </div>
      </section>
      {statement && statement.sections.length === 0 && (
        <p className={styles.muted}>
          No invoices or payments for this customer in this period.
        </p>
      )}
      {statement?.sections.map((section) => (
        <section
          aria-labelledby={`statement-${section.currency}`}
          className={styles.card}
          key={section.currency}
        >
          <h2 id={`statement-${section.currency}`}>
            Amounts in {section.currency}
          </h2>
          <div className={cards.board}>
            <div className={cards.tableWrap}>
              <table className={cards.cardTable}>
                <thead>
                  <tr>
                    <th scope="col">Date</th>
                    <th scope="col">Type</th>
                    <th scope="col">Reference</th>
                    <th className={cards.num} scope="col">
                      Debit
                    </th>
                    <th className={cards.num} scope="col">
                      Credit
                    </th>
                    <th className={cards.num} scope="col">
                      Balance
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {statement.from && (
                    <tr>
                      <td className={cards.dateCell}>{statement.from}</td>
                      <td />
                      <td className={cards.refCell}>
                        <strong>Opening balance</strong>
                      </td>
                      <td />
                      <td />
                      <td className={cards.num} data-label="Balance">
                        <strong>
                          {formatMoney(section.openingMinor, section.currency)}
                        </strong>
                      </td>
                    </tr>
                  )}
                  {section.lines.map((line, index) => (
                    <tr key={`${line.date}-${index}`}>
                      <td className={cards.dateCell}>{line.date}</td>
                      <td className={cards.dateCell}>
                        {line.kind === "invoice" ? "Invoice" : "Payment"}
                      </td>
                      <td className={cards.refCell}>{line.reference}</td>
                      <td className={cards.num} data-label="Debit">
                        {line.debitMinor
                          ? formatMoney(line.debitMinor, section.currency)
                          : ""}
                      </td>
                      <td className={cards.num} data-label="Credit">
                        {line.creditMinor
                          ? formatMoney(line.creditMinor, section.currency)
                          : ""}
                      </td>
                      <td className={cards.num} data-label="Balance">
                        {formatMoney(line.balanceMinor, section.currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th className={cards.refCell} colSpan={3} scope="row">
                      Closing balance
                    </th>
                    <td className={cards.num} data-label="Debit">
                      {formatMoney(section.debitMinor, section.currency)}
                    </td>
                    <td className={cards.num} data-label="Credit">
                      {formatMoney(section.creditMinor, section.currency)}
                    </td>
                    <td className={cards.num} data-label="Balance">
                      {formatMoney(section.closingMinor, section.currency)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </section>
      ))}
    </main>
  );
}
