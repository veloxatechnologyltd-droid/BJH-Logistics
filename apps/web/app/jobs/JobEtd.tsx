"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { updateEtd } from "./jobApi";
import styles from "./jobs.module.css";
import { ErrorPopup } from "../ErrorPopup";

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

/** The estimated departure, kept by staff by hand next to the ETA. */
export function JobEtd({
  jobId,
  etdAt,
  canEdit,
  onSaved,
}: {
  jobId: string;
  etdAt: string | null;
  canEdit: boolean;
  onSaved: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [error, setError] = useState("");

  async function save(next: string) {
    setError("");
    try {
      await updateEtd(jobId, next ? new Date(next).toISOString() : "");
      setEditing(false);
      setValue("");
      await onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Saving failed");
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void save(value);
  }

  return (
    <section className={styles.card} aria-labelledby="etd-title">
      <div className={styles.stepsHeading}>
        <h2 id="etd-title">ETD (estimated departure)</h2>
        {canEdit && !editing && (
          <button
            className={styles.secondaryButton}
            onClick={() => setEditing(true)}
            type="button"
          >
            {etdAt ? "Change ETD" : "Set ETD"}
          </button>
        )}
      </div>
      <ErrorPopup message={error} />
      {etdAt ? (
        <p className={styles.etaValue}>{formatDate(etdAt)}</p>
      ) : (
        <p className={styles.muted}>Not set.</p>
      )}
      {canEdit && editing && (
        <form className={styles.form} onSubmit={submit}>
          <label className={styles.field}>
            New ETD
            <input
              onChange={(event) => setValue(event.target.value)}
              required
              type="datetime-local"
              value={value}
            />
          </label>
          <div className={styles.actions}>
            <button className={styles.button} type="submit">
              Save ETD
            </button>
            {etdAt && (
              <button
                className={styles.secondaryButton}
                onClick={() => void save("")}
                type="button"
              >
                Clear ETD
              </button>
            )}
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
