"use client";

import { JobEta } from "../../JobEta";
import { JobEtd } from "../../JobEtd";
import { JobReminders } from "../../JobReminders";
import { useJob } from "../../JobShell";

export default function JobSchedulePage() {
  const { job, isStaff, closedJob, reload } = useJob();
  const canEdit = isStaff && !closedJob;
  return (
    <>
      <JobEtd
        canEdit={canEdit}
        etdAt={job.etdAt}
        jobId={job.id}
        key={`etd:${job.etdAt}`}
        onSaved={reload}
      />
      <JobEta canEdit={canEdit} jobId={job.id} />
      {isStaff && <JobReminders canEdit={canEdit} jobId={job.id} />}
    </>
  );
}
