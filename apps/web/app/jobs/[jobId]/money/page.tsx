"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { canWorkFinance } from "../../../auth/roleAccess";
import { useStaffAccess } from "../../../auth/useStaffAccess";
import { JobInvoices } from "../../JobInvoices";
import { useJob } from "../../JobShell";
import styles from "../../jobs.module.css";

/**
 * The customer's invoices for this job, read-only. Staff work invoices,
 * payments and costs in Finance only (Evans, 2026-11-04), so an old link to
 * this tab takes finance staff to the job's billing there.
 */
export default function JobMoneyPage() {
  const { job, documents, isStaff } = useJob();
  const { roles } = useStaffAccess();
  const router = useRouter();
  const finance = isStaff && canWorkFinance(roles);

  useEffect(() => {
    if (finance) router.replace(`/finance/jobs/${job.id}`);
  }, [finance, job.id, router]);

  if (isStaff) {
    return (
      <p className={styles.muted} role="status">
        {finance
          ? "Opening this job's billing in Finance…"
          : "Billing is worked in Finance."}
      </p>
    );
  }
  return (
    <JobInvoices
      canEdit={false}
      documents={documents}
      isStaff={false}
      jobId={job.id}
    />
  );
}
