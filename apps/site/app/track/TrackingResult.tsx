"use client";

import { useEffect, useState } from "react";
import {
  formatGhanaTime,
  trackingEndpoint,
  type PublicTracking,
} from "./tracking";

type State =
  | { kind: "loading" }
  | { kind: "found"; tracking: PublicTracking }
  | { kind: "not-found" }
  | { kind: "busy" }
  | { kind: "error" };

export function TrackingResult({ number }: { number: string }) {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: "loading" });
    fetch(trackingEndpoint(number), { signal: controller.signal })
      .then(async (response) => {
        if (response.status === 404) return setState({ kind: "not-found" });
        if (response.status === 429) return setState({ kind: "busy" });
        if (!response.ok) return setState({ kind: "error" });
        setState({
          kind: "found",
          tracking: (await response.json()) as PublicTracking,
        });
      })
      .catch((error: unknown) => {
        if ((error as Error).name !== "AbortError") {
          setState({ kind: "error" });
        }
      });
    return () => controller.abort();
  }, [number]);

  if (state.kind === "loading") {
    return (
      <p className="track-message" role="status">
        Looking up your shipment…
      </p>
    );
  }
  if (state.kind === "not-found") {
    return (
      <p className="track-message" role="alert">
        We could not find that tracking number. Check it and try again. It looks
        like BJH-XXXX-XXXX.
      </p>
    );
  }
  if (state.kind === "busy") {
    return (
      <p className="track-message" role="alert">
        Too many lookups from your connection. Please wait a minute and try
        again.
      </p>
    );
  }
  if (state.kind === "error") {
    return (
      <p className="track-message" role="alert">
        Tracking is unavailable right now. Please try again shortly, or contact
        us.
      </p>
    );
  }

  const { tracking } = state;
  return (
    <div className="quote-form track-result">
      <p className="track-number">{tracking.trackingNumber}</p>
      <dl className="track-facts">
        <div>
          <dt>Service</dt>
          <dd>{tracking.service}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>{tracking.status}</dd>
        </div>
        <div>
          <dt>Expected arrival</dt>
          <dd>
            {tracking.etaAt
              ? formatGhanaTime(tracking.etaAt)
              : "Not confirmed yet"}
          </dd>
        </div>
      </dl>
      {tracking.steps.length > 0 ? (
        <ol className="track-steps">
          {tracking.steps.map((step) => (
            <li key={step.text} className={step.done ? "done" : undefined}>
              <span>{step.text}</span>
              {step.occurredAt ? (
                <small>{formatGhanaTime(step.occurredAt)}</small>
              ) : (
                <small>Not yet</small>
              )}
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}
