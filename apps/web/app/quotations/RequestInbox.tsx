"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { listQuoteRequests } from "./quoteRequestApi";
import type { QuoteRequest } from "./quoteRequestApi";
import { eventLabels, getFeed } from "../messages/messageApi";
import type { ClientMessage } from "../messages/messageApi";
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
    empty: "Replies and quotes sent to customers will appear here.",
  },
  {
    key: "other",
    label: "Not requests",
    empty: "Newsletters, notices and adverts the assistant set aside.",
  },
];

const kindLabels = { quote: "Quote request", inquiry: "Question" } as const;

/** What the Sent tab lists: replies to emails, and quotes sent to customers. */
const sentEvents = ["email_reply", "quote_issued", "quote_sent"] as const;

const deliveryLabels = {
  sent: "Delivered",
  pending: "Waiting to go out",
  failed: "Not delivered",
  skipped: "Not sent",
} as const;

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

/** What the email is; the quote and reply waiting on it are shown under the row. */
function receivedPills(request: QuoteRequest): string[] {
  const intake = request.intake;
  if (!intake) return ["Web request"];
  if (!intake.kind) return ["Not sorted"];
  return intake.kind === "other" ? [] : [kindLabels[intake.kind]];
}

export function RequestInbox() {
  const { isSuperAdmin } = useStaffAccess();
  const [requests, setRequests] = useState<QuoteRequest[]>([]);
  const [sent, setSent] = useState<ClientMessage[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadError, setLoadError] = useState("");
  const [tab, setTab] = useState<Tab>("received");
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLocaleLowerCase();

  const load = useCallback(async () => {
    setLoadState("loading");
    setLoadError("");
    try {
      const [loaded, ...feeds] = await Promise.all([
        listQuoteRequests(),
        ...sentEvents.map((event) => getFeed({ event, limit: 200 })),
      ]);
      setRequests(loaded);
      setSent(
        feeds
          .flatMap((feed) => feed.messages)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      );
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
      other: requests
        .filter((request) => tabOf(request) === "other")
        .sort((a, b) => newestFirst(received(a), received(b))),
    };
  }, [requests]);

  const counts = { ...byTab, sent };

  const shownSent = useMemo(() => {
    if (!normalizedQuery) return sent;
    return sent.filter((message) =>
      [
        message.companyName,
        message.subject,
        message.body,
        ...message.deliveries.map(
          (delivery) =>
            `${delivery.contactName ?? ""} ${delivery.recipient ?? ""}`,
        ),
      ].some((value) => value.toLocaleLowerCase().includes(normalizedQuery)),
    );
  }, [sent, normalizedQuery]);

  const shown = useMemo(() => {
    if (tab === "sent") return [];
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
                  {counts[entry.key].length}
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

          {tab === "sent" && shownSent.length > 0 ? (
            <ul className={styles.requestList}>
              {shownSent.map((message) => (
                <SentRow key={message.id} message={message} />
              ))}
            </ul>
          ) : tab !== "sent" && shown.length > 0 ? (
            <ul className={styles.requestList}>
              {shown.map((request) => (
                <ReceivedRow key={request.id} request={request} />
              ))}
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
  const reply = intake?.reply ?? null;
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
            <strong>From {name}</strong>
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

      {/* What is waiting on this email: the draft quote and the reply. */}
      {(request.quoteId || reply) && (
        <div className={styles.followUps}>
          {request.quoteId && (
            <div className={styles.followUp}>
              <span>
                {request.quoteStatus === "issued"
                  ? `Quote ${request.quoteNumber ?? ""} issued`
                  : "Draft quote waiting for approval"}
              </span>
              <Link href={`/quotes/${request.quoteId}`}>
                {request.quoteStatus === "issued"
                  ? "View quote"
                  : "Check, edit and issue"}{" "}
                <span aria-hidden="true">→</span>
              </Link>
            </div>
          )}
          {reply && (
            <div className={styles.followUp}>
              <span>
                {reply.sentAt
                  ? `Replied ${shortTime(reply.sentAt)}${reply.sentByAssistant ? " by the assistant" : ""}`
                  : "Reply drafted, not sent yet"}
              </span>
              <Link href={`/quotations/requests/${request.id}`}>
                {reply.sentAt ? "See the reply" : "Read, edit and send"}{" "}
                <span aria-hidden="true">→</span>
              </Link>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

/** One message BJH sent: a reply to an email, or a quote. A click opens it as it went out. */
function SentRow({ message }: { message: ClientMessage }) {
  const [open, setOpen] = useState(false);
  const first = message.deliveries[0];
  const to = first?.contactName || first?.recipient || message.companyName;
  const byAssistant = message.event === "email_reply" && !message.createdBy;
  const notDelivered = message.deliveries.filter(
    (delivery) => delivery.status !== "sent",
  );
  return (
    <li>
      <button
        aria-expanded={open}
        className={`${styles.requestRow} ${styles.sentRow}`}
        onClick={() => setOpen(!open)}
        type="button"
      >
        <span
          className={`${styles.requestMark} ${styles.sentMark}`}
          aria-hidden="true"
        >
          ↗
        </span>
        <span className={styles.requestMain}>
          <span className={styles.rowFrom}>
            <strong>Sent to {to}</strong>
            <span>{message.companyName}</span>
          </span>
          <span className={styles.rowSubject}>{message.subject}</span>
          {!open && <span className={styles.sentBody}>{message.body}</span>}
          <span className={styles.rowPills}>
            <span className={styles.pillNew}>
              {eventLabels[message.event] ?? message.event}
            </span>
            {byAssistant && (
              <span className={styles.pill}>Sent by the assistant</span>
            )}
            {message.deliveries.length > 0 && (
              <span className={styles.pill}>
                {notDelivered.length === 0
                  ? "Delivered"
                  : deliveryLabels[notDelivered[0].status]}
              </span>
            )}
          </span>
        </span>
        <time className={styles.rowTime} dateTime={message.createdAt}>
          {shortTime(message.createdAt)}
        </time>
      </button>

      {open && (
        <div className={styles.sentMessage}>
          <dl>
            <dt>To</dt>
            <dd>
              {message.deliveries
                .map(
                  (delivery) =>
                    `${delivery.contactName ? `${delivery.contactName} ` : ""}<${delivery.recipient ?? "no address"}> by ${delivery.channel}: ${deliveryLabels[delivery.status]}${delivery.lastError ? ` (${delivery.lastError})` : ""}`,
                )
                .join("; ") || message.companyName}
            </dd>
            <dt>Sent</dt>
            <dd>
              {new Date(message.createdAt).toLocaleString("en-GB", {
                timeZone: "Africa/Accra",
                dateStyle: "medium",
                timeStyle: "short",
              })}
              {byAssistant ? ", by the assistant" : ""}
            </dd>
            <dt>Subject</dt>
            <dd>{message.subject}</dd>
          </dl>
          <p className={styles.sentMessageBody}>{message.body}</p>
          {message.linkUrl && (
            <a href={message.linkUrl} rel="noreferrer" target="_blank">
              Open the link the customer received{" "}
              <span aria-hidden="true">→</span>
            </a>
          )}
        </div>
      )}
    </li>
  );
}
