import { useEffect, useState } from "react";
import type { Campaign, CampaignRun } from "./campaignApi";
import { campaignAbout, searchStepsFor, stepsDone } from "./campaignView";
import ui from "../jobs/jobs.module.css";
import own from "./campaigns.module.css";

type Props = {
  campaign: Campaign;
  run: CampaignRun;
  busy: boolean;
  onCancel: () => void;
  /** Called once a search that finished has been shown reaching its last step. */
  onFinished?: () => void;
};

/** How long one step is shown as working, so a step that took a moment is still seen. */
const STEP_MS = 800;
/** How long the finished pipeline stays before the results replace it. */
const HOLD_MS = 1100;

/**
 * While a search runs this is the whole page: the pipeline and nothing else. The
 * steps shown are the steps the search really took; when the page learns of several
 * at once (a step can take less than the time between two checks) it ticks them off
 * one after the other rather than jumping.
 */
export function SearchProgress({
  campaign,
  run,
  busy,
  onCancel,
  onFinished,
}: Props) {
  const steps = searchStepsFor(campaign);
  const done = stepsDone(run, steps);
  // Opened mid-search, it starts where the search is; it only animates what comes next.
  const [shown, setShown] = useState(done);
  const total = steps.length;
  const qualifyingAt = steps.findIndex((step) => step.key === "qualifying");
  const over = run.status === "ready";

  useEffect(() => {
    if (shown >= done) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const timer = setTimeout(() => setShown(shown + 1), still ? 0 : STEP_MS);
    return () => clearTimeout(timer);
  }, [shown, done]);

  useEffect(() => {
    if (!over || shown < total || !onFinished) return;
    const timer = setTimeout(onFinished, HOLD_MS);
    return () => clearTimeout(timer);
  }, [over, shown, total, onFinished]);

  const status =
    shown < 0
      ? "Waiting to start…"
      : shown < total
        ? `${steps[shown].label}…`
        : "All done";

  return (
    <section className={own.progress} aria-label="Search progress">
      <h1 className={own.progressTitle}>{campaign.name}</h1>
      <p className={own.progressAbout}>{campaignAbout(campaign)}</p>

      <ol className={own.pipeline} aria-label="Steps of the search">
        {steps.map((step, index) => {
          const state =
            index < shown
              ? own.nodeDone
              : index === shown
                ? own.nodeNow
                : own.nodeWaiting;
          return (
            <li
              aria-current={index === shown ? "step" : undefined}
              className={`${own.node} ${state}`}
              key={step.key}
            >
              <span className={own.nodeDot} aria-hidden="true">
                {index < shown ? "✓" : index + 1}
              </span>
              <span className={own.nodeLabel}>{step.label}</span>
              {index === 0 && shown > 0 && (
                <span className={own.nodeNote}>{run.foundCount} found</span>
              )}
              {index === qualifyingAt && shown > qualifyingAt && (
                <span className={own.nodeNote}>
                  {run.qualifiedCount} qualify
                </span>
              )}
            </li>
          );
        })}
      </ol>

      <p className={own.progressStatus} role="status">
        {status}
      </p>
      {!over && (
        <>
          <p className={own.progressHint}>
            You can leave this page. The search keeps going.
          </p>
          <div className={ui.formActions}>
            <button
              className={ui.secondaryButton}
              disabled={busy}
              onClick={onCancel}
              type="button"
            >
              Cancel the search
            </button>
          </div>
        </>
      )}
    </section>
  );
}
