"use client";

import Link from "next/link";
import { useState } from "react";
import type { FormEvent } from "react";
import { recordMilestone } from "./jobApi";
import type { Job, MilestoneEvent, Timeline } from "./jobApi";
import { formatDate } from "./jobFormat";
import styles from "./jobs.module.css";

function localDateTime(iso: string): string {
  const date = new Date(iso);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
}

export function JobSteps({
  job,
  timeline,
  canEdit,
  run,
}: {
  job: Job;
  timeline: Timeline;
  canEdit: boolean;
  run: (action: () => Promise<unknown>, after?: () => void) => Promise<void>;
}) {
  const [entry, setEntry] = useState<{
    milestoneKey: string;
    correctionOf?: string;
  } | null>(null);
  const [when, setWhen] = useState("");
  const [note, setNote] = useState("");
  const financeKeys = new Set([
    "customer_invoice_issued",
    "customer_payment_recorded",
  ]);
  const latestByKey = new Map<string, MilestoneEvent>();
  for (const event of timeline.events) {
    if (financeKeys.has(event.milestoneKey) && event.source !== "system") {
      continue;
    }
    const previous = latestByKey.get(event.milestoneKey);
    if (!previous || event.recordedAt > previous.recordedAt) {
      latestByKey.set(event.milestoneKey, event);
    }
  }

  function save(event: FormEvent) {
    event.preventDefault();
    if (!entry?.milestoneKey) return;
    void run(
      () =>
        recordMilestone(job.id, {
          milestoneKey: entry.milestoneKey,
          occurredAt: when ? new Date(when).toISOString() : undefined,
          note: note.trim() || undefined,
          correctionOf: entry.correctionOf,
        }),
      () => {
        setEntry(null);
        setWhen("");
        setNote("");
      },
    );
  }

  function correct(event: MilestoneEvent) {
    setEntry({ milestoneKey: event.milestoneKey, correctionOf: event.id });
    setWhen(localDateTime(event.occurredAt));
    setNote(event.note ?? "");
  }

  return (
    <div className={styles.progressSteps}>
      <h3>Shipment steps</h3>
      <div className={entry ? styles.progressSplit : undefined}>
        <ol className={styles.progressList}>
          {timeline.template.map((item, index) => {
            const recorded = latestByKey.get(item.key);
            return (
              <li
                key={item.key}
                className={recorded ? styles.progressDone : ""}
              >
                <span className={styles.progressNumber}>
                  {recorded ? (
                    <svg
                      aria-label="Completed"
                      fill="none"
                      height="14"
                      role="img"
                      stroke="currentColor"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="3"
                      viewBox="0 0 24 24"
                      width="14"
                    >
                      <path d="M5 12.5l4.5 4.5L19 7.5" />
                    </svg>
                  ) : (
                    index + 1
                  )}
                </span>
                <div>
                  <strong>{item.label}</strong>
                  <small>
                    {recorded
                      ? `Recorded ${formatDate(recorded.occurredAt)}`
                      : "Not recorded"}
                  </small>
                </div>
                {financeKeys.has(item.key) ? (
                  <Link
                    className={styles.textButton}
                    href={
                      item.key === "customer_payment_recorded" &&
                      !recorded &&
                      canEdit
                        ? `/jobs/${job.id}/money?pay=1#invoices-title`
                        : `/jobs/${job.id}/money#invoices-title`
                    }
                  >
                    {recorded
                      ? "View"
                      : !canEdit
                        ? "View invoices"
                        : item.key === "customer_payment_recorded"
                          ? "Record payment"
                          : "Create invoice"}
                  </Link>
                ) : canEdit ? (
                  <button
                    className={styles.textButton}
                    onClick={() => {
                      if (recorded) correct(recorded);
                      else {
                        setEntry({ milestoneKey: item.key });
                        setWhen("");
                        setNote("");
                      }
                    }}
                    type="button"
                  >
                    {recorded ? "Edit" : "Record"}
                  </button>
                ) : null}
              </li>
            );
          })}
        </ol>
        {entry && (
          <form
            className={`${styles.form} ${styles.progressForm}`}
            onSubmit={save}
          >
            <strong>
              {entry.correctionOf ? "Edit" : "Record"}{" "}
              {
                timeline.template.find(
                  (item) => item.key === entry.milestoneKey,
                )?.label
              }
            </strong>
            <label className={styles.field}>
              When (optional)
              <input
                onChange={(event) => setWhen(event.target.value)}
                type="datetime-local"
                value={when}
              />
            </label>
            <label className={styles.field}>
              Note (optional)
              <input
                onChange={(event) => setNote(event.target.value)}
                value={note}
              />
            </label>
            <div className={styles.formActions}>
              <button className={styles.button} type="submit">
                {entry.correctionOf ? "Save correction" : "Record update"}
              </button>
              <button
                className={styles.secondaryButton}
                onClick={() => setEntry(null)}
                type="button"
              >
                Cancel
              </button>
            </div>
            {!entry.correctionOf && (
              <small className={styles.hint}>
                A customer message may be sent for this update.
              </small>
            )}
          </form>
        )}
      </div>
      {timeline.events.length > 0 && (
        <details className={styles.progressHistory}>
          <summary className={styles.disclosureSummary}>Update history</summary>
          <ol className={styles.timeline}>
            {[...timeline.events].reverse().map((event) => (
              <li key={event.id}>
                <strong>
                  {timeline.template.find(
                    (item) => item.key === event.milestoneKey,
                  )?.label ?? event.milestoneKey}
                </strong>
                <span>
                  {formatDate(event.occurredAt)}
                  {event.source === "system" ? " · From Costs & invoices" : ""}
                  {event.correctionOf ? " · Correction" : ""}
                </span>
                {event.note && <span>{event.note}</span>}
              </li>
            ))}
          </ol>
        </details>
      )}
    </div>
  );
}
