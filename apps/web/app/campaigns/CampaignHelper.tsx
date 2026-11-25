"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import { ErrorPopup } from "../ErrorPopup";
import { draftCampaign } from "./campaignApi";
import type { DraftedCampaign } from "./campaignApi";
import ui from "../jobs/jobs.module.css";
import own from "./campaigns.module.css";

type Props = {
  /** The AI's filled-in campaign; the form takes it and the person checks it. */
  onDraft: (campaign: DraftedCampaign, assumptions: string[]) => void;
  /** Offers a way to the empty form, shown until the form is on screen. */
  onFillByHand?: () => void;
  /** Throws the chat away and starts again. */
  onStartAgain?: () => void;
};

type Message = { from: "ai" | "you"; text: string; lines?: string[] };

/** What the AI reads from a request. Only the first two are essential. */
const expected = [
  "The kind of business or product, for example “shops that sell glass items”",
  "Where, a town and country, for example “Accra, Ghana”",
  "How many businesses, up to 500",
  "What you want to offer them, for example “freight forwarding”",
  "Anyone to leave out, and whether to write a first email for each (optional)",
];

/**
 * A chat: describe what you want and the AI fills in the campaign form, asking up to
 * three short questions first when something essential is missing. It never saves a
 * campaign or starts a search.
 */
export function CampaignHelper({ onDraft, onFillByHand, onStartAgain }: Props) {
  const fieldId = useId();
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState("");
  /** Set while the AI waits for answers: the first request and what it asked. */
  const [asked, setAsked] = useState<{
    description: string;
    questions: string[];
  } | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    end.current?.scrollIntoView?.({ block: "nearest" });
  }, [messages, busy]);

  const ready = text.trim().length >= (asked ? 1 : 5);

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    if (busy || !ready) return;
    const sent = text.trim();
    setBusy(true);
    setError("");
    try {
      const result = asked
        ? await draftCampaign(asked.description, [
            {
              question: asked.questions.join(" ").slice(0, 300),
              answer: sent,
            },
          ])
        : await draftCampaign(sent, []);
      const description = asked ? asked.description : sent;
      const mine: Message = { from: "you", text: sent };
      setText("");
      if (result.status === "questions") {
        setAsked({ description, questions: result.questions });
        setMessages((all) => [
          ...all,
          mine,
          {
            from: "ai",
            text: "I need a little more first:",
            lines: result.questions,
          },
        ]);
      } else {
        setAsked(null);
        setDone(true);
        setMessages((all) => [
          ...all,
          mine,
          {
            from: "ai",
            text: "I have filled in the campaign below. Nothing has been saved or searched yet.",
            lines: result.assumptions,
          },
        ]);
        onDraft(result.campaign, result.assumptions);
      }
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "The AI could not fill it in",
      );
    } finally {
      setBusy(false);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends; Shift+Enter starts a new line.
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submit();
    }
  }

  return (
    <section aria-label="Campaign assistant" className={own.chat}>
      <ErrorPopup message={error} />
      <div aria-live="polite" className={own.chatLog} role="log">
        <div className={`${own.bubble} ${own.bubbleAi}`}>
          <p>
            Tell me who you want to find and I will fill in the campaign for you
            to check. Mention what you can:
          </p>
          <ul>
            {expected.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
        {messages.map((message, index) => (
          <div
            className={`${own.bubble} ${
              message.from === "you" ? own.bubbleYou : own.bubbleAi
            }`}
            key={index}
          >
            <p>{message.text}</p>
            {message.lines && message.lines.length > 0 && (
              <ul>
                {message.lines.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            )}
          </div>
        ))}
        {busy && (
          <div className={`${own.bubble} ${own.bubbleAi}`}>
            <p>{asked ? "Filling it in…" : "Reading your request…"}</p>
          </div>
        )}
        <div ref={end} />
      </div>

      {done ? (
        <div className={`${ui.formActions} ${own.helperActions}`}>
          <button
            className={ui.secondaryButton}
            onClick={onStartAgain}
            type="button"
          >
            Start again
          </button>
        </div>
      ) : (
        <form className={own.composer} onSubmit={submit}>
          <label className={own.srOnly} htmlFor={fieldId}>
            {asked ? "Your answer" : "What do you want to achieve?"}
          </label>
          <textarea
            id={fieldId}
            maxLength={asked ? 1000 : 4000}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder={
              asked
                ? "Type your answer…"
                : "For example: We want to generate 300 leads in Accra, Ghana, from businesses that sell glass items. We want to offer them our freight forwarding service."
            }
            rows={3}
            value={text}
          />
          <div className={own.composerActions}>
            {onFillByHand && !asked && (
              <button
                className={own.linkButton}
                onClick={onFillByHand}
                type="button"
              >
                Fill in the form by hand instead
              </button>
            )}
            <button
              className={ui.button}
              disabled={busy || !ready}
              type="submit"
            >
              {busy
                ? "Working…"
                : asked
                  ? "Send answer"
                  : "Fill in the campaign"}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
