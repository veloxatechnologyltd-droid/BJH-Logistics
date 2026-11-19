"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  listQuoteRequests,
  listStaffNotices,
  misfiledLabel,
} from "./quoteRequestApi";
import type { QuoteRequest, RequestMailbox } from "./quoteRequestApi";
import { eventLabels, getFeed } from "../messages/messageApi";
import type { ClientMessage } from "../messages/messageApi";
import { useStaffAccess } from "../auth/useStaffAccess";
import styles from "./quotation.module.css";
import { ErrorPopup, plainMessage } from "../ErrorPopup";
import { QuoteRequestDetail } from "./requests/[requestId]/QuoteRequestDetail";
import type { DetailTab } from "./requests/[requestId]/QuoteRequestDetail";

type LoadState = "loading" | "ready" | "error";
type Tab = "person" | "received" | "drafts" | "sent" | "other";

const tabs: Array<{ key: Tab; label: string; empty: string }> = [
  {
    key: "person",
    label: "Needs a person",
    empty:
      "Inquiries the assistant could not answer from the knowledge base will appear here.",
  },
  {
    key: "received",
    label: "Inbox",
    empty: "Emails and requests from customers will appear here.",
  },
  {
    key: "drafts",
    label: "Drafts",
    empty:
      "Draft replies and draft quotes waiting for a person to check them will appear here.",
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

/** What the Sent tab lists: replies to emails, and quotes sent to customers; for inquiries, the replies to them. */
const sentEvents: Record<RequestMailbox, string[]> = {
  quotes: ["email_reply", "quote_issued", "quote_sent"],
  inquiries: ["inquiry_reply"],
};

/** Each inbox's tabs: only inquiries are escalated to a person. */
const tabsOf: Record<RequestMailbox, Tab[]> = {
  quotes: ["received", "drafts", "sent", "other"],
  inquiries: ["person", "received", "drafts", "sent", "other"],
};

/** An inquiry the assistant could not answer, still waiting for a person to reply. */
const needsPerson = (request: QuoteRequest) =>
  Boolean(request.intake?.escalation && !request.intake.reply?.sentAt);

/** A reply or a quote the assistant prepared that nobody has sent or issued yet. */
const hasDraft = (request: QuoteRequest) =>
  request.intake?.kind !== "other" &&
  Boolean(
    (request.intake?.reply && !request.intake.reply.sentAt) ||
    request.quoteStatus === "draft",
  );

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

const periods = [
  { key: "all", label: "Any time", days: 0 },
  { key: "today", label: "Today", days: 1 },
  { key: "week", label: "Last 7 days", days: 7 },
  { key: "month", label: "Last 30 days", days: 30 },
] as const;
type Period = (typeof periods)[number]["key"];

/** The earliest time a period shows (local midnight, n-1 days back); null for any time. */
function periodStart(period: Period): string | null {
  const days = periods.find((entry) => entry.key === period)!.days;
  if (!days) return null;
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (days - 1));
  return start.toISOString();
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
  request.intake?.kind === "other"
    ? "other"
    : needsPerson(request)
      ? "person"
      : "received";

const senderName = (request: QuoteRequest) =>
  request.intake?.fromName || request.contactName || request.email;

export function RequestInbox({
  mailbox = "quotes",
}: {
  mailbox?: RequestMailbox;
}) {
  const { isSuperAdmin } = useStaffAccess();
  const router = useRouter();
  const pathname = usePathname();
  const openId = useSearchParams().get("open");
  // A sent message opened in the reading pane (a request's id lives in the address).
  const [openSentId, setOpenSentId] = useState<string | null>(null);
  const [requests, setRequests] = useState<QuoteRequest[]>([]);
  const [sent, setSent] = useState<ClientMessage[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadError, setLoadError] = useState("");
  const shownTabs = tabs.filter((entry) => tabsOf[mailbox].includes(entry.key));
  const [tab, setTab] = useState<Tab>(shownTabs[0].key);
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const [period, setPeriod] = useState<Period>("all");
  const since = periodStart(period);
  const filtering = Boolean(normalizedQuery || since);
  // The signed-in person's own reminders, by request. A request whose reminder
  // has come due moves to the top until the reminder is dismissed.
  const [reminders, setReminders] = useState<Map<string, string>>(new Map());
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let active = true;
    const refresh = () => {
      setNow(Date.now());
      void listStaffNotices()
        .then(({ due, upcoming }) => {
          if (!active) return;
          const byRequest = new Map<string, string>();
          for (const notice of [...due, ...upcoming]) {
            if (notice.kind !== "reminder" || !notice.quoteRequestId) continue;
            const known = byRequest.get(notice.quoteRequestId);
            if (!known || notice.dueAt < known) {
              byRequest.set(notice.quoteRequestId, notice.dueAt);
            }
          }
          setReminders(byRequest);
        })
        // Reminders only reorder the list; the inbox works without them.
        .catch(() => undefined);
    };
    refresh();
    const timer = window.setInterval(refresh, 30_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  const reminderDue = useCallback(
    (request: QuoteRequest) => {
      const dueAt = reminders.get(request.id);
      return dueAt && Date.parse(dueAt) <= now ? dueAt : null;
    },
    [reminders, now],
  );

  const load = useCallback(
    async (quiet = false) => {
      if (!quiet) {
        setLoadState("loading");
        setLoadError("");
      }
      try {
        const [loaded, ...feeds] = await Promise.all([
          listQuoteRequests(undefined, mailbox),
          ...sentEvents[mailbox].map((event) => getFeed({ event, limit: 200 })),
        ]);
        setRequests(loaded);
        setSent(
          feeds
            .flatMap((feed) => feed.messages)
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
        );
        setLoadState("ready");
      } catch (error) {
        // A refresh after an action keeps what is on screen if it fails.
        if (quiet) return;
        setLoadError(
          error instanceof Error
            ? error.message
            : "The request inbox is unavailable",
        );
        setLoadState("error");
      }
    },
    [mailbox],
  );

  useEffect(() => {
    void load();
  }, [load]);

  // Something changed inside the reading pane: update its row and the counts.
  const onOpenedChanged = useCallback(
    (next: QuoteRequest) => {
      setRequests((previous) =>
        previous.map((request) =>
          request.id === next.id ? { ...request, ...next } : request,
        ),
      );
      void load(true);
    },
    [load],
  );

  const byTab = useMemo(() => {
    const received = (request: QuoteRequest) =>
      request.intake?.receivedAt ?? request.createdAt;
    const newestFirst = (a: string, b: string) => b.localeCompare(a);
    // Due reminders first (the earliest due on top), then newest first.
    const order = (a: QuoteRequest, b: QuoteRequest) => {
      const dueA = reminderDue(a);
      const dueB = reminderDue(b);
      if (dueA && dueB) return dueA.localeCompare(dueB);
      if (dueA) return -1;
      if (dueB) return 1;
      return newestFirst(received(a), received(b));
    };
    const of = (key: Tab) =>
      requests.filter((request) => tabOf(request) === key).sort(order);
    return {
      person: of("person"),
      received: of("received"),
      other: of("other"),
      drafts: requests.filter((request) => hasDraft(request)).sort(order),
    };
  }, [requests, reminderDue]);

  const counts = { ...byTab, sent };

  const shownSent = useMemo(() => {
    const inPeriod = since
      ? sent.filter((message) => message.createdAt >= since)
      : sent;
    if (!normalizedQuery) return inPeriod;
    return inPeriod.filter((message) =>
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
  }, [sent, normalizedQuery, since]);

  const shown = useMemo(() => {
    if (tab === "sent") return [];
    const list = since
      ? byTab[tab].filter(
          (request) =>
            (request.intake?.receivedAt ?? request.createdAt) >= since,
        )
      : byTab[tab];
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
  }, [byTab, tab, normalizedQuery, since]);

  const openRequest = openId
    ? (requests.find((request) => request.id === openId) ?? null)
    : null;
  const openSent = openSentId
    ? (sent.find((message) => message.id === openSentId) ?? null)
    : null;
  const readerOpen = tab === "sent" ? openSent !== null : openId !== null;
  const rowHref = (request: QuoteRequest) => `${pathname}?open=${request.id}`;
  const closeReader = () => {
    setOpenSentId(null);
    if (openId) router.replace(pathname, { scroll: false });
  };
  function changeTab(next: Tab) {
    setTab(next);
    closeReader();
  }
  // In Drafts, open on what is waiting: the reply, else the quote.
  const readerTab: DetailTab =
    tab === "drafts"
      ? openRequest?.intake?.reply && !openRequest.intake.reply.sentAt
        ? "reply"
        : "details"
      : "email";

  const newCount = byTab.received.filter(
    (request) => request.intake && !request.intake.reviewedAt,
  ).length;
  const current = shownTabs.find((entry) => entry.key === tab)!;

  return (
    <section
      className={`${styles.inbox}${readerOpen ? ` ${styles.inboxReading}` : ""}`}
      aria-labelledby="inbox-title"
    >
      <div className={styles.inboxHeader}>
        <div>
          <h2 id="inbox-title">
            {mailbox === "inquiries" ? "Inquiry inbox" : "Request inbox"}
          </h2>
          <p>
            {mailbox === "inquiries"
              ? "Every question to BJH's inquiries address and what was sent back."
              : "Every email to BJH and what was sent back."}
            {mailbox === "inquiries" && byTab.person.length > 0
              ? ` ${byTab.person.length} need a person.`
              : newCount > 0 && ` ${newCount} new to check.`}
          </p>
        </div>
        <div className={styles.inboxActions}>
          {isSuperAdmin && mailbox === "quotes" && (
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
            {shownTabs.map((entry) => (
              <button
                aria-selected={tab === entry.key}
                className={`${styles.inboxTab}${tab === entry.key ? ` ${styles.inboxTabActive}` : ""}`}
                key={entry.key}
                onClick={() => changeTab(entry.key)}
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
            <select
              aria-label="Show emails from"
              onChange={(event) => setPeriod(event.target.value as Period)}
              value={period}
            >
              {periods.map((entry) => (
                <option key={entry.key} value={entry.key}>
                  {entry.label}
                </option>
              ))}
            </select>
          </div>

          <div
            className={`${styles.split}${readerOpen ? ` ${styles.splitOpen}` : ""}`}
          >
            <div className={styles.splitList}>
              {tab === "sent" && shownSent.length > 0 ? (
                <ul className={styles.requestList}>
                  {shownSent.map((message) => (
                    <SentRow
                      key={message.id}
                      message={message}
                      onOpen={() => setOpenSentId(message.id)}
                      selected={message.id === openSentId}
                    />
                  ))}
                </ul>
              ) : tab !== "sent" && shown.length > 0 ? (
                <ul className={styles.requestList}>
                  {shown.map((request) => (
                    <ReceivedRow
                      href={rowHref(request)}
                      key={request.id}
                      reminderDue={reminderDue(request) !== null}
                      request={request}
                      selected={request.id === openId}
                    />
                  ))}
                </ul>
              ) : (
                <div className={styles.emptyState}>
                  {filtering ? (
                    <>
                      <h3>Nothing matches</h3>
                      <p>
                        {normalizedQuery
                          ? "Try another name, address or phrase, or a longer period."
                          : "Nothing in this period. Try a longer one."}
                      </p>
                      <button
                        onClick={() => {
                          setQuery("");
                          setPeriod("all");
                        }}
                        type="button"
                      >
                        Clear filters
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
            </div>

            <div className={styles.splitReader}>
              {readerOpen ? (
                <>
                  <button
                    className={styles.readerBack}
                    onClick={closeReader}
                    type="button"
                  >
                    <span aria-hidden="true">←</span> Back to {current.label}
                  </button>
                  {tab === "sent" && openSent ? (
                    <SentMessageView message={openSent} />
                  ) : (
                    <QuoteRequestDetail
                      embedded
                      initialTab={readerTab}
                      key={openId}
                      onChanged={onOpenedChanged}
                      requestId={openId!}
                    />
                  )}
                </>
              ) : (
                <div className={styles.readerEmpty}>
                  <span className={styles.emptyIcon} aria-hidden="true">
                    ✉
                  </span>
                  <h3>
                    {tab === "sent"
                      ? "Select a sent message to read it"
                      : "Select an email to read it"}
                  </h3>
                  <p>
                    The email, its draft reply and its draft quote open here,
                    each on its own tab.
                  </p>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </section>
  );
}

function ReceivedRow({
  request,
  reminderDue,
  selected,
  href,
}: {
  request: QuoteRequest;
  reminderDue: boolean;
  selected: boolean;
  href: string;
}) {
  const intake = request.intake;
  const isNew = Boolean(intake && !intake.reviewedAt);
  const name = senderName(request);
  const reply = intake?.reply ?? null;
  return (
    <li>
      <Link
        aria-current={selected ? "true" : undefined}
        className={`${styles.requestRow}${isNew ? ` ${styles.requestRowNew}` : ""}${selected ? ` ${styles.requestRowSelected}` : ""}`}
        href={href}
        scroll={false}
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
            {reminderDue && (
              <span className={styles.pillNew}>Reminder due</span>
            )}
            {isNew && <span className={styles.pillNew}>New</span>}
            {needsPerson(request) && (
              <span className={styles.pillNew}>Needs a person</span>
            )}
            {misfiledLabel(request) && (
              <span className={styles.pillNew}>{misfiledLabel(request)}</span>
            )}
            {request.quoteStatus === "draft" && (
              <span className={styles.pillDraft}>Draft quote</span>
            )}
            {reply && !reply.sentAt && (
              <span className={styles.pillDraft}>Draft reply</span>
            )}
            {reply?.sentAt && <span className={styles.pill}>Replied</span>}
            {request.quoteStatus === "issued" && (
              <span className={styles.pill}>Quote issued</span>
            )}
            {intake && !intake.kind && (
              <span className={styles.pill}>Not sorted</span>
            )}
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

const sentTo = (message: ClientMessage) => {
  const first = message.deliveries[0];
  return first?.contactName || first?.recipient || message.companyName;
};

const sentByAssistant = (message: ClientMessage) =>
  (message.event === "email_reply" || message.event === "inquiry_reply") &&
  !message.createdBy;

/** One message BJH sent: a reply to an email, or a quote. A click opens it in the reading pane. */
function SentRow({
  message,
  selected,
  onOpen,
}: {
  message: ClientMessage;
  selected: boolean;
  onOpen: () => void;
}) {
  const notDelivered = message.deliveries.filter(
    (delivery) => delivery.status !== "sent",
  );
  return (
    <li>
      <button
        aria-pressed={selected}
        className={`${styles.requestRow} ${styles.sentRow}${selected ? ` ${styles.requestRowSelected}` : ""}`}
        onClick={onOpen}
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
            <strong>To {sentTo(message)}</strong>
            <span>{message.companyName}</span>
          </span>
          <span className={styles.rowSubject}>{message.subject}</span>
          <span className={styles.messagePreview}>{message.body}</span>
          <span className={styles.rowPills}>
            <span className={styles.pillNew}>
              {eventLabels[message.event] ?? message.event}
            </span>
            {sentByAssistant(message) && (
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
    </li>
  );
}

/** A sent message as it went out, in the reading pane. */
function SentMessageView({ message }: { message: ClientMessage }) {
  return (
    <article className={styles.requestDetail}>
      <header className={styles.readerHeader}>
        <div className={styles.readerTitle}>
          <h2>{message.subject}</h2>
          <p>
            <strong>Sent to {sentTo(message)}</strong> ·{" "}
            {new Date(message.createdAt).toLocaleString("en-GB", {
              timeZone: "Africa/Accra",
              dateStyle: "medium",
              timeStyle: "short",
            })}
            {sentByAssistant(message) ? ", by the assistant" : ""}
          </p>
        </div>
      </header>
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
          <dt>Type</dt>
          <dd>{eventLabels[message.event] ?? message.event}</dd>
        </dl>
        <p className={styles.sentMessageBody}>{message.body}</p>
        {message.linkUrl && (
          <a href={message.linkUrl} rel="noreferrer" target="_blank">
            Open the link the customer received{" "}
            <span aria-hidden="true">→</span>
          </a>
        )}
      </div>
    </article>
  );
}
