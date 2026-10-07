"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { listCustomers } from "../customers/customerApi";
import type { CustomerCompany } from "../customers/customerApi";
import styles from "../jobs/jobs.module.css";
import { channelLabels, eventLabels, getFeed } from "./messageApi";
import type { Feed, MessageDelivery } from "./messageApi";
import { ErrorPopup } from "../ErrorPopup";

function summarise(deliveries: MessageDelivery[]) {
  const counts = new Map<string, number>();
  for (const delivery of deliveries) {
    counts.set(delivery.status, (counts.get(delivery.status) ?? 0) + 1);
  }
  return ["sent", "pending", "failed", "skipped"]
    .filter((status) => counts.has(status))
    .map((status) => `${counts.get(status)} ${status}`)
    .join(" · ");
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

/** Everything sent to clients, from every job and from the Messages page. */
export function SentMessages() {
  const [feed, setFeed] = useState<Feed | null>(null);
  const [companies, setCompanies] = useState<CustomerCompany[]>([]);
  const [companyId, setCompanyId] = useState("");
  const [event, setEvent] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    listCustomers("")
      .then(setCompanies)
      .catch(() => setCompanies([]));
  }, []);

  useEffect(() => {
    let active = true;
    setError("");
    getFeed({ companyId, event })
      .then((result) => {
        if (active) setFeed(result);
      })
      .catch((cause: unknown) => {
        if (active)
          setError(
            cause instanceof Error ? cause.message : "Messages are unavailable",
          );
      });
    return () => {
      active = false;
    };
  }, [companyId, event]);

  return (
    <>
      <div className={styles.toolbar}>
        <label className={styles.field}>
          Client
          <select
            onChange={(changed) => setCompanyId(changed.target.value)}
            value={companyId}
          >
            <option value="">All clients</option>
            {companies.map((company) => (
              <option key={company.id} value={company.id}>
                {company.companyName}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          Kind
          <select
            onChange={(changed) => setEvent(changed.target.value)}
            value={event}
          >
            <option value="">All kinds</option>
            {Object.entries(eventLabels).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <ErrorPopup message={error} />
      {!feed && !error && <p role="status">Loading messages…</p>}
      {feed && (
        <>
          <p className={styles.muted}>Sent by {channelLabels[feed.channels]}</p>
          {feed.messages.length === 0 ? (
            <p className={styles.muted}>No messages yet.</p>
          ) : (
            <div className={styles.messageList}>
              {feed.messages.map((item) => (
                <details className={styles.messageItem} key={item.id}>
                  <summary>
                    <span className={styles.messageMain}>
                      <strong>{item.subject}</strong>
                      <span>
                        {item.companyName}
                        {item.fileNumber ? ` · ${item.fileNumber}` : ""} ·{" "}
                        {formatDate(item.createdAt)}
                      </span>
                    </span>
                    <span className={styles.badge}>
                      {eventLabels[item.event] ?? item.event}
                    </span>
                    <span className={styles.messageStatus}>
                      {summarise(item.deliveries) || "No recipients"}
                    </span>
                  </summary>
                  <div className={styles.messageBody}>
                    <p>{item.body}</p>
                    {item.deliveries.length > 0 && (
                      <ul className={styles.list}>
                        {item.deliveries.map((delivery) => (
                          <li key={delivery.id}>
                            {delivery.contactName ?? "Contact"} ·{" "}
                            {delivery.channel === "sms" ? "SMS" : "Email"}
                            {delivery.recipient
                              ? ` (${delivery.recipient})`
                              : ""}{" "}
                            — {delivery.status}
                            {delivery.lastError
                              ? `: ${delivery.lastError}`
                              : ""}
                          </li>
                        ))}
                      </ul>
                    )}
                    {item.jobId && (
                      <Link
                        className={styles.link}
                        href={`/jobs/${item.jobId}/messages`}
                      >
                        Open the job
                      </Link>
                    )}
                  </div>
                </details>
              ))}
            </div>
          )}
        </>
      )}
    </>
  );
}
