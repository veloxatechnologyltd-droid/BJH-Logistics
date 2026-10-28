"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { listQuoteRequests } from "./quoteRequestApi";
import type { QuoteRequest } from "./quoteRequestApi";
import { useStaffAccess } from "../auth/useStaffAccess";
import styles from "./quotation.module.css";
import { ErrorPopup, plainMessage } from "../ErrorPopup";

type LoadState = "loading" | "ready" | "error";
type Tab = "received" | "sent" | "other";

const tabs: Array<{ key: Tab; label: string; empty: string }> = [
  {
    key: "received",
    label: "Received",
    empty: "Emails and requests from customers will appear here.",
  },
  {
    key: "sent",
    label: "Sent",
    empty: "Replies sent to customers will appear here.",
  },
  {
    key: "other",
    label: "Not requests",
    empty: "Newsletters, notices and adverts the assistant set aside.",
  },
];

const kindLabels = { quote: "Quote request", inquiry: "Question" } as const;

/** Email bodies carry quote marks, links and line breaks; a row shows plain words. */
function preview(text: string): string {
  return text
    .replace(/\[?https?:\/\/\S+\]?/g, "")
    .replace(/[▎>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function shortTime(iso: string): string {
  const date = new Date(iso);
  const zone = { timeZone: "Africa/Accra" };
  const day = (value: Date) =>
    value.toLocaleDateString("en-GB", { ...zone, dateStyle: "short" });
  if (day(date) === day(new Date())) {
    return date.toLocaleTimeString("en-GB", {
      ...zone,
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  const sameYear =
    date.toLocaleDateString("en-GB", { ...zone, year: "numeric" }) ===
    new Date().toLocaleDateString("en-GB", { ...zone, year: "numeric" });
  return date.toLocaleDateString("en-GB", {
    ...zone,
    day: "numeric",
    month: "short",
    year: sameYear ? undefined : "numeric",
  });
}

function initials(name: string): string {
  const letters = name
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("");
  return letters || "?";
}

const tabOf = (request: QuoteRequest): Tab =>
  request.intake?.kind === "other" ? "other" : "received";

const senderName = (request: QuoteRequest) =>
  request.intake?.fromName || request.contactName || request.email;

/** Where the request stands, in a few words; the first is the most urgent. */
function receivedPills(request: QuoteRequest): string[] {
  const intake = request.intake;
  const pills: string[] = [];
  if (!intake) pills.push("Web request");
  else if (intake.kind && intake.kind !== "other")
    pills.push(kindLabels[intake.kind]);
  else if (!intake.kind) pills.push("Not sorted");
  if (request.quoteStatus === "issued") pills.push("Quote issued");
  else if (request.quoteStatus === "draft") pills.push("Quote drafted");
  if (intake?.reply?.sentAt) pills.push("Replied");
  else if (intake?.reply) pills.push("Reply ready");
  return pills;
}

export function RequestInbox() {
  const { isSuperAdmin } = useStaffAccess();
  const [requests, setRequests] = useState<QuoteRequest[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadError, setLoadError] = useState("");
  const [tab, setTab] = useState<Tab>("received");
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

  const byTab = useMemo(() => {
    const received = (request: QuoteRequest) =>
      request.intake?.receivedAt ?? request.createdAt;
    const newestFirst = (a: string, b: string) => b.localeCompare(a);
    return {
      received: requests
        .filter((request) => tabOf(request) === "received")
        .sort((a, b) => newestFirst(received(a), received(b))),
      sent: requests
        .filter((request) => request.intake?.reply?.sentAt)
        .sort((a, b) =>
          newestFirst(a.intake!.reply!.sentAt!, b.intake!.reply!.sentAt!),
        ),
      other: requests
        .filter((request) => tabOf(request) === "other")
        .sort((a, b) => newestFirst(received(a), received(b))),
    };
  }, [requests]);

  const shown = useMemo(() => {
    const list = byTab[tab];
    if (!normalizedQuery) return list;
    return list.filter((request) =>
      [
        request.companyName,
        request.contactName,
        request.email,
        request.message,
        request.customerCompanyName ?? "",
        request.intake?.subject ?? "",
        request.intake?.fromName ?? "",
        request.intake?.reply?.subject ?? "",
      ].some((value) => value.toLocaleLowerCase().includes(normalizedQuery)),
    );
  }, [byTab, tab, normalizedQuery]);

  const newCount = byTab.received.filter(
    (request) => request.intake && !request.intake.reviewedAt,
  ).length;
  const current = tabs.find((entry) => entry.key === tab)!;

  return (
    <section className={styles.inbox} aria-labelledby="inbox-title">
      <div className={styles.inboxHeader}>
        <div>
          <h2 id="inbox-title">Request inbox</h2>
          <p>
            Every email to BJH and what was sent back.
            {newCount > 0 && ` ${newCount} new to check.`}
          </p>
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

      {loadState === "ready" && (
        <>
          <div className={styles.inboxTabs} role="tablist">
            {tabs.map((entry) => (
              <button
                aria-selected={tab === entry.key}
                className={`${styles.inboxTab}${tab === entry.key ? ` ${styles.inboxTabActive}` : ""}`}
                key={entry.key}
                onClick={() => setTab(entry.key)}
                role="tab"
                type="button"
              >
                {entry.label}
                <span className={styles.inboxTabCount}>
                  {byTab[entry.key].length}
                </span>
              </button>
            ))}
          </div>

          <div className={styles.searchRow}>
            <span aria-hidden="true">⌕</span>
            <input
              aria-label={`Search ${current.label.toLowerCase()}`}
              autoComplete="off"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by sender, subject, customer or text"
              type="search"
              value={query}
            />
            {query && (
              <button onClick={() => setQuery("")} type="button">
                Clear
              </button>
            )}
          </div>

          {shown.length > 0 ? (
            <ul className={styles.requestList}>
              {shown.map((request) =>
                tab === "sent" ? (
                  <SentRow key={request.id} request={request} />
                ) : (
                  <ReceivedRow key={request.id} request={request} />
                ),
              )}
            </ul>
          ) : (
            <div className={styles.emptyState}>
              {normalizedQuery ? (
                <>
                  <h3>Nothing matches</h3>
                  <p>Try another name, address or phrase.</p>
                  <button onClick={() => setQuery("")} type="button">
                    Clear search
                  </button>
                </>
              ) : (
                <>
                  <span className={styles.emptyIcon} aria-hidden="true">
                    ◷
                  </span>
                  <h3>Nothing here yet</h3>
                  <p>{current.empty}</p>
                </>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}

function ReceivedRow({ request }: { request: QuoteRequest }) {
  const intake = request.intake;
  const isNew = Boolean(intake && !intake.reviewedAt);
  const name = senderName(request);
  return (
    <li>
      <Link
        className={`${styles.requestRow}${isNew ? ` ${styles.requestRowNew}` : ""}`}
        href={`/quotations/requests/${request.id}`}
      >
        <span className={styles.requestMark} aria-hidden="true">
          {initials(name)}
        </span>
        <span className={styles.requestMain}>
          <span className={styles.rowFrom}>
            <strong>{name}</strong>
            <span>{intake?.fromEmail ?? request.email}</span>
          </span>
          <span className={styles.rowSubject}>
            {intake?.subject || request.companyName}
          </span>
          <span className={styles.messagePreview}>
            {preview(request.message)}
          </span>
          <span className={styles.rowPills}>
            {isNew && <span className={styles.pillNew}>New</span>}
            {receivedPills(request).map((pill) => (
              <span className={styles.pill} key={pill}>
                {pill}
              </span>
            ))}
            <span className={styles.rowCustomer}>
              {request.customerCompanyName ?? "No customer linked"}
            </span>
          </span>
        </span>
        <time
          className={styles.rowTime}
          dateTime={intake?.receivedAt ?? request.createdAt}
        >
          {shortTime(intake?.receivedAt ?? request.createdAt)}
        </time>
      </Link>
    </li>
  );
}

function SentRow({ request }: { request: QuoteRequest }) {
  const reply = request.intake!.reply!;
  const name = senderName(request);
  return (
    <li>
      <Link
        className={styles.requestRow}
        href={`/quotations/requests/${request.id}`}
      >
        <span className={styles.requestMark} aria-hidden="true">
          {initials(name)}
        </span>
        <span className={styles.requestMain}>
          <span className={styles.rowFrom}>
            <strong>To {name}</strong>
            <span>{request.intake!.fromEmail}</span>
          </span>
          <span className={styles.rowSubject}>{reply.subject}</span>
          <span className={styles.messagePreview}>{preview(reply.body)}</span>
          <span className={styles.rowPills}>
            <span className={styles.pill}>
              {reply.sentByAssistant
                ? "Sent by the assistant"
                : "Sent by staff"}
            </span>
            <span className={styles.rowCustomer}>
              {request.customerCompanyName ?? "No customer linked"}
            </span>
          </span>
        </span>
        <time className={styles.rowTime} dateTime={reply.sentAt!}>
          {shortTime(reply.sentAt!)}
        </time>
      </Link>
    </li>
  );
}
