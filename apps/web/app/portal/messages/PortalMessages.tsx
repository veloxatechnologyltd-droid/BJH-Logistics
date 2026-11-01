"use client";

import { useCallback, useEffect, useState } from "react";
import { Conversation } from "../../chat/Conversation";
import { getMyConversation, writeToBjh } from "../../chat/chatApi";
import type { Conversation as Thread } from "../../chat/chatApi";
import { ErrorPopup } from "../../ErrorPopup";
import jobStyles from "../../jobs/jobs.module.css";
import styles from "../../chat/chat.module.css";

const refreshEveryMs = 30_000;

/** The client's conversation with BJH's customer service. */
export function PortalMessages() {
  const [thread, setThread] = useState<Thread | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setThread(await getMyConversation());
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Messages could not be loaded",
      );
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), refreshEveryMs);
    return () => window.clearInterval(timer);
  }, [load]);

  async function send(body: string) {
    setError("");
    try {
      await writeToBjh(body);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Sending failed");
      throw cause;
    }
  }

  return (
    <main className={jobStyles.page}>
      <header className={jobStyles.header}>
        <h1 className={jobStyles.title}>Messages</h1>
      </header>
      <ErrorPopup message={error} />
      <section className={styles.panel} aria-label="Conversation with BJH">
        {thread === null ? (
          <p role="status">Loading messages…</p>
        ) : (
          <Conversation
            draft={draft}
            messages={thread.messages}
            mine="from_client"
            onSend={send}
            setDraft={setDraft}
            theirName="BJH Logistics"
          />
        )}
      </section>
    </main>
  );
}
