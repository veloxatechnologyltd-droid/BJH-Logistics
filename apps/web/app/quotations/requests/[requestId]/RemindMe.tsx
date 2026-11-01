"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { remindAboutRequest } from "../../quoteRequestApi";
import { ErrorPopup } from "../../../ErrorPopup";
import styles from "../../quotation.module.css";

/** "I will attend to this on <date, time>": a pop-up comes back then. */
export function RemindMe({ requestId }: { requestId: string }) {
  const [open, setOpen] = useState(false);
  const [when, setWhen] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      const reminder = await remindAboutRequest(
        requestId,
        new Date(when).toISOString(),
        note.trim() || undefined,
      );
      setSaved(
        `You will be reminded ${new Date(reminder.dueAt).toLocaleString()}.`,
      );
      setOpen(false);
      setWhen("");
      setNote("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The reminder failed");
    }
  }

  return (
    <div className={styles.remindMe}>
      <ErrorPopup message={error} />
      {!open && (
        <button
          className={styles.secondaryButton}
          onClick={() => {
            setSaved("");
            setOpen(true);
          }}
          type="button"
        >
          Remind me
        </button>
      )}
      {saved && <p className={styles.remindSaved}>{saved}</p>}
      {open && (
        <form
          className={styles.remindForm}
          onSubmit={(event) => void submit(event)}
        >
          <label>
            Attend to this on
            <input
              onChange={(event) => setWhen(event.target.value)}
              required
              type="datetime-local"
              value={when}
            />
          </label>
          <label>
            Note (optional)
            <input
              maxLength={500}
              onChange={(event) => setNote(event.target.value)}
              value={note}
            />
          </label>
          <button className={styles.primaryButton} type="submit">
            Set reminder
          </button>
          <button
            className={styles.secondaryButton}
            onClick={() => setOpen(false)}
            type="button"
          >
            Cancel
          </button>
        </form>
      )}
    </div>
  );
}
