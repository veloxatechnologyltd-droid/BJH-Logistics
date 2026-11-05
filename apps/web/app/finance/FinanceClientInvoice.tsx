"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { canWorkFinance } from "../auth/roleAccess";
import { useStaffAccess } from "../auth/useStaffAccess";
import { getCustomer } from "../customers/customerApi";
import { FinanceTabs } from "../invoices/FinanceTabs";
import { JobInvoices, invoiceStatusLabels } from "../jobs/JobInvoices";
import { clientHome } from "../jobs/jobApi";
import type { Invoice } from "../jobs/jobApi";
import { formatMoney } from "../quotes/quoteApi";
import styles from "../jobs/jobs.module.css";
import { ErrorPopup } from "../ErrorPopup";

/**
 * One invoice made for a client with no job, opened from Finance → Invoices:
 * the same editing, issuing, payments and PDF as an invoice on a job.
 */
export function FinanceClientInvoice({
  companyId,
  invoiceId,
}: {
  companyId: string;
  invoiceId: string;
}) {
  const { status, roles } = useStaffAccess();
  const [clientName, setClientName] = useState<string | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    getCustomer(companyId)
      .then((customer) => setClientName(customer.companyName))
      .catch((cause) =>
        setError(
          cause instanceof Error
            ? cause.message
            : "The invoice could not be loaded",
        ),
      );
  }, [companyId]);

  if (status === "loading" && roles.length === 0) {
    return <p role="status">Checking staff access…</p>;
  }
  if (!canWorkFinance(roles)) {
    return (
      <main className={styles.page}>
        <p role="status">Invoices are for Finance.</p>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <Link className={styles.link} href="/invoices">
            ← Invoices
          </Link>
          <h1 className={styles.title}>Invoice</h1>
          {clientName && <p className={styles.muted}>{clientName} · no job</p>}
        </div>
        <div className={styles.toolbar}>
          <Link
            className={styles.secondaryButton}
            href={`/finance/invoices/new?client=${companyId}`}
          >
            Create another invoice
          </Link>
        </div>
      </header>
      <FinanceTabs active="/invoices" />
      <ErrorPopup message={error} />
      <JobInvoices
        canEdit
        documents={[]}
        invoiceId={invoiceId}
        isStaff
        jobId={clientHome(companyId)}
        key={invoiceId}
        onLoaded={setInvoices}
      />
      {/* This page opens one invoice; the client's others made without a job are a click away. */}
      {invoices.some((invoice) => invoice.id !== invoiceId) && (
        <section className={styles.card} aria-labelledby="other-invoices-title">
          <h2 id="other-invoices-title">Other invoices with no job</h2>
          <ul className={styles.list}>
            {invoices
              .filter((invoice) => invoice.id !== invoiceId)
              .map((invoice) => (
                <li key={invoice.id}>
                  <Link
                    className={styles.link}
                    href={`/finance/clients/${companyId}/invoices/${invoice.id}`}
                  >
                    {invoice.invoiceNumber ?? "Draft invoice"}
                  </Link>{" "}
                  <span className={styles.badge}>
                    {invoiceStatusLabels[invoice.paymentStatus]}
                  </span>{" "}
                  {formatMoney(invoice.totalMinor, invoice.currency)}
                </li>
              ))}
          </ul>
        </section>
      )}
    </main>
  );
}
