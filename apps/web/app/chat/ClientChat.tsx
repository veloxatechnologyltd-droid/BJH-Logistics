"use client";

import { useCallback, useEffect, useState } from "react";
import { listCustomers } from "../customers/customerApi";
import type { CustomerCompany } from "../customers/customerApi";
import { draftClientMessage } from "../messages/messageApi";
import { ErrorPopup } from "../ErrorPopup";
import jobStyles from "../jobs/jobs.module.css";
import { Conversation } from "./Conversation";
import { getConversation, listChatThreads, replyToClient } from "./chatApi";
import type { ChatThread, Conversation as Thread } from "./chatApi";
import styles from "./chat.module.css";

const refreshEveryMs = 30_000;

/** Customer service's conversations with clients, newest first. */
export function ClientChat() {
  const [threads, setThreads] = useState<ChatThread[] | null>(null);
  const [customers, setCustomers] = useState<CustomerCompany[]>([]);
  const [selected, setSelected] = useState("");
  const [thread, setThread] = useState<Thread | null>(null);
  const [draft, setDraft] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [error, setError] = useState("");

  const loadThreads = useCallback(async () => {
    try {
      setThreads(await listChatThreads());
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Conversations are unavailable",
      );
    }
  }, []);

  const loadThread = useCallback(async (companyId: string) => {
    try {
      setThread(await getConversation(companyId));
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "The conversation failed",
      );
    }
  }, []);

  useEffect(() => {
    void loadThreads();
    listCustomers("")
      .then(setCustomers)
      .catch(() => undefined);
  }, [loadThreads]);

  useEffect(() => {
    if (!selected) return;
    void loadThread(selected).then(loadThreads);
    const timer = window.setInterval(
      () => void loadThread(selected),
      refreshEveryMs,
    );
    return () => window.clearInterval(timer);
  }, [selected, loadThread, loadThreads]);

  async function send(body: string) {
    setError("");
    try {
      await replyToClient(selected, body);
      await loadThread(selected);
      await loadThreads();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Sending failed");
      throw cause;
    }
  }

  // The AI turns a short note ("tell them the vessel is delayed to Friday")
  // into a message; the person reads it and presses Send.
  async function draftWithAi() {
    if (!draft.trim()) {
      setError("Type what the message should say, then press Draft with AI");
      return;
    }
    setDrafting(true);
    setError("");
    try {
      const drafted = await draftClientMessage(draft.trim());
      setDraft(drafted.body);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Drafting failed");
    } finally {
      setDrafting(false);
    }
  }

  const withThread = new Set((threads ?? []).map((item) => item.companyId));

  return (
    <main className={`${jobStyles.page} ${jobStyles.pageWide}`}>
      <header className={jobStyles.header}>
        <h1 className={jobStyles.title}>Client chat</h1>
      </header>
      <ErrorPopup message={error} />
      <div className={styles.layout}>
        <div>
          <div className={styles.start}>
            <label>
              Start or open a conversation
              <select
                onChange={(event) => setSelected(event.target.value)}
                value={withThread.has(selected) ? "" : selected}
              >
                <option value="">Choose a client</option>
                {customers.map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.companyName}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {threads === null && <p role="status">Loading conversations…</p>}
          {threads?.length === 0 && (
            <p className={jobStyles.muted}>No conversations yet.</p>
          )}
          {threads && threads.length > 0 && (
            <ul className={styles.threads}>
              {threads.map((item) => (
                <li key={item.companyId}>
                  <button
                    aria-current={item.companyId === selected}
                    className={`${styles.thread}${
                      item.companyId === selected
                        ? ` ${styles.threadActive}`
                        : ""
                    }`}
                    onClick={() => setSelected(item.companyId)}
                    type="button"
                  >
                    <span className={styles.threadName}>
                      {item.companyName}
                      {item.unread > 0 && (
                        <span className={styles.unread}>{item.unread}</span>
                      )}
                    </span>
                    <span className={styles.threadPreview}>
                      {item.lastDirection === "to_client" ? "You: " : ""}
                      {item.lastBody}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <section className={styles.panel} aria-label="Conversation">
          {!selected || !thread ? (
            <p className={styles.empty}>
              Choose a conversation, or pick a client to start one.
            </p>
          ) : (
            <>
              <h2>{thread.company.companyName}</h2>
              <Conversation
                draft={draft}
                extraActions={
                  <button
                    className={styles.secondary}
                    disabled={drafting}
                    onClick={() => void draftWithAi()}
                    type="button"
                  >
                    {drafting ? "Drafting…" : "Draft with AI"}
                  </button>
                }
                messages={thread.messages}
                mine="to_client"
                onSend={send}
                setDraft={setDraft}
                theirName={thread.company.companyName}
              />
            </>
          )}
        </section>
      </div>
    </main>
  );
}
