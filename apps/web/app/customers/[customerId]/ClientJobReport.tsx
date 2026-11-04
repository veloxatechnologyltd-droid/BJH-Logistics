"use client";

import { useState } from "react";
import {
  fetchClientJobReportPdf,
  serviceLineLabels,
  statusLabels,
} from "../../jobs/jobApi";
import type { Job } from "../../jobs/jobApi";
import styles from "../../jobs/jobs.module.css";

/**
 * A one-line-per-job status update for the client: goods, vessel, ETA, status
 * and expected completion. It carries no invoices or amounts, so any staff
 * member can open it and send it on. Cancelled jobs are not in it.
 */
export function ClientJobReport({
  customerId,
  jobs,
}: {
  customerId: string;
  jobs: Job[];
}) {
  const reportable = jobs.filter((job) => job.status !== "cancelled");
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function open() {
    // Opened first so the browser treats it as a click, not a pop-up.
    const tab = window.open("", "_blank");
    setBusy(true);
    setError("");
    try {
      const url = URL.createObjectURL(
        await fetchClientJobReportPdf(customerId, [...ticked]),
      );
      if (tab) tab.location.href = url;
      else window.location.href = url;
    } catch (cause) {
      tab?.close();
      setError(cause instanceof Error ? cause.message : "The PDF failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="client-job-report-title" className={styles.card}>
      <h2 id="client-job-report-title">Client job report</h2>
      <p className={styles.muted}>
        A one-line-per-job status update to share with the client: goods,
        vessel, ETA, status and expected completion. It has no invoices or
        amounts. Tick jobs to include only those; with none ticked, every job is
        included.
      </p>
      {reportable.length === 0 ? (
        <p className={styles.muted}>No jobs yet.</p>
      ) : (
        <ul className={styles.itemList}>
          {reportable.map((job) => (
            <li key={job.id}>
              <label>
                <input
                  checked={ticked.has(job.id)}
                  onChange={() =>
                    setTicked((current) => {
                      const next = new Set(current);
                      if (next.has(job.id)) next.delete(job.id);
                      else next.add(job.id);
                      return next;
                    })
                  }
                  type="checkbox"
                />{" "}
                <strong>{job.fileNumber}</strong>{" "}
                <small>
                  {serviceLineLabels[job.serviceLine]} ·{" "}
                  {statusLabels[job.status]}
                </small>
              </label>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      <div className={styles.actions}>
        <button
          className={styles.button}
          disabled={busy || reportable.length === 0}
          onClick={() => void open()}
          type="button"
        >
          {busy
            ? "Preparing…"
            : ticked.size > 0
              ? `Open client report for ${ticked.size} ${ticked.size === 1 ? "job" : "jobs"}`
              : "Open client report for all jobs"}
        </button>
      </div>
    </section>
  );
}
