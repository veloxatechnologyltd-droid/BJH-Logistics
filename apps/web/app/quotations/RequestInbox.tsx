"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { listQuoteRequests } from "./quoteRequestApi";
import type { QuoteRequest } from "./quoteRequestApi";
import { useStaffAccess } from "../auth/useStaffAccess";
import styles from "./quotation.module.css";
import { ErrorPopup, plainMessage } from "../ErrorPopup";

type LoadState = "loading" | "ready" | "error";

export function RequestInbox() {
  const { isSuperAdmin } = useStaffAccess();
  const [requests, setRequests] = useState<QuoteRequest[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadError, setLoadError] = useState("");
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLocaleLowerCase();

  const load = useCallback(async () => {
    setLoadState("loading");
    setLoadError("");
    try {
      setRequests(await listQuoteRequests());
      setLoadState("ready");
    } catch (error) {
      setLoadError(
        error instanceof Error
          ? error.message
          : "The request inbox is unavailable",
      );
      setLoadState("error");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filteredRequests = useMemo(() => {
    if (!normalizedQuery) {
      return requests;
    }

    return requests.filter((request) =>
      [
        request.companyName,
        request.contactName,
        request.email,
        request.message,
      ].some((value) => value.toLocaleLowerCase().includes(normalizedQuery)),
    );
  }, [normalizedQuery, requests]);

  return (
    <section className={styles.inbox} aria-labelledby="inbox-title">
      <div className={styles.inboxHeader}>
        <div>
          <p className={styles.sectionEyebrow}>LOCAL REQUEST INBOX</p>
          <h2 id="inbox-title">Request inbox</h2>
          <p>Review submitted quote requests.</p>
        </div>
        <div className={styles.inboxActions}>
          {isSuperAdmin && (
            <Link
              className={styles.composerLink}
              href="/quotations/new-request"
            >
              New request <span aria-hidden="true">→</span>
            </Link>
          )}
          <span className={styles.sampleCount}>
            {requests.length} {requests.length === 1 ? "request" : "requests"}
          </span>
        </div>
      </div>

      {loadState === "loading" && (
        <div className={styles.statePanel} role="status" aria-live="polite">
          <span className={styles.spinner} aria-hidden="true" />
          <h3>Loading requests</h3>
        </div>
      )}

      {loadState === "error" && (
        <div className={styles.errorPanel}>
          <ErrorPopup message={loadError} />
          <span className={styles.errorIcon} aria-hidden="true">
            !
          </span>
          <div>
            <h3>Requests could not be loaded</h3>
            <p>{plainMessage(loadError)}</p>
            <button
              className={styles.secondaryButton}
              onClick={() => void load()}
              type="button"
            >
              Try again
            </button>
          </div>
        </div>
      )}

      {loadState === "ready" && requests.length === 0 && (
        <div className={styles.emptyState}>
          <span className={styles.emptyIcon} aria-hidden="true">
            ◷
          </span>
          <h3>No requests yet</h3>
          <p>New quote requests will appear here.</p>
        </div>
      )}

      {loadState === "ready" && requests.length > 0 && (
        <>
          <label className={styles.searchLabel} htmlFor="request-search">
            Search requests
          </label>
          <div className={styles.searchRow}>
            <span aria-hidden="true">⌕</span>
            <input
              autoComplete="off"
              id="request-search"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Company, contact, or request text"
              type="search"
              value={query}
            />
            {query && (
              <button onClick={() => setQuery("")} type="button">
                Clear
              </button>
            )}
          </div>
          <p className={styles.resultSummary} role="status" aria-live="polite">
            Showing {filteredRequests.length} of {requests.length}
            {requests.length === 1 ? " request" : " requests"}
          </p>

          {filteredRequests.length > 0 ? (
            <ul className={styles.requestList}>
              {filteredRequests.map((request) => (
                <li key={request.id}>
                  <Link
                    className={styles.requestRow}
                    href={`/quotations/requests/${request.id}`}
                  >
                    <span className={styles.requestMark} aria-hidden="true">
                      Q
                    </span>
                    <span className={styles.requestMain}>
                      <span className={styles.requestTag}>
                        {request.customerCompanyName
                          ? `Linked · ${request.customerCompanyName}`
                          : "Unlinked request"}
                      </span>
                      <strong>{request.companyName}</strong>
                      <span className={styles.messagePreview}>
                        {request.message}
                      </span>
                    </span>
                    <span className={styles.requestContact}>
                      <strong>{request.contactName}</strong>
                      <span>{request.email}</span>
                    </span>
                    <span className={styles.rowAction}>
                      View request <span aria-hidden="true">→</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <div className={styles.emptyState}>
              <h3>No requests match</h3>
              <p>Try another company, contact, or request phrase.</p>
              <button onClick={() => setQuery("")} type="button">
                Clear search
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
