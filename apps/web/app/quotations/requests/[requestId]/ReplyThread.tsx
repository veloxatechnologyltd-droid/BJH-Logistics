"use client";

import { useCallback, useEffect, useState } from "react";
import { ErrorPopup, plainMessage } from "../../../ErrorPopup";
import { listRequestReplies, sendAnotherReply } from "../../quoteRequestApi";
import type { SentReply } from "../../quoteRequestApi";
import styles from "../../quotation.module.css";

const formatDate = (value: string) =>
  new Intl.DateTimeFormat("en-GH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Africa/Accra",
  }).format(new Date(value));

const statusLabels: Record<NonNullable<SentReply["status"]>, string> = {
  pending: "Sending",
  sent: "Sent",
  failed: "Failed to send",
  skipped: "Not sent",
};

const reSubject = (subject: string) =>
  /^re:/i.test(subject.trim()) ? subject.trim() : `Re: ${subject.trim()}`;

/**
 * Every reply sent to the email's sender (the assistant's and staff's), and a
 * form to write another one. Shown once the first reply has gone out.
 */
export function ReplyThread({
  requestId,
  subject: firstSubject,
  canEdit,
  canSend,
}: {
  requestId: string;
  subject: string;
  canEdit: boolean;
  /** False until the request is linked to a customer. */
  canSend: boolean;
}) {
  const [replies, setReplies] = useState<SentReply[] | null>(null);
  const [writing, setWriting] = useState(false);
  const [subject, setSubject] = useState(reSubject(firstSubject));
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setReplies(await listRequestReplies(requestId));
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Replies could not be loaded",
      );
    }
  }, [requestId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function send() {
    setBusy(true);
    setError("");
    try {
      setReplies(await sendAnotherReply(requestId, { subject, body }));
      setBody("");
      setWriting(false);
    } catch (cause) {
      setError(
        plainMessage(
          cause instanceof Error ? cause.message : "The reply was not sent",
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.replyBlock}>
      <h3>Replies sent</h3>
      {replies === null && <p role="status">Loading replies…</p>}
      {replies?.map((reply) => (
        <article className={styles.replyBlock} key={reply.id}>
          <p className={styles.emailStatus}>
            {reply.sentBy
              ? `By ${reply.sentByName ?? "staff"}`
              : "By the assistant"}{" "}
            · {formatDate(reply.createdAt)}
            {reply.status ? ` · ${statusLabels[reply.status]}` : ""}
          </p>
          <p className={styles.replySubject}>{reply.subject}</p>
          <p className={styles.replySent}>{reply.body}</p>
        </article>
      ))}
      {canEdit && !writing && (
        <div className={styles.emailActions}>
          <button
            className={styles.primaryButton}
            onClick={() => setWriting(true)}
            type="button"
          >
            Write another reply
          </button>
        </div>
      )}
      {canEdit && writing && (
        <form
          className={styles.replyForm}
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <label>
            Subject
            <input
              maxLength={300}
              onChange={(event) => setSubject(event.target.value)}
              required
              value={subject}
            />
          </label>
          <label>
            Message
            <textarea
              maxLength={5000}
              onChange={(event) => setBody(event.target.value)}
              required
              rows={10}
              value={body}
            />
          </label>
          <p className={styles.attachmentNote}>
            Henry&apos;s signature is added below the message when it is sent.
          </p>
          <div className={styles.emailActions}>
            <button
              className={styles.primaryButton}
              disabled={busy || !canSend || !subject.trim() || !body.trim()}
              type="submit"
            >
              {busy ? "Sending…" : "Send reply"}
            </button>
            <button
              className={styles.secondaryButton}
              disabled={busy}
              onClick={() => setWriting(false)}
              type="button"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
      <ErrorPopup message={error} />
    </div>
  );
}
