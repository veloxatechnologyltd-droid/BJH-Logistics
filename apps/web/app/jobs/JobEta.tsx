"use client";

import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { getEta, recordEta } from "./jobApi";
import type { Eta } from "./jobApi";
import styles from "./jobs.module.css";
import { ErrorPopup } from "../ErrorPopup";

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function JobEta({
  jobId,
  canEdit,
}: {
  jobId: string;
  canEdit: boolean;
}) {
  const [eta, setEta] = useState<Eta | null>(null);
  const [error, setError] = useState("");
  const [etaAt, setEtaAt] = useState("");
  const [source, setSource] = useState("");
  const [note, setNote] = useState("");
  const [editing, setEditing] = useState(false);

  const load = useCallback(async () => {
    try {
      setEta(await getEta(jobId));
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "The ETA could not be loaded",
      );
    }
  }, [jobId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      await recordEta(jobId, {
        etaAt: new Date(etaAt).toISOString(),
        source: source.trim(),
        note: note.trim() || undefined,
        correctionOf: eta?.current?.id,
      });
      setEtaAt("");
      setSource("");
      setNote("");
      setEditing(false);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The action failed");
    }
  }

  return (
    <section className={styles.card} aria-labelledby="eta-title">
      <div className={styles.stepsHeading}>
        <h2 id="eta-title">ETA</h2>
        {canEdit && !editing && (
          <button
            className={styles.secondaryButton}
            onClick={() => setEditing(true)}
            type="button"
          >
            {eta?.current ? "Change ETA" : "Set ETA"}
          </button>
        )}
      </div>
      <ErrorPopup message={error} />
      {eta?.current ? (
        <p className={styles.etaValue}>
          {formatDate(eta.current.etaAt)}
          <span className={styles.muted}> · {eta.current.source}</span>
        </p>
      ) : (
        <p className={styles.muted}>Not set.</p>
      )}
      {canEdit && editing && (
        <form className={styles.form} onSubmit={(event) => void submit(event)}>
          <label className={styles.field}>
            New ETA
            <input
              onChange={(event) => setEtaAt(event.target.value)}
              required
              type="datetime-local"
              value={etaAt}
            />
          </label>
          <label className={styles.field}>
            Source
            <input
              onChange={(event) => setSource(event.target.value)}
              placeholder="Carrier notice, agent email…"
              required
              value={source}
            />
          </label>
          <label className={styles.field}>
            Note (optional)
            <input
              onChange={(event) => setNote(event.target.value)}
              value={note}
            />
          </label>
          <div className={styles.actions}>
            <button className={styles.button} type="submit">
              Save ETA
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
      {eta && eta.history.length > 1 && (
        <details className={styles.etaHistory}>
          <summary>History</summary>
          <ul className={styles.list}>
            {[...eta.history].reverse().map((item) => (
              <li key={item.id}>
                {formatDate(item.etaAt)} · {item.source}
                {item.note ? ` — ${item.note}` : ""}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
