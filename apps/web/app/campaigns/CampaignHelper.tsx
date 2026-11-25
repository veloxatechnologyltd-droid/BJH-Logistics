"use client";

import { useId, useState } from "react";
import type { FormEvent } from "react";
import { ErrorPopup } from "../ErrorPopup";
import { draftCampaign } from "./campaignApi";
import type { DraftedCampaign } from "./campaignApi";
import ui from "../jobs/jobs.module.css";
import own from "./campaigns.module.css";

type Props = {
  /** The AI's filled-in campaign; the form below takes it and the person checks it. */
  onDraft: (campaign: DraftedCampaign, assumptions: string[]) => void;
};

/**
 * Describe what you want and the AI fills in the form below, asking up to three short
 * questions first when something important is missing. It never saves a campaign or
 * starts a search.
 */
export function CampaignHelper({ onDraft }: Props) {
  const fieldId = useId();
  const [description, setDescription] = useState("");
  const [questions, setQuestions] = useState<string[]>([]);
  const [answers, setAnswers] = useState<string[]>([]);
  const [assumptions, setAssumptions] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const asking = questions.length > 0;
  const ready = asking
    ? answers.every((answer) => answer.trim())
    : description.trim().length >= 5;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await draftCampaign(
        description.trim(),
        asking
          ? questions.map((question, index) => ({
              question,
              answer: answers[index].trim(),
            }))
          : [],
      );
      if (result.status === "questions") {
        setQuestions(result.questions);
        setAnswers(result.questions.map(() => ""));
        setAssumptions(null);
      } else {
        setQuestions([]);
        setAnswers([]);
        setAssumptions(result.assumptions);
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

  return (
    <form className={ui.form} onSubmit={submit}>
      <ErrorPopup message={error} />
      <fieldset className={own.fieldset}>
        <legend>Let the AI fill it in</legend>
        <div className={ui.field}>
          <label htmlFor={fieldId}>What do you want to achieve?</label>
          <textarea
            id={fieldId}
            maxLength={4000}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="For example: Find rice importers in Accra who ship in containers. We want to offer them sea freight."
            readOnly={asking}
            rows={3}
            value={description}
          />
        </div>
        {asking &&
          questions.map((question, index) => (
            <div className={ui.field} key={question}>
              <label htmlFor={`${fieldId}-${index}`}>{question}</label>
              <input
                id={`${fieldId}-${index}`}
                maxLength={1000}
                onChange={(event) =>
                  setAnswers((all) =>
                    all.map((answer, at) =>
                      at === index ? event.target.value : answer,
                    ),
                  )
                }
                value={answers[index] ?? ""}
              />
            </div>
          ))}
        <div className={`${ui.formActions} ${own.helperActions}`}>
          <button
            className={ui.secondaryButton}
            disabled={busy || !ready}
            type="submit"
          >
            {busy ? "Working…" : asking ? "Continue" : "Fill in the campaign"}
          </button>
        </div>
        {assumptions && (
          <div className={own.help} role="status">
            <p>
              The form below is filled in. Check it, change anything, then press
              Find businesses. Nothing has been saved or searched yet.
            </p>
            {assumptions.length > 0 && (
              <ul>
                {assumptions.map((assumption) => (
                  <li key={assumption}>{assumption}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </fieldset>
    </form>
  );
}
