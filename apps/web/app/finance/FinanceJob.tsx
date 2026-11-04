"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { canWorkFinance } from "../auth/roleAccess";
import { useStaffAccess } from "../auth/useStaffAccess";
import { FinanceTabs } from "../invoices/FinanceTabs";
import { JobCharges } from "../jobs/JobCharges";
import { JobInvoices } from "../jobs/JobInvoices";
import { getTimeline, listDocuments } from "../jobs/jobApi";
import type { Job, JobDocument } from "../jobs/jobApi";
import styles from "../jobs/jobs.module.css";
import { ErrorPopup } from "../ErrorPopup";

/**
 * A job's billing, worked from Finance only (client walkthrough, 2026-11-03):
 * its costs and charges, invoices, and payments. The job's own page shows
 * them read-only.
 */
export function FinanceJob({ jobId }: { jobId: string }) {
  const { status, roles } = useStaffAccess();
  const [job, setJob] = useState<Job | null>(null);
  const [documents, setDocuments] = useState<JobDocument[]>([]);
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
      </header>
      <FinanceTabs active="/finance/jobs" />
      <ErrorPopup message={error} />
      {job && (
        <>
          <JobCharges
            canEdit={!closedJob}
            documents={documents}
            jobId={job.id}
            quoteId={job.quoteId}
          />
          <JobInvoices
            canEdit={!closedJob}
            documents={documents}
            isStaff
            jobId={job.id}
            quoteId={job.quoteId}
          />
        </>
      )}
    </main>
  );
}
