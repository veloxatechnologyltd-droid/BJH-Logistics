"use client";

import { useState } from "react";
import {
  fetchJobReportPdf,
  sendJobReport,
  serviceLineLabels,
  statusLabels,
} from "../../jobs/jobApi";
import type { Job } from "../../jobs/jobApi";
import styles from "../../jobs/jobs.module.css";

/**
 * A detailed PDF of this customer's jobs (all, or the ticked ones): each job's
 * details, progress and deliveries, its invoices with what is paid and owed,
 * and totals. Open it, then save or send it to the client.
 */
export function JobReport({
  customerId,
  jobs,
}: {
  customerId: string;
  jobs: Job[];
}) {
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  async function email() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await sendJobReport(customerId, [...ticked]);
      setNotice("The job report is on its way to the client's contacts.");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "The report was not sent",
      );
    } finally {
      setBusy(false);
    }
  }

  async function open() {
    // Opened first so the browser treats it as a click, not a pop-up.
    const tab = window.open("", "_blank");
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const url = URL.createObjectURL(
        await fetchJobReportPdf(customerId, [...ticked]),
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
    <section aria-labelledby="job-report-title" className={styles.card}>
      <h2 id="job-report-title">Job report</h2>
      <p className={styles.muted}>
        A detailed PDF of this customer&apos;s jobs, with invoices, payments and
        balances. Open it, or email it to the client&apos;s contacts. Tick jobs
        to include only those; with none ticked, every job is included.
      </p>
      {jobs.length === 0 ? (
        <p className={styles.muted}>No jobs yet.</p>
      ) : (
        <ul className={styles.itemList}>
          {jobs.map((job) => (
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
      {notice && (
        <p className={styles.muted} role="status">
          {notice}
        </p>
      )}
      <div className={styles.actions}>
        <button
          className={styles.button}
          disabled={busy || jobs.length === 0}
          onClick={() => void open()}
          type="button"
        >
          {busy
            ? "Preparing…"
            : ticked.size > 0
              ? `Open report for ${ticked.size} ${ticked.size === 1 ? "job" : "jobs"}`
              : "Open report for all jobs"}
        </button>
        <button
          className={styles.secondaryButton}
          disabled={busy || jobs.length === 0}
          onClick={() => void email()}
          type="button"
        >
          Email to client
        </button>
      </div>
    </section>
  );
}
