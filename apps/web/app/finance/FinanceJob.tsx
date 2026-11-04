"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { canWorkFinance } from "../auth/roleAccess";
import { useStaffAccess } from "../auth/useStaffAccess";
import { FinanceTabs } from "../invoices/FinanceTabs";
import { invoiceStatusLabels } from "../jobs/JobInvoices";
import { getTimeline, listInvoices } from "../jobs/jobApi";
import type { Invoice, Job } from "../jobs/jobApi";
import { formatMoney } from "../quotes/quoteApi";
import styles from "../jobs/jobs.module.css";
import { ErrorPopup } from "../ErrorPopup";

/**
 * A job in Finance, kept simple for a non-technical team (Evans,
 * 2026-11-04): buttons to create an invoice or record a payment, the job's
 * invoices as links to their own pages. What BJH paid suppliers is recorded
 * on Finance → Costs, linked from here.
 */
export function FinanceJob({ jobId }: { jobId: string }) {
  const { status, roles } = useStaffAccess();
  const [job, setJob] = useState<Job | null>(null);
  const [invoices, setInvoices] = useState<Invoice[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([getTimeline(jobId), listInvoices(jobId)])
      .then(([timeline, found]) => {
        setJob(timeline.job);
        setInvoices(found);
      })
      .catch((cause) =>
        setError(
          cause instanceof Error
            ? cause.message
            : "The job could not be loaded",
        ),
      );
  }, [jobId]);

  if (status === "loading" && roles.length === 0) {
    return <p role="status">Checking staff access…</p>;
  }
  if (!canWorkFinance(roles)) {
    return (
      <main className={styles.page}>
        <p role="status">Job billing is for Finance.</p>
      </main>
    );
  }

  const closedJob = job?.status === "closed" || job?.status === "cancelled";
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <Link className={styles.link} href="/finance/jobs">
            ← Finance jobs
          </Link>
          <h1 className={styles.title}>
            {job ? `Billing for ${job.fileNumber}` : "Job billing"}
          </h1>
          {job && (
            <p className={styles.muted}>
              {job.customerCompanyName} ·{" "}
              <Link className={styles.link} href={`/jobs/${job.id}`}>
                Open the job
              </Link>
            </p>
          )}
        </div>
        {job && (
          <div className={styles.toolbar}>
            {!closedJob && (
              <Link
                className={styles.primaryLink}
                href={`/finance/invoices/new?client=${job.customerCompanyId}&job=${job.id}`}
              >
                Create invoice
              </Link>
            )}
            <Link
              className={styles.secondaryButton}
              href={`/finance/receipts?pay=${job.customerCompanyId}`}
            >
              Record payment
            </Link>
            <Link
              className={styles.secondaryButton}
              href={`/finance/costs?job=${job.id}${closedJob ? "" : "&record=1"}`}
            >
              {closedJob ? "View costs" : "Record a cost"}
            </Link>
          </div>
        )}
      </header>
      <FinanceTabs active="/finance/jobs" />
      <ErrorPopup message={error} />
      {job && invoices && (
        <section className={styles.card} aria-labelledby="job-invoices-title">
          <h2 id="job-invoices-title">Invoices</h2>
          {invoices.length === 0 ? (
            <p className={styles.muted}>No invoices yet.</p>
          ) : (
            <ul className={styles.list}>
              {invoices.map((invoice) => (
                <li key={invoice.id}>
                  <Link
                    className={styles.link}
                    href={`/finance/jobs/${job.id}/invoices/${invoice.id}`}
                  >
                    {invoice.invoiceNumber ?? "Draft invoice"}
                  </Link>{" "}
                  <span className={styles.badge}>
                    {invoiceStatusLabels[invoice.paymentStatus]}
                  </span>{" "}
                  {formatMoney(invoice.totalMinor, invoice.currency)}
                  {invoice.status === "issued" &&
                    invoice.outstandingMinor > 0 &&
                    ` · owing ${formatMoney(invoice.outstandingMinor, invoice.currency)}`}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </main>
  );
}
