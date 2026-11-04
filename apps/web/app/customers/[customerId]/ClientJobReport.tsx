"use client";

import { useState } from "react";
import {
  fetchClientJobReportPdf,
  serviceLineLabels,
  statusLabels,
} from "../../jobs/jobApi";
import type { ClientJobReportInclude, Job } from "../../jobs/jobApi";
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
  const [include, setInclude] = useState<ClientJobReportInclude>("ongoing");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  // The same rule as the API: no cancelled jobs; ongoing, completed or both;
  // opened within the dates, when given.
  const reportable = jobs.filter((job) => {
    if (job.status === "cancelled") return false;
    if (
      include !== "all" &&
      (include === "completed") !== (job.status === "closed")
    ) {
      return false;
    }
    const opened = job.openedAt.slice(0, 10);
    return (!from || opened >= from) && (!to || opened <= to);
  });
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const chosen = [...ticked].filter((id) =>
    reportable.some((job) => job.id === id),
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function open() {
    // Opened first so the browser treats it as a click, not a pop-up.
    const tab = window.open("", "_blank");
    setBusy(true);
    setError("");
    try {
      const url = URL.createObjectURL(
        await fetchClientJobReportPdf(customerId, {
          jobIds: chosen,
          include,
          from,
          to,
        }),
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
        amounts. Choose which jobs, then tick some to include only those; with
        none ticked, every job listed is included.
      </p>
      <div className={styles.filters}>
        <label className={styles.field}>
          Jobs
          <select
            onChange={(event) =>
              setInclude(event.target.value as ClientJobReportInclude)
            }
            value={include}
          >
            <option value="ongoing">Ongoing</option>
            <option value="completed">Completed</option>
            <option value="all">Ongoing and completed</option>
          </select>
        </label>
        <label className={styles.field}>
          Opened from
          <input
            max={to || undefined}
            onChange={(event) => setFrom(event.target.value)}
            type="date"
            value={from}
          />
        </label>
        <label className={styles.field}>
          Opened to
          <input
            min={from || undefined}
            onChange={(event) => setTo(event.target.value)}
            type="date"
            value={to}
          />
        </label>
      </div>
      {reportable.length === 0 ? (
        <p className={styles.muted}>No jobs match.</p>
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
            : chosen.length > 0
              ? `Open client report for ${chosen.length} ${chosen.length === 1 ? "job" : "jobs"}`
              : `Open client report for ${reportable.length} ${reportable.length === 1 ? "job" : "jobs"}`}
        </button>
      </div>
    </section>
  );
}
