"use client";

import { useState } from "react";
import { QuoteEditor } from "../QuoteEditor";
import type { QuoteVersion } from "../quoteApi";
import { getQuoteSuggestion } from "../../quotations/quoteRequestApi";
import type { QuoteSuggestion } from "../../quotations/quoteRequestApi";
import styles from "../../jobs/jobs.module.css";

/** The suggestion in the shape the editor starts from; nothing is saved until staff save it. */
function asDraft(suggestion: QuoteSuggestion): QuoteVersion {
  return {
    ...suggestion.version,
    id: "",
    versionNumber: 0,
    status: "draft",
    issuedAt: null,
    lines: suggestion.version.lines.map((line, position) => ({
      ...line,
      id: `suggested-${position}`,
      position,
    })),
  };
}

/**
 * A new quote. For a customer request it can start from the most similar past
 * issued quote (same service; same route or destination first): its charges,
 * prices and wording, with the shipment described from the request.
 */
export function NewQuote({
  fromRequest,
}: {
  fromRequest?: { requestId: string; customerId: string };
}) {
  const [suggestion, setSuggestion] = useState<QuoteSuggestion | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState("");

  async function prefill() {
    if (!fromRequest) return;
    setState("loading");
    try {
      setSuggestion(await getQuoteSuggestion(fromRequest.requestId));
      setState("idle");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "No suggestion could be made",
      );
      setState("error");
    }
  }

  const based = suggestion?.basedOn;
  const notice = fromRequest && (
    <section className={styles.card} aria-label="Start from a past quote">
      {!suggestion && (
        <div className={styles.actions}>
          <button
            className={styles.secondaryButton}
            disabled={state === "loading"}
            onClick={() => void prefill()}
            type="button"
          >
            {state === "loading"
              ? "Finding a similar quote…"
              : "Prefill from a similar past quote"}
          </button>
          <span className={styles.muted}>
            Copies the charges and prices of the closest issued quote for this
            service, and describes the shipment from the request.
          </span>
        </div>
      )}
      {state === "error" && <p className={styles.muted}>{error}</p>}
      {suggestion && based && (
        <p className={styles.muted}>
          Prefilled from quote {based.quoteNumber ?? "(no number)"} version{" "}
          {based.versionNumber}, prepared for {based.customerCompanyName} (
          {based.match}). Check every line and price before saving; nothing is
          saved or sent until you do.
          {based.match !== "same route" &&
            " That quote was for a different route, so remove or reprice charges that belong to its route, such as haulage."}
        </p>
      )}
      {suggestion && !based && (
        <p className={styles.muted}>
          There is no issued quote for this service yet, so only the shipment
          and the usual wording were filled in. Add the charges and prices.
        </p>
      )}
    </section>
  );

  return (
    <QuoteEditor
      draft={suggestion ? asDraft(suggestion) : undefined}
      fromRequest={fromRequest}
      initialServiceLine={suggestion?.serviceLine}
      key={suggestion ? "suggested" : "blank"}
      notice={notice}
    />
  );
}
