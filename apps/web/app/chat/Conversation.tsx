"use client";

import { useEffect, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import type { ChatMessage } from "./chatApi";
import styles from "./chat.module.css";

function when(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

/**
 * A conversation and its reply box. `mine` is the direction written by the
 * person looking at it: staff write to the client, the client writes to BJH.
 */
export function Conversation({
  messages,
  mine,
  theirName,
  onSend,
  extraActions,
  draft,
  setDraft,
}: {
  messages: ChatMessage[];
  mine: ChatMessage["direction"];
  theirName: string;
  onSend: (body: string) => Promise<void>;
  extraActions?: ReactNode;
  draft: string;
  setDraft: (value: string) => void;
}) {
  const [sending, setSending] = useState(false);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!draft.trim()) return;
    setSending(true);
    try {
      await onSend(draft.trim());
      setDraft("");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className={styles.conversation}>
      <div className={styles.messages} aria-live="polite">
        {messages.length === 0 && (
          <p className={styles.empty}>No messages yet.</p>
        )}
        {messages.map((message) => (
          <article
            className={`${styles.bubble} ${
              message.direction === mine ? styles.mine : styles.theirs
            }`}
            key={message.id}
          >
            <p className={styles.body}>{message.body}</p>
            <p className={styles.meta}>
              {message.direction === mine
                ? "You"
                : message.authorName || message.emailFrom || theirName}
              {" · "}
              {when(message.createdAt)}
              {message.channel === "email" ? " · by email" : ""}
            </p>
          </article>
        ))}
        <div ref={end} />
      </div>
      <form className={styles.reply} onSubmit={(event) => void submit(event)}>
        <label className={styles.replyLabel}>
          Message
          <textarea
            maxLength={5000}
            onChange={(event) => setDraft(event.target.value)}
            rows={3}
            value={draft}
          />
        </label>
        <div className={styles.replyActions}>
          {extraActions}
          <button
            className={styles.send}
            disabled={sending || !draft.trim()}
            type="submit"
          >
            {sending ? "Sending…" : "Send"}
          </button>
        </div>
      </form>
    </div>
  );
}
