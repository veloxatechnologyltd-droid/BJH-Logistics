"use client";

import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { ErrorPopup } from "../ErrorPopup";
import jobStyles from "../jobs/jobs.module.css";
import chat from "../chat/chat.module.css";
import {
  askHelper,
  confirmAction,
  deleteConversation,
  helperStatus,
  listConversations,
  openConversation,
} from "./assistantApi";
import type {
  ConversationSummary,
  HelperLine,
  ProposedAction,
} from "./assistantApi";
import styles from "./helper.module.css";

const examples = [
  "What needs my attention today?",
  "Which jobs are on hold?",
  "Remind me tomorrow at 9:00 about the latest quote request",
];

/**
 * Bra Evans, the staff helper: a chat with past conversations in a sidebar.
 * It looks things up at once and proposes any change as a card, which
 * happens only when you confirm it. Conversations are kept on the server,
 * private to each person.
 */
export function Helper() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [lines, setLines] = useState<HelperLine[]>([]);
  const [proposals, setProposals] = useState<ProposedAction[]>([]);
  const [question, setQuestion] = useState("");
  const [thinking, setThinking] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [error, setError] = useState("");
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    helperStatus()
      .then((status) => setEnabled(status.enabled))
      .catch(() => setEnabled(false));
    listConversations()
      .then(setConversations)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [lines.length, proposals.length, thinking]);

  function startNew() {
    setCurrentId(null);
    setLines([]);
    setProposals([]);
    setQuestion("");
    setError("");
  }

  async function open(id: string) {
    if (thinking || id === currentId) return;
    setError("");
    try {
      const conversation = await openConversation(id);
      setCurrentId(conversation.id);
      setLines(conversation.lines);
      setProposals([]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not open");
    }
  }

  async function remove(id: string) {
    setError("");
    try {
      await deleteConversation(id);
      setConversations((current) => current.filter((item) => item.id !== id));
      setConfirmDelete(null);
      if (id === currentId) startNew();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not delete");
    }
  }

  async function ask(event?: FormEvent, text = question) {
    event?.preventDefault();
    const asked = text.trim();
    if (!asked || thinking) return;
    setThinking(true);
    setError("");
    setQuestion("");
    setProposals([]);
    setLines((current) => [...current, { kind: "you", text: asked }]);
    try {
      const turn = await askHelper(currentId, asked);
      setCurrentId(turn.conversationId);
      setLines((current) => [...current, { kind: "helper", text: turn.reply }]);
      setProposals(turn.proposals);
      setConversations((current) => [
        {
          id: turn.conversationId,
          title: turn.title,
          updatedAt: new Date().toISOString(),
        },
        ...current.filter((item) => item.id !== turn.conversationId),
      ]);
    } catch (cause) {
      // The question was not kept; put it back so it can be sent again.
      setLines((current) => current.slice(0, -1));
      setQuestion(asked);
      setError(cause instanceof Error ? cause.message : "Bra Evans failed");
    } finally {
      setThinking(false);
    }
  }

  async function confirm(action: ProposedAction) {
    setError("");
    try {
      const result = await confirmAction(currentId, action);
      setProposals((current) =>
        current.filter((item) => item.id !== action.id),
      );
      setLines((current) => [
        ...current,
        { kind: "done", text: result.summary },
      ]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That did not work");
    }
  }

  if (enabled === false) {
    return (
      <main className={jobStyles.page}>
        <h1 className={jobStyles.title}>Bra Evans</h1>
        <p className={jobStyles.muted}>
          Bra Evans is not set up: it needs an Anthropic key on the API.
        </p>
      </main>
    );
  }

  return (
    <main className={styles.shell}>
      <ErrorPopup message={error} />
      <aside className={styles.sidebar} aria-label="Your chats">
        <button className={styles.newChat} onClick={startNew} type="button">
          + New chat
        </button>
        <p className={styles.sidebarHeading}>Previous chats</p>
        {conversations.length === 0 && (
          <p className={styles.sidebarEmpty}>Your chats will show here.</p>
        )}
        <ul className={styles.history}>
          {conversations.map((item) => (
            <li
              className={
                item.id === currentId
                  ? `${styles.historyItem} ${styles.historyActive}`
                  : styles.historyItem
              }
              key={item.id}
            >
              {confirmDelete === item.id ? (
                <div className={styles.deleteConfirm}>
                  <span>Delete this chat?</span>
                  <button onClick={() => void remove(item.id)} type="button">
                    Delete
                  </button>
                  <button onClick={() => setConfirmDelete(null)} type="button">
                    Keep
                  </button>
                </div>
              ) : (
                <>
                  <button
                    className={styles.historyOpen}
                    onClick={() => void open(item.id)}
                    title={item.title}
                    type="button"
                  >
                    {item.title}
                  </button>
                  <button
                    aria-label={`Delete chat: ${item.title}`}
                    className={styles.historyDelete}
                    onClick={() => setConfirmDelete(item.id)}
                    type="button"
                  >
                    ×
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      </aside>

      <section className={styles.main} aria-label="Conversation with Bra Evans">
        <header className={styles.mainHeader}>
          <h1 className={styles.name}>Bra Evans</h1>
          {(lines.length > 0 || currentId) && (
            <button
              className={chat.secondary}
              disabled={thinking}
              onClick={startNew}
              type="button"
            >
              Clear conversation
            </button>
          )}
        </header>
        <div className={styles.messages} aria-live="polite">
          {lines.length === 0 && (
            <div className={styles.welcome}>
              <h2>Hi, I&apos;m Bra Evans. How can I help?</h2>
              <p className={chat.empty}>
                Ask in plain words. Anything that changes the system comes back
                as a card for you to confirm.
              </p>
              <div className={styles.examples}>
                {examples.map((example) => (
                  <button
                    className={styles.example}
                    disabled={enabled === null}
                    key={example}
                    onClick={() => void ask(undefined, example)}
                    type="button"
                  >
                    {example}
                  </button>
                ))}
              </div>
            </div>
          )}
          {lines.map((line, index) =>
            line.kind === "done" ? (
              <p className={styles.done} key={index}>
                Done: {line.text}
              </p>
            ) : (
              <article
                className={
                  line.kind === "you"
                    ? `${chat.bubble} ${chat.mine}`
                    : `${chat.bubble} ${chat.theirs}`
                }
                key={index}
              >
                <p className={chat.body}>{line.text}</p>
              </article>
            ),
          )}
          {thinking && (
            <p className={styles.thinking}>Bra Evans is thinking…</p>
          )}
          {proposals.map((action) => (
            <article className={styles.proposal} key={action.id}>
              <p className={styles.proposalLabel}>Waiting for your go-ahead</p>
              <p className={chat.body}>{action.summary}</p>
              <div className={chat.replyActions}>
                <button
                  className={chat.secondary}
                  onClick={() =>
                    setProposals((current) =>
                      current.filter((item) => item.id !== action.id),
                    )
                  }
                  type="button"
                >
                  Dismiss
                </button>
                <button
                  className={chat.send}
                  onClick={() => void confirm(action)}
                  type="button"
                >
                  Confirm
                </button>
              </div>
            </article>
          ))}
          <div ref={end} />
        </div>
        <form className={styles.composer} onSubmit={(event) => void ask(event)}>
          <textarea
            aria-label="Message Bra Evans"
            maxLength={4000}
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void ask();
              }
            }}
            placeholder="Message Bra Evans…"
            rows={2}
            value={question}
          />
          <button
            className={chat.send}
            disabled={thinking || !question.trim() || enabled === null}
            type="submit"
          >
            Send
          </button>
        </form>
      </section>
    </main>
  );
}
