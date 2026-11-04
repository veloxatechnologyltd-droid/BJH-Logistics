"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import type { SupportMessage } from "./supportApi";
import styles from "./supportThread.module.css";

const formatWhen = (value: string) =>
  new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));

/**
 * The replies on a support ticket and a box to write the next one. Used by the
 * super admin's list and by the Get help dialog; each names the people its own way.
 */
export function SupportThread({
  messages,
  nameFor,
  sendLabel,
  onSend,
}: {
  messages: SupportMessage[];
  nameFor: (message: SupportMessage) => string;
  sendLabel: string;
  onSend: (body: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSending(true);
    setError("");
    try {
      await onSend(draft.trim());
      setDraft("");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Your reply was not sent",
      );
    } finally {
      setSending(false);
    }
  }

  return (
    <div>
      {messages.length > 0 && (
        <ul className={styles.thread}>
          {messages.map((message) => (
            <li
              className={`${styles.message} ${
                message.authorRole === "support" ? styles.fromSupport : ""
              }`}
              key={message.id}
            >
              <span className={styles.who}>{nameFor(message)}</span>
              <span className={styles.when}>
                {formatWhen(message.createdAt)}
              </span>
              <p className={styles.text}>{message.body}</p>
            </li>
          ))}
        </ul>
      )}
      <form className={styles.reply} onSubmit={submit}>
        <textarea
          aria-label="Your reply"
          maxLength={4000}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Write a reply…"
          required
          rows={3}
          value={draft}
        />
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        <button disabled={sending || !draft.trim()} type="submit">
          {sending ? "Sending…" : sendLabel}
        </button>
      </form>
    </div>
  );
}
