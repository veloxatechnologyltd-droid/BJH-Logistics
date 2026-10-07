"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { AuthStatus } from "../auth/AuthStatus";
import { useStaffAccess } from "../auth/useStaffAccess";
import {
  createPortalQuoteRequest,
  listQuoteRequests,
} from "../quotations/quoteRequestApi";
import type { QuoteRequest } from "../quotations/quoteRequestApi";
import styles from "../jobs/jobs.module.css";
import { ErrorPopup } from "../ErrorPopup";

/** A customer's home: their jobs and quotes, and a form to ask for a quote. */
export function PortalHome() {
  const { status, isCustomer, companies } = useStaffAccess();
  const [requests, setRequests] = useState<QuoteRequest[] | null>(null);
  const [contactName, setContactName] = useState("");
  const [message, setMessage] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    try {
      setRequests(await listQuoteRequests());
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
    }
  }

  return (
    <>
      <header className="topbar">
        <div className="breadcrumb">
          <span>Portal</span>
          <span aria-hidden="true">/</span>
          <strong>Overview</strong>
        </div>
        <div className="topbar-actions">
          <AuthStatus />
        </div>
      </header>
      <main className={styles.page}>
        <header className={styles.header}>
          <div>
            <h1 className={styles.title}>
              {companies.map((item) => item.companyName).join(", ") ||
                "Your account"}
            </h1>
          </div>
        </header>

        {status === "ready" && !isCustomer && (
          <p className={styles.muted}>
            This page is for customer accounts.{" "}
            <Link href="/">Go to the staff workspace</Link>.
          </p>
        )}

        {isCustomer && (
          <>
            <section className={styles.card} aria-labelledby="portal-links">
              <h2 id="portal-links">Your records</h2>
              <div className={styles.actions}>
                <Link className={styles.primaryLink} href="/jobs">
                  Your jobs
                </Link>
                <Link className={styles.primaryLink} href="/quotes">
                  Your quotations
                </Link>
              </div>
            </section>

            <section className={styles.card} aria-labelledby="request-title">
              <h2 id="request-title">Ask for a quotation</h2>
              <ErrorPopup message={error} />
              {notice && <p className={styles.notice}>{notice}</p>}
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
                    required
                    rows={5}
                    value={message}
                  />
                </label>
                <button className={styles.button} type="submit">
                  Send request
                </button>
              </form>
            </section>

            <section className={styles.card} aria-labelledby="sent-title">
              <h2 id="sent-title">Your requests</h2>
              {requests && requests.length === 0 && (
                <p className={styles.muted}>No requests sent yet.</p>
              )}
              {requests && requests.length > 0 && (
                <ul className={styles.list}>
                  {requests.map((item) => (
                    <li key={item.id}>
                      {new Date(item.createdAt).toLocaleDateString()} ·{" "}
                      {item.message.length > 120
                        ? `${item.message.slice(0, 120)}…`
                        : item.message}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </main>
    </>
  );
}
