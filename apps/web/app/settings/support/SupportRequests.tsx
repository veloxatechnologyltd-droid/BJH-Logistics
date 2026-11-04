"use client";

import { useEffect, useState } from "react";
import { ErrorPopup } from "../../ErrorPopup";
import {
  kindLabels,
  listAllSupportRequests,
  replyAsSupport,
  setSupportStatus,
  statusLabels,
} from "../../support/supportApi";
import type { SupportRequest, SupportStatus } from "../../support/supportApi";
import { SupportThread } from "../../support/SupportThread";
import styles from "./supportRequests.module.css";

const formatDate = (value: string) =>
  new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));

type Filter = "open" | "all";

/** Every problem, feature request and question sent with Get help (super admin). */
export function SupportRequests() {
  const [requests, setRequests] = useState<SupportRequest[] | null>(null);
  const [filter, setFilter] = useState<Filter>("open");
  const [error, setError] = useState("");

  useEffect(() => {
    listAllSupportRequests()
      .then(setRequests)
      .catch((cause: unknown) =>
        setError(
          cause instanceof Error
            ? cause.message
            : "Support requests could not be loaded",
        ),
      );
  }, []);

  async function change(id: string, status: SupportStatus) {
    setError("");
    try {
      const updated = await setSupportStatus(id, status);
      setRequests((current) =>
        (current ?? []).map((item) => (item.id === id ? updated : item)),
      );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "The status was not saved",
      );
    }
  }

  async function reply(id: string, body: string) {
    const updated = await replyAsSupport(id, body);
    setRequests((current) =>
      (current ?? []).map((item) => (item.id === id ? updated : item)),
    );
  }

  const shown = (requests ?? []).filter(
    (item) => filter === "all" || item.status !== "done",
  );

  return (
    <main className="dashboard">
      <section className="welcome-row" aria-labelledby="support-title">
        <div>
          <h1 id="support-title">Support requests</h1>
          <p className="welcome-copy">
            Problems, feature requests and questions sent with Get help by staff
            and customers. Reply to answer; the person is emailed and sees your
            reply under Get help.
          </p>
        </div>
      </section>
      <ErrorPopup message={error} />
      <section className="work-panel">
        <label className={styles.filter}>
          Show
          <select
            onChange={(event) => setFilter(event.target.value as Filter)}
            value={filter}
          >
            <option value="open">Not done yet</option>
            <option value="all">All</option>
          </select>
        </label>
        {requests === null && !error && <p role="status">Loading…</p>}
        {requests !== null && shown.length === 0 && (
          <p>Nothing here. New requests appear as soon as they are sent.</p>
        )}
        <ul className={styles.list}>
          {shown.map((item) => (
            <li className={styles.item} key={item.id}>
              <div className={styles.head}>
                <strong>{kindLabels[item.kind]}</strong>
                <span className={styles.meta}>
                  {item.reporterName ?? "Unknown"} ·{" "}
                  {item.reporterKind === "customer"
                    ? `Customer${item.companyName ? `, ${item.companyName}` : ""}`
                    : "Staff"}{" "}
                  · {formatDate(item.createdAt)}
                </span>
                <label className={styles.status}>
                  <select
                    aria-label="Status"
                    onChange={(event) =>
                      void change(item.id, event.target.value as SupportStatus)
                    }
                    value={item.status}
                  >
                    {(Object.keys(statusLabels) as SupportStatus[]).map(
                      (value) => (
                        <option key={value} value={value}>
                          {statusLabels[value]}
                        </option>
                      ),
                    )}
                  </select>
                </label>
              </div>
              <p className={styles.body}>{item.description}</p>
              <dl className={styles.details}>
                <dt>Page</dt>
                <dd>{item.pagePath ?? "Not given"}</dd>
                {item.lastError && (
                  <>
                    <dt>Last error</dt>
                    <dd>{item.lastError}</dd>
                  </>
                )}
                <dt>Browser</dt>
                <dd>{item.userAgent ?? "Not given"}</dd>
              </dl>
              <SupportThread
                messages={item.messages}
                nameFor={(message) =>
                  message.authorRole === "support"
                    ? `${message.authorName ?? "Support"} (support)`
                    : (item.reporterName ?? "Unknown")
                }
                onSend={(body) => reply(item.id, body)}
                sendLabel="Send reply"
              />
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
