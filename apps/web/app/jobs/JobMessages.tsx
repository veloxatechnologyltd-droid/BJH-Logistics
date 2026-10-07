"use client";

import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { listJobNotifications, sendJobMessage } from "./jobApi";
import type { JobNotification, NotificationDelivery } from "./jobApi";
import styles from "./jobs.module.css";
import { ErrorPopup } from "../ErrorPopup";

const eventLabels: Record<string, string> = {
  milestone: "Milestone",
  eta: "Expected arrival",
  eta_reminder: "Arrival reminder",
  quote_issued: "Quotation",
  invoice_issued: "Invoice",
  payment_received: "Payment",
  delivery_dispatched: "Delivery on the way",
  delivery_delivered: "Delivered",
  message: "Message from staff",
};

const statusLabels: Record<NotificationDelivery["status"], string> = {
  pending: "waiting to send",
  sent: "sent",
  failed: "failed",
  skipped: "not sent",
};

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

/**
 * What the customer was told about this job, by email and SMS, and a form to
 * send them a message. The channels used are set by the super admin in Settings.
 */
export function JobMessages({ jobId }: { jobId: string }) {
  const [items, setItems] = useState<JobNotification[] | null>(null);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");

  const load = useCallback(async () => {
    try {
      setItems(await listJobNotifications(jobId));
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Messages could not be loaded",
      );
    }
  }, [jobId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setNotice("");
    try {
      const sent = await sendJobMessage(jobId, {
        subject: subject.trim() || undefined,
        body: body.trim(),
      });
      const queued = sent.deliveries.filter(
        (delivery) => delivery.status === "pending",
      ).length;
      setNotice(
        queued > 0
          ? `Message queued for ${queued} delivery(ies). It also appears in the correspondence log.`
          : "Nobody could be reached: check the contacts' emails and phone numbers.",
      );
      setSubject("");
      setBody("");
      setAdding(false);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The message failed");
    }
  }

  return (
    <section className={styles.card} aria-labelledby="messages-title">
      <div className={styles.stepsHeading}>
        <h2 id="messages-title">Messages to the customer</h2>
        {!adding && (
          <button
            className={styles.secondaryButton}
            onClick={() => setAdding(true)}
            type="button"
          >
            Send a message
          </button>
        )}
      </div>
      <ErrorPopup message={error} />
      {notice && <p className={styles.notice}>{notice}</p>}
      {items && items.length === 0 && (
        <p className={styles.muted}>Nothing sent yet.</p>
      )}
      {items && items.length > 0 && (
        <ul className={styles.list}>
          {items.map((item) => (
            <li key={item.id}>
              <strong>{eventLabels[item.event] ?? item.event}</strong> ·{" "}
              {formatDate(item.createdAt)} · {item.subject}
              <br />
              <span className={styles.muted}>
                {item.deliveries.length === 0
                  ? "No contact is set to receive messages."
                  : item.deliveries
                      .map(
                        (delivery) =>
                          `${delivery.contactName ?? "Contact"} by ${delivery.channel === "sms" ? "SMS" : "email"}: ${statusLabels[delivery.status]}${delivery.lastError ? ` (${delivery.lastError})` : ""}`,
                      )
                      .join(" · ")}
              </span>
            </li>
          ))}
        </ul>
      )}
      {adding && (
        <form className={styles.form} onSubmit={submit}>
          <label className={styles.field}>
            Subject (optional)
            <input
              maxLength={200}
              onChange={(event) => setSubject(event.target.value)}
              value={subject}
            />
          </label>
          <label className={styles.field}>
            Message
            <textarea
              maxLength={1500}
              onChange={(event) => setBody(event.target.value)}
              required
              rows={4}
              value={body}
            />
          </label>
          <div className={styles.formActions}>
            <button className={styles.button} type="submit">
              Send to the customer
            </button>
            <button
              className={styles.secondaryButton}
              onClick={() => setAdding(false)}
              type="button"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
