"use client";

import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { addJobReminder, listJobReminders } from "./jobApi";
import type { JobReminder } from "./jobApi";
import { dismissStaffNotice } from "../quotations/quoteRequestApi";
import styles from "./jobs.module.css";
import { ErrorPopup } from "../ErrorPopup";

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

/** The signed-in person's own reminders on this job; each pops up for them when due. */
export function JobReminders({
  jobId,
  canEdit,
}: {
  jobId: string;
  canEdit: boolean;
}) {
  const [reminders, setReminders] = useState<JobReminder[] | null>(null);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const [remindAt, setRemindAt] = useState("");
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    try {
      setReminders(await listJobReminders(jobId));
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The reminders could not be loaded",
      );
    }
  }, [jobId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(action: () => Promise<unknown>) {
    setError("");
    try {
      await action();
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The action failed");
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void act(async () => {
      await addJobReminder(jobId, {
        remindAt: new Date(remindAt).toISOString(),
        note: note.trim() || undefined,
      });
      setRemindAt("");
      setNote("");
      setAdding(false);
    });
  }

  return (
    <section className={styles.card} aria-labelledby="reminders-title">
      <div className={styles.stepsHeading}>
        <h2 id="reminders-title">Reminders</h2>
        {canEdit && !adding && (
          <button
            className={styles.secondaryButton}
            onClick={() => setAdding(true)}
            type="button"
          >
            Set a reminder
          </button>
        )}
      </div>
      <ErrorPopup message={error} />
      {reminders && reminders.length === 0 && (
        <p className={styles.muted}>No reminders set.</p>
      )}
      {reminders && reminders.length > 0 && (
        <ul className={styles.list}>
          {reminders.map((reminder) => (
            <li key={reminder.id}>
              {formatDate(reminder.dueAt)}
              {reminder.note ? ` — ${reminder.note}` : ""}{" "}
              <button
                className={styles.textButton}
                onClick={() => void act(() => dismissStaffNotice(reminder.id))}
                type="button"
              >
                Cancel
              </button>
            </li>
          ))}
        </ul>
      )}
      {canEdit && adding && (
        <form className={styles.form} onSubmit={submit}>
          <label className={styles.field}>
            Remind me on
            <input
              onChange={(event) => setRemindAt(event.target.value)}
              required
              type="datetime-local"
              value={remindAt}
            />
          </label>
          <label className={styles.field}>
            Note (optional)
            <input
              onChange={(event) => setNote(event.target.value)}
              placeholder="Goods arriving, call the agent…"
              value={note}
            />
          </label>
          <div className={styles.actions}>
            <button className={styles.button} type="submit">
              Save reminder
            </button>
            <button
              className={styles.secondaryButton}
              onClick={() => setAdding(false)}
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
