"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { listQuotes } from "../../quotes/quoteApi";
import type { QuoteSummary } from "../../quotes/quoteApi";
import { serviceLineLabels } from "../../jobs/jobApi";
import styles from "../../jobs/jobs.module.css";
import { sendQuoteToClient } from "../messageApi";
import { ErrorPopup } from "../../ErrorPopup";

/** Issued quotes, each with a button that sends the client the link again. */
export function SendQuotes() {
  const [quotes, setQuotes] = useState<QuoteSummary[] | null>(null);
  const [search, setSearch] = useState("");
  const [confirming, setConfirming] = useState("");
  const [sentIds, setSentIds] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    listQuotes()
      .then((all) => setQuotes(all.filter((q) => q.latestStatus === "issued")))
      .catch((cause: unknown) =>
        setError(
          cause instanceof Error ? cause.message : "Quotes are unavailable",
        ),
      );
  }, []);

  async function send(quote: QuoteSummary) {
    setBusy(quote.id);
    setError("");
    try {
      await sendQuoteToClient(quote.id);
      setSentIds((current) => new Set(current).add(quote.id));
      setConfirming("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Sending failed");
    } finally {
      setBusy("");
    }
  }

  const needle = search.trim().toLowerCase();
  const shown = (quotes ?? []).filter((quote) =>
    [quote.quoteNumber, quote.customerCompanyName, quote.title]
      .join(" ")
      .toLowerCase()
      .includes(needle),
  );

  return (
    <>
      <input
        aria-label="Search quotes"
        className={styles.searchInput}
        onChange={(changed) => setSearch(changed.target.value)}
        placeholder="Search by quote number or client"
        type="search"
        value={search}
      />
      <ErrorPopup message={error} />
      {!quotes && !error && <p role="status">Loading quotes…</p>}
      {quotes && shown.length === 0 && (
        <p className={styles.muted}>No issued quotes to send.</p>
      )}
      <div className={styles.messageList}>
        {shown.map((quote) => (
          <div className={styles.quoteRow} key={quote.id}>
            <span className={styles.messageMain}>
              <Link className={styles.link} href={`/quotes/${quote.id}`}>
                {quote.quoteNumber}
              </Link>
              <span>
                {quote.customerCompanyName} ·{" "}
                {serviceLineLabels[quote.serviceLine]} · {quote.title}
              </span>
            </span>
            {sentIds.has(quote.id) && (
              <span className={styles.badge}>Sent</span>
            )}
            {confirming === quote.id ? (
              <span className={styles.actions}>
                <button
                  className={styles.button}
                  disabled={busy === quote.id}
                  onClick={() => void send(quote)}
                  type="button"
                >
                  {busy === quote.id ? "Sending…" : "Send now"}
                </button>
                <button
                  className={styles.secondaryButton}
                  onClick={() => setConfirming("")}
                  type="button"
                >
                  Cancel
                </button>
              </span>
            ) : (
              <button
                className={styles.secondaryButton}
                onClick={() => setConfirming(quote.id)}
                type="button"
              >
                {sentIds.has(quote.id) ? "Send again" : "Send to client"}
              </button>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
