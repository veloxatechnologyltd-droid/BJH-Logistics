"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AuthStatus } from "../auth/AuthStatus";
import { useStaffAccess } from "../auth/useStaffAccess";
import { listCustomers } from "../customers/customerApi";
import type { CustomerCompany } from "../customers/customerApi";
import { getOutstandingInvoices } from "../jobs/jobApi";
import type { OutstandingInvoice } from "../jobs/jobApi";
import { formatMoney } from "../quotes/quoteApi";
import { FinanceTabs } from "./FinanceTabs";
import styles from "../jobs/jobs.module.css";
import { ErrorPopup } from "../ErrorPopup";

type Totals = Array<{
  currency: string;
  outstandingMinor: number;
  overdueMinor: number;
}>;

/** Unpaid invoices across jobs: staff see every customer, a customer sees their own. */
export function Receivables() {
  const { roles } = useStaffAccess();
  const isStaff = roles.length > 0;
  const [rows, setRows] = useState<OutstandingInvoice[] | null>(null);
  const [totals, setTotals] = useState<Totals>([]);
  const [customers, setCustomers] = useState<CustomerCompany[]>([]);
  const [companyId, setCompanyId] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const result = await getOutstandingInvoices(companyId);
      setRows(result.invoices);
      setTotals(result.totals);
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
    if (!isStaff) return;
    listCustomers("")
      .then(setCustomers)
      .catch(() => undefined);
  }, [isStaff]);

  return (
    <>
      <header className="topbar">
        <div className="breadcrumb">
          <Link href="/">Workspace</Link>
          <span aria-hidden="true">/</span>
          <strong>{isStaff ? "Receivables" : "Your invoices"}</strong>
        </div>
        <AuthStatus />
      </header>
      <main className={styles.page}>
        <header className={styles.header}>
          <div>
            <h1 className={styles.title}>
              {isStaff ? "Unpaid invoices" : "Invoices you still owe"}
            </h1>
          </div>
        </header>
        {isStaff && <FinanceTabs active="/invoices" />}
        <ErrorPopup message={error} />
        <section className={styles.card} aria-labelledby="owing-title">
          <h2 id="owing-title">Balances</h2>
          {isStaff && (
            <label className={styles.field}>
              Customer
              <select
                onChange={(event) => setCompanyId(event.target.value)}
                value={companyId}
              >
                <option value="">All customers</option>
                {customers.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.companyName}
                  </option>
                ))}
              </select>
            </label>
          )}
          {totals.length === 0 && rows && (
            <p className={styles.muted}>Nothing is owing.</p>
          )}
          <ul className={styles.list}>
            {totals.map((total) => (
              <li key={total.currency}>
                <strong>
                  {formatMoney(total.outstandingMinor, total.currency)}
                </strong>{" "}
                owing
                {total.overdueMinor > 0 && (
                  <>
                    , of which{" "}
                    <span className={styles.error}>
                      {formatMoney(total.overdueMinor, total.currency)} is
                      overdue
                    </span>
                  </>
                )}
              </li>
            ))}
          </ul>
        </section>
        {rows && rows.length > 0 && (
          <section
            className={styles.card}
            aria-labelledby="invoices-owing-title"
          >
            <h2 id="invoices-owing-title">Invoices</h2>
            <div className={styles.tableScroll}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Due</th>
                    <th>Invoice</th>
                    <th>Job</th>
                    {isStaff && <th>Customer</th>}
                    <th>Total</th>
                    <th>Owing</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.invoiceId}>
                      <td>
                        {row.dueDate ?? "-"}
                        {row.overdue && (
                          <span className={styles.error}>
                            {" "}
                            {row.daysOverdue} day(s) overdue
                          </span>
                        )}
                      </td>
                      <td>{row.invoiceNumber}</td>
                      <td>
                        <Link
                          className={styles.link}
                          href={`/jobs/${row.jobId}`}
                        >
                          {row.fileNumber}
                        </Link>
                      </td>
                      {isStaff && <td>{row.customerCompanyName}</td>}
                      <td>{formatMoney(row.totalMinor, row.currency)}</td>
                      <td>{formatMoney(row.outstandingMinor, row.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </main>
    </>
  );
}
