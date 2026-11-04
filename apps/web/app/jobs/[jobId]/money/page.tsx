"use client";

import Link from "next/link";
import { canWorkFinance } from "../../../auth/roleAccess";
import { useStaffAccess } from "../../../auth/useStaffAccess";
import { JobCharges } from "../../JobCharges";
import { JobInvoices } from "../../JobInvoices";
import { useJob } from "../../JobShell";
import styles from "../../jobs.module.css";

/**
 * The job's money, read-only: invoices, payments and costs are created and
 * recorded in Finance only (client walkthrough, 2026-11-03).
 */
export default function JobMoneyPage() {
  const { job, documents, isStaff } = useJob();
  const { roles } = useStaffAccess();
  const finance = isStaff && canWorkFinance(roles);
  return (
    <>
      {finance && (
        <p className={styles.notice}>
          Invoices, payments and costs are worked in Finance.{" "}
          <Link className={styles.link} href={`/finance/jobs/${job.id}`}>
            Open this job&apos;s billing in Finance →
          </Link>
        </p>
      )}
      {finance && (
        <JobCharges
          canEdit={false}
          documents={documents}
          jobId={job.id}
          quoteId={job.quoteId}
        />
      )}
      <JobInvoices
        canEdit={false}
        documents={documents}
        isStaff={isStaff}
        jobId={job.id}
        quoteId={job.quoteId}
      />
    </>
  );
}
