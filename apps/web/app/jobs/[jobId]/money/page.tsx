"use client";

import { canWorkFinance } from "../../../auth/roleAccess";
import { useStaffAccess } from "../../../auth/useStaffAccess";
import { JobCharges } from "../../JobCharges";
import { JobInvoices } from "../../JobInvoices";
import { useJob } from "../../JobShell";

export default function JobMoneyPage() {
  const { job, documents, isStaff, closedJob } = useJob();
  const { roles } = useStaffAccess();
  return (
    <>
      {canWorkFinance(roles) && (
        <JobCharges
          canEdit={!closedJob}
          documents={documents}
          jobId={job.id}
          quoteId={job.quoteId}
        />
      )}
      <JobInvoices
        canEdit={!closedJob}
        documents={documents}
        isStaff={isStaff}
        jobId={job.id}
        quoteId={job.quoteId}
      />
    </>
  );
}
