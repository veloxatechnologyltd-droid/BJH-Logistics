"use client";

import { JobEta } from "../../JobEta";
import { JobEtd } from "../../JobEtd";
import { useJob } from "../../JobShell";

export default function JobSchedulePage() {
  const { job, isStaff, closedJob, reload } = useJob();
  const canEdit = isStaff && !closedJob;
  // Imports are tracked by arrival, exports by departure.
  return job.serviceLine.endsWith("_import") ? (
    <JobEta canEdit={canEdit} jobId={job.id} />
  ) : (
    <JobEtd
      canEdit={canEdit}
      etdAt={job.etdAt}
      jobId={job.id}
      key={`etd:${job.etdAt}`}
      onSaved={reload}
    />
  );
}
