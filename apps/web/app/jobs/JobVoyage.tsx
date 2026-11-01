"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { updateVoyage } from "./jobApi";
import type { Job } from "./jobApi";
import styles from "./jobs.module.css";
import { ErrorPopup } from "../ErrorPopup";

/** The vessel and ports on a job: kept by staff so jobs can be found by them. */
export function JobVoyage({
  job,
  canEdit,
  onSaved,
}: {
  job: Job;
  canEdit: boolean;
  onSaved: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [vessel, setVessel] = useState(job.vessel ?? "");
  const [loading, setLoading] = useState(job.portOfLoading ?? "");
  const [discharge, setDischarge] = useState(job.portOfDischarge ?? "");
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      await updateVoyage(job.id, {
        vessel,
        portOfLoading: loading,
        portOfDischarge: discharge,
      });
      setEditing(false);
      await onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Saving failed");
    }
  }

  const shown = [
    ["Vessel", job.vessel],
    ["Port of loading", job.portOfLoading],
    ["Port of discharge", job.portOfDischarge],
  ] as const;

  return (
    <section className={styles.card} aria-labelledby="voyage-title">
      <div className={styles.stepsHeading}>
        <h2 id="voyage-title">Vessel and ports</h2>
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
          {(
            [
              ["Vessel", vessel, setVessel],
              ["Port of loading", loading, setLoading],
              ["Port of discharge", discharge, setDischarge],
            ] as const
          ).map(([label, value, set]) => (
            <label className={styles.field} key={label}>
              {label}
              <input
                maxLength={120}
                onChange={(event) => set(event.target.value)}
                value={value}
              />
            </label>
          ))}
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
