"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import {
  activityLabels,
  addLeadActivity,
  listLeadActivities,
} from "../leadApi";
import type { LeadActivity } from "../leadApi";
import styles from "./leadActivities.module.css";

/** A lead's follow-up history (calls, visits, emails, meetings), opened on request. */
export function LeadActivities({ leadId }: { leadId: string }) {
  const [items, setItems] = useState<LeadActivity[] | null>(null);
  const [kind, setKind] = useState<LeadActivity["kind"]>("call");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  async function load() {
    try {
      setItems(await listLeadActivities(leadId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load");
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!note.trim()) return;
    setError("");
    try {
      await addLeadActivity(leadId, { kind, note: note.trim() });
      setNote("");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Saving failed");
    }
  }

  return (
    <details
      className={styles.activities}
      onToggle={(event) => {
        if ((event.currentTarget as HTMLDetailsElement).open && !items)
          void load();
      }}
    >
      <summary>Follow-ups</summary>
      {error && <p className={styles.error}>{error}</p>}
      <form className={styles.add} onSubmit={(event) => void submit(event)}>
        <select
          aria-label="Kind of follow-up"
          onChange={(event) =>
            setKind(event.target.value as LeadActivity["kind"])
          }
          value={kind}
        >
          {(Object.keys(activityLabels) as LeadActivity["kind"][]).map(
            (key) => (
              <option key={key} value={key}>
                {activityLabels[key]}
              </option>
            ),
          )}
        </select>
        <input
          aria-label="What happened"
          maxLength={2000}
          onChange={(event) => setNote(event.target.value)}
          placeholder="What happened, what was agreed"
          value={note}
        />
        <button type="submit">Log</button>
      </form>
      {items?.length === 0 && (
        <p className={styles.empty}>Nothing logged yet.</p>
      )}
      {items && items.length > 0 && (
        <ul className={styles.list}>
          {items.map((item) => (
            <li key={item.id}>
              <strong>{activityLabels[item.kind]}</strong> {item.note}
              <span>
                {new Date(item.occurredAt).toLocaleString()}
                {item.createdByEmail ? ` · ${item.createdByEmail}` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}
