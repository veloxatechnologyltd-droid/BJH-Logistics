"use client";

import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { correspondenceChannelKeys } from "@bjh/contracts";
import type {
  CorrespondenceChannel,
  CorrespondenceDirection,
} from "@bjh/contracts";
import { addCorrespondence, listCorrespondence } from "./jobApi";
import type { CorrespondenceEntry, JobDocument } from "./jobApi";
import styles from "./jobs.module.css";
import { ErrorPopup } from "../ErrorPopup";

const channelLabels: Record<CorrespondenceChannel, string> = {
  email: "Email",
  whatsapp: "WhatsApp",
  sms: "SMS",
  phone: "Phone call",
  letter: "Letter",
  other: "Other",
};

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

/**
 * A manual log of emails, WhatsApp messages, calls and letters on this job, so
 * a conversation can be found years later. Nothing is sent from here. Staff
 * only, and it stays open after the job is closed.
 */
export function JobCorrespondence({
  jobId,
  documents,
}: {
  jobId: string;
  documents: JobDocument[];
}) {
  const [entries, setEntries] = useState<CorrespondenceEntry[] | null>(null);
  const [error, setError] = useState("");
  const [channel, setChannel] = useState<CorrespondenceChannel>("email");
  const [direction, setDirection] =
    useState<CorrespondenceDirection>("received");
  const [occurredAt, setOccurredAt] = useState("");
  const [counterparty, setCounterparty] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [documentId, setDocumentId] = useState("");
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    try {
      setEntries(await listCorrespondence(jobId));
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Correspondence could not be loaded",
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
      await addCorrespondence(jobId, {
        channel,
        direction,
        occurredAt: occurredAt ? new Date(occurredAt).toISOString() : undefined,
        counterparty: counterparty.trim() || undefined,
        subject: subject.trim() || undefined,
        body: body.trim(),
        documentId: documentId || undefined,
      });
      setOccurredAt("");
      setCounterparty("");
      setSubject("");
      setBody("");
      setDocumentId("");
      setAdding(false);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The entry failed");
    }
  }

  const attachmentName = (id: string | null) =>
    documents.find((item) => item.id === id)?.versions.at(-1)?.filename ??
    "document";

  return (
    <section className={styles.card} aria-labelledby="correspondence-title">
      <div className={styles.stepsHeading}>
        <h2 id="correspondence-title">Correspondence log</h2>
        {!adding && (
          <button
            className={styles.secondaryButton}
            onClick={() => setAdding(true)}
            type="button"
          >
            Log a message or call
          </button>
        )}
      </div>
      <ErrorPopup message={error} />
      {entries && entries.length === 0 && (
        <p className={styles.muted}>Nothing logged yet.</p>
      )}
      {entries && entries.length > 0 && (
        <ul className={styles.list}>
          {entries.map((entry) => (
            <li key={entry.id}>
              <strong>
                {channelLabels[entry.channel]}{" "}
                {entry.direction === "received" ? "received" : "sent"}
              </strong>{" "}
              · {formatDate(entry.occurredAt)}
              {entry.counterparty ? ` · ${entry.counterparty}` : ""}
              {entry.subject ? ` · ${entry.subject}` : ""}
              <br />
              {entry.body}
              {entry.documentId && (
                <>
                  <br />
                  <span className={styles.muted}>
                    Attached: {attachmentName(entry.documentId)}
                  </span>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {adding && (
        <form
          className={`${styles.form} ${styles.quickUpdateForm}`}
          onSubmit={submit}
        >
          <label className={styles.field}>
            Channel
            <select
              onChange={(event) =>
                setChannel(event.target.value as CorrespondenceChannel)
              }
              value={channel}
            >
              {correspondenceChannelKeys.map((key) => (
                <option key={key} value={key}>
                  {channelLabels[key]}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            Direction
            <select
              onChange={(event) =>
                setDirection(event.target.value as CorrespondenceDirection)
              }
              value={direction}
            >
              <option value="received">Received by BJH</option>
              <option value="sent">Sent by BJH</option>
            </select>
          </label>
          <label className={styles.field}>
            When (leave empty for now)
            <input
              onChange={(event) => setOccurredAt(event.target.value)}
              type="datetime-local"
              value={occurredAt}
            />
          </label>
          <label className={styles.field}>
            With whom (optional)
            <input
              maxLength={200}
              onChange={(event) => setCounterparty(event.target.value)}
              value={counterparty}
            />
          </label>
          <label className={styles.field}>
            Subject (optional)
            <input
              maxLength={300}
              onChange={(event) => setSubject(event.target.value)}
              value={subject}
            />
          </label>
          <label className={`${styles.field} ${styles.wide}`}>
            What was said
            <textarea
              maxLength={20000}
              onChange={(event) => setBody(event.target.value)}
              required
              rows={4}
              value={body}
            />
          </label>
          <label className={styles.field}>
            Attachment from this job&apos;s documents (optional)
            <select
              onChange={(event) => setDocumentId(event.target.value)}
              value={documentId}
            >
              <option value="">None</option>
              {documents.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.versions.at(-1)?.filename ?? item.documentType}
                </option>
              ))}
            </select>
          </label>
          <div className={styles.formActions}>
            <button className={styles.button} type="submit">
              Save
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
