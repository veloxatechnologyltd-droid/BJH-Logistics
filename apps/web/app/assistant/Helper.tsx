"use client";

import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { ErrorPopup } from "../ErrorPopup";
import jobStyles from "../jobs/jobs.module.css";
import chat from "../chat/chat.module.css";
import { askHelper, confirmAction, helperStatus } from "./assistantApi";
import type { HelperMessage, ProposedAction } from "./assistantApi";
import styles from "./helper.module.css";

type Line =
  | { kind: "you"; text: string }
  | { kind: "helper"; text: string }
  | { kind: "done"; text: string };

const examples = [
  "What needs my attention today?",
  "Which jobs are on hold?",
  "Remind me tomorrow at 9:00 about the latest quote request",
];

/**
 * The staff helper: ask in plain words; it looks things up at once and
 * proposes any change as a card, which happens only when you confirm it.
 */
export function Helper() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [history, setHistory] = useState<HelperMessage[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  const [proposals, setProposals] = useState<ProposedAction[]>([]);
  // Actions confirmed since the last question, so the helper hears about them.
  const [doneSince, setDoneSince] = useState<string[]>([]);
  const [question, setQuestion] = useState("");
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState("");
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    helperStatus()
      .then((status) => setEnabled(status.enabled))
      .catch(() => setEnabled(false));
  }, []);

  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [lines.length, proposals.length]);

  async function ask(event?: FormEvent, text = question) {
    event?.preventDefault();
    const asked = text.trim();
    if (!asked || thinking) return;
    const content = doneSince.length
      ? `(Confirmed and done since my last message: ${doneSince.join("; ")})\n\n${asked}`
      : asked;
    setThinking(true);
    setError("");
    setQuestion("");
    setProposals([]);
    setLines((current) => [...current, { kind: "you", text: asked }]);
    try {
      const turn = await askHelper([...history, { role: "user", content }]);
      setHistory(turn.messages);
      setDoneSince([]);
      setLines((current) => [
        ...current,
        { kind: "helper", text: turn.reply || "Done." },
      ]);
      setProposals(turn.proposals);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The helper failed");
    } finally {
      setThinking(false);
    }
  }

  async function confirm(action: ProposedAction) {
    setError("");
    try {
      const result = await confirmAction(action);
      setProposals((current) =>
        current.filter((item) => item.id !== action.id),
      );
      setDoneSince((current) => [...current, result.summary]);
      setLines((current) => [
        ...current,
        { kind: "done", text: `Done: ${result.summary}` },
      ]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That did not work");
    }
  }

  if (enabled === false) {
    return (
      <main className={jobStyles.page}>
        <h1 className={jobStyles.title}>AI helper</h1>
        <p className={jobStyles.muted}>
          The AI helper is not set up: it needs an Anthropic key on the API.
        </p>
      </main>
    );
  }

  return (
    <main className={jobStyles.page}>
      <header className={jobStyles.header}>
        <h1 className={jobStyles.title}>AI helper</h1>
        {history.length > 0 && (
          <button
            className={chat.secondary}
            onClick={() => {
              setHistory([]);
              setLines([]);
              setProposals([]);
              setDoneSince([]);
            }}
            type="button"
          >
            New conversation
          </button>
        )}
      </header>
      <ErrorPopup message={error} />
      <section className={chat.panel} aria-label="Conversation with the helper">
        <div className={chat.messages} aria-live="polite">
          {lines.length === 0 && (
            <div className={styles.examples}>
              <p className={chat.empty}>
                Ask in plain words. Anything that changes the system comes back
                as a card for you to confirm.
              </p>
              {examples.map((example) => (
                <button
                  className={styles.example}
                  key={example}
                  onClick={() => void ask(undefined, example)}
                  type="button"
                >
                  {example}
                </button>
              ))}
            </div>
          )}
          {lines.map((line, index) => (
            <article
              className={
                line.kind === "you"
                  ? `${chat.bubble} ${chat.mine}`
                  : line.kind === "done"
                    ? styles.done
                    : `${chat.bubble} ${chat.theirs}`
              }
              key={index}
            >
              <p className={chat.body}>{line.text}</p>
            </article>
          ))}
          {thinking && <p className={chat.empty}>Working on it…</p>}
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
        <form className={chat.reply} onSubmit={(event) => void ask(event)}>
          <label className={chat.replyLabel}>
            Ask the helper
            <textarea
              maxLength={4000}
              onChange={(event) => setQuestion(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void ask();
                }
              }}
              rows={2}
              value={question}
            />
          </label>
          <div className={chat.replyActions}>
            <button
              className={chat.send}
              disabled={thinking || !question.trim() || enabled === null}
              type="submit"
            >
              Ask
            </button>
          </div>
        </form>
      </section>
    </main>
  );
}
