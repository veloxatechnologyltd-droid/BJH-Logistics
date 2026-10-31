"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useStaffAccess } from "../auth/useStaffAccess";
import {
  createPortalQuoteRequest,
  listQuoteRequests,
} from "../quotations/quoteRequestApi";
import type { QuoteRequest } from "../quotations/quoteRequestApi";
import styles from "../jobs/jobs.module.css";
import portalStyles from "./portal.module.css";
import { ErrorPopup } from "../ErrorPopup";
import { tidyMessage } from "../messageText";

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** A customer's home: their jobs and quotes, and a form to ask for a quote. */
export function PortalHome() {
  const { status, isCustomer, companies } = useStaffAccess();
  const [requests, setRequests] = useState<QuoteRequest[] | null>(null);
  const [contactName, setContactName] = useState("");
  const [message, setMessage] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    try {
      const loaded = await listQuoteRequests();
      setRequests(loaded);
      // Save the customer retyping their name: reuse the one from their last request.
      setContactName((current) => current || loaded[0]?.contactName || "");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Requests could not be loaded",
      );
    }
  }, []);

  useEffect(() => {
    if (isCustomer) void load();
  }, [isCustomer, load]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setNotice("");
    setSending(true);
    try {
      await createPortalQuoteRequest({
        contactName: contactName.trim(),
        message: message.trim(),
        companyId: companyId || undefined,
      });
      setMessage("");
      setNotice("Your request was sent. BJH will reply with a quotation.");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The request failed");
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <main className={styles.page}>
        <header className={styles.header}>
          <div>
            <h1 className={styles.title}>
              {companies.map((item) => item.companyName).join(", ") ||
                "Your account"}
            </h1>
            {isCustomer && (
              <p className={portalStyles.lede}>
                Ask for a quotation and follow your jobs and quotations.
              </p>
            )}
          </div>
          {isCustomer && (
            <nav className={styles.actions} aria-label="Your records">
              <Link className={styles.secondaryButton} href="/jobs">
                Your jobs
              </Link>
              <Link className={styles.secondaryButton} href="/quotes">
                Your quotations
              </Link>
            </nav>
          )}
        </header>

        {status === "ready" && !isCustomer && (
          <p className={styles.muted}>
            This page is for customer accounts.{" "}
            <Link href="/">Go to the staff workspace</Link>.
          </p>
        )}

        {isCustomer && (
          <div className={portalStyles.columns}>
            <section className={styles.card} aria-labelledby="request-title">
              <h2 id="request-title">Ask for a quotation</h2>
              <p className={portalStyles.hint}>
                Tell us what you ship, where from and to, and when. BJH will
                reply with a quotation.
              </p>
              <ErrorPopup message={error} />
              {notice && (
                <p className={styles.notice} role="status">
                  {notice}
                </p>
              )}
              <form className={styles.form} onSubmit={submit}>
                {companies.length > 1 && (
                  <label className={styles.field}>
                    Company
                    <select
                      onChange={(event) => setCompanyId(event.target.value)}
                      required
                      value={companyId}
                    >
                      <option value="">Choose a company</option>
                      {companies.map((item) => (
                        <option key={item.companyId} value={item.companyId}>
                          {item.companyName}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <label className={styles.field}>
                  Your name
                  <input
                    maxLength={160}
                    onChange={(event) => setContactName(event.target.value)}
                    required
                    value={contactName}
                  />
                </label>
                <label className={styles.field}>
                  What do you need quoted?
                  <textarea
                    maxLength={5000}
                    onChange={(event) => setMessage(event.target.value)}
                    placeholder="For example: sea import, 2 x 40ft containers of fabric from Shanghai to Tema, ready 15 November."
                    required
                    rows={6}
                    value={message}
                  />
                </label>
                <button
                  className={styles.button}
                  disabled={sending}
                  type="submit"
                >
                  {sending ? "Sending…" : "Send request"}
                </button>
              </form>
            </section>

            <section className={styles.card} aria-labelledby="sent-title">
              <h2 id="sent-title">Your requests</h2>
              {requests && requests.length === 0 && (
                <p className={styles.muted}>
                  No requests yet. Your requests will appear here once you send
                  one.
                </p>
              )}
              {requests && requests.length > 0 && (
                <div className={portalStyles.requests}>
                  {requests.map((item) => {
                    const text = tidyMessage(item.message);
                    const ready =
                      item.quoteStatus === "issued" && item.quoteId !== null;
                    return (
                      <details className={styles.messageItem} key={item.id}>
                        <summary>
                          <span className={portalStyles.requestMain}>
                            <span className={portalStyles.requestPreview}>
                              {text.replace(/\s+/g, " ")}
                            </span>
                            <span className={portalStyles.requestDate}>
                              Sent {formatDate(item.createdAt)}
                            </span>
                          </span>
                          <span
                            className={`${styles.badge} ${ready ? portalStyles.requestReady : ""}`}
                          >
                            {ready ? "Quotation ready" : "Received"}
                          </span>
                        </summary>
                        <div className={styles.messageBody}>
                          <p>{text}</p>
                          {ready && (
                            <div className={portalStyles.requestActions}>
                              <Link
                                className={styles.primaryLink}
                                href={`/quotes/${item.quoteId}`}
                              >
                                View quotation
                                {item.quoteNumber ? ` ${item.quoteNumber}` : ""}
                              </Link>
                            </div>
                          )}
                        </div>
                      </details>
                    );
                  })}
                </div>
              )}
            </section>
          </div>
        )}
      </main>
    </>
  );
}
