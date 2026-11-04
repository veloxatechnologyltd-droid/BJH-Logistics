"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { updateReportDetails } from "./jobApi";
import type { Job } from "./jobApi";
import styles from "./jobs.module.css";
import { ErrorPopup } from "../ErrorPopup";

/** What the client job report shows beyond the job's own fields: kept by staff by hand. */
export function JobReportDetails({
  job,
  canEdit,
  onSaved,
}: {
  job: Job;
  canEdit: boolean;
  onSaved: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [goods, setGoods] = useState(job.goodsDescription ?? "");
  const [remarks, setRemarks] = useState(job.remarks ?? "");
  const [expected, setExpected] = useState(job.expectedCompletionDate ?? "");
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      await updateReportDetails(job.id, {
        goodsDescription: goods,
        remarks,
        expectedCompletionDate: expected,
      });
      setEditing(false);
      await onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Saving failed");
    }
  }

  const shown = [
    ["Description of goods", job.goodsDescription],
    ["Status remark", job.remarks],
    [
      "Expected completion",
      job.expectedCompletionDate
        ? job.expectedCompletionDate.split("-").reverse().join("/")
        : null,
    ],
  ] as const;

  return (
    <section className={styles.card} aria-labelledby="report-details-title">
      <div className={styles.stepsHeading}>
        <h2 id="report-details-title">Client report details</h2>
        {canEdit && !editing && (
          <button
            className={styles.secondaryButton}
            onClick={() => setEditing(true)}
            type="button"
          >
            {shown.some(([, value]) => value) ? "Change" : "Add"}
          </button>
        )}
      </div>
      <p className={styles.muted}>
        Shown on the client job report. With no status remark, the report shows
        the latest step recorded on the job.
      </p>
      <ErrorPopup message={error} />
      {!editing &&
        (shown.some(([, value]) => value) ? (
          <ul className={styles.list}>
            {shown.map(([label, value]) => (
              <li key={label}>
                {label}: <strong>{value ?? "—"}</strong>
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.muted}>Not recorded.</p>
        ))}
      {editing && (
        <form className={styles.form} onSubmit={(event) => void submit(event)}>
          <label className={styles.field}>
            Description of goods
            <textarea
              maxLength={500}
              onChange={(event) => setGoods(event.target.value)}
              rows={2}
              value={goods}
            />
          </label>
          <label className={styles.field}>
            Status remark
            <input
              maxLength={300}
              onChange={(event) => setRemarks(event.target.value)}
              value={remarks}
            />
          </label>
          <label className={styles.field}>
            Expected completion
            <input
              onChange={(event) => setExpected(event.target.value)}
              type="date"
              value={expected}
            />
          </label>
          <div className={styles.actions}>
            <button className={styles.button} type="submit">
              Save
            </button>
            <button
              className={styles.secondaryButton}
              onClick={() => setEditing(false)}
              type="button"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
