"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { canWorkFinance } from "../auth/roleAccess";
import { useStaffAccess } from "../auth/useStaffAccess";
import { FinanceTabs } from "../invoices/FinanceTabs";
import { JobInvoices, invoiceStatusLabels } from "../jobs/JobInvoices";
import { getTimeline, listDocuments } from "../jobs/jobApi";
import type { Invoice, Job, JobDocument } from "../jobs/jobApi";
import { formatMoney } from "../quotes/quoteApi";
import styles from "../jobs/jobs.module.css";
import { ErrorPopup } from "../ErrorPopup";

/**
 * One invoice, opened from Finance → Invoices: edit and issue the draft,
 * download or send it, and record or reverse payments on it.
 */
export function FinanceInvoice({
  jobId,
  invoiceId,
}: {
  jobId: string;
  invoiceId: string;
}) {
  const { status, roles } = useStaffAccess();
  const [job, setJob] = useState<Job | null>(null);
  const [documents, setDocuments] = useState<JobDocument[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([getTimeline(jobId), listDocuments(jobId)])
      .then(([timeline, docs]) => {
        setJob(timeline.job);
        setDocuments(docs);
      })
      .catch((cause) =>
        setError(
          cause instanceof Error
            ? cause.message
            : "The invoice could not be loaded",
        ),
      );
  }, [jobId]);

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

  const closedJob = job?.status === "closed" || job?.status === "cancelled";
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <Link className={styles.link} href="/invoices">
            ← Invoices
          </Link>
          <h1 className={styles.title}>Invoice</h1>
          {job && (
            <p className={styles.muted}>
              {job.customerCompanyName} · job{" "}
              <Link className={styles.link} href={`/jobs/${job.id}`}>
                {job.fileNumber}
              </Link>
            </p>
          )}
        </div>
        {job && !closedJob && (
          <div className={styles.toolbar}>
            {/* A client often needs several invoices: start the next one
                for the same client and job without going back to the list.
                "fresh" because the quote's charges are already on this one. */}
            <Link
              className={styles.secondaryButton}
              href={`/finance/invoices/new?client=${job.customerCompanyId}&job=${job.id}&start=fresh`}
            >
              Create another invoice
            </Link>
          </div>
        )}
      </header>
      <FinanceTabs active="/invoices" />
      <ErrorPopup message={error} />
      {job && (
        <JobInvoices
          canEdit={!closedJob}
          documents={documents}
          invoiceId={invoiceId}
          isStaff
          jobId={job.id}
          key={invoiceId}
          onLoaded={setInvoices}
        />
      )}
      {/* This page opens one invoice; the job's others are a click away. */}
      {job && invoices.some((invoice) => invoice.id !== invoiceId) && (
        <section className={styles.card} aria-labelledby="other-invoices-title">
          <h2 id="other-invoices-title">Other invoices on this job</h2>
          <ul className={styles.list}>
            {invoices
              .filter((invoice) => invoice.id !== invoiceId)
              .map((invoice) => (
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
        </section>
      )}
    </main>
  );
}
