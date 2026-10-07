"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useStaffAccess } from "../auth/useStaffAccess";
import { serviceLineLabels } from "../jobs/jobApi";
import styles from "../jobs/jobs.module.css";
import { listQuotes } from "./quoteApi";
import type { QuoteSummary } from "./quoteApi";
import { ErrorPopup } from "../ErrorPopup";

export function QuoteList() {
  const { roles } = useStaffAccess();
  const [quotes, setQuotes] = useState<QuoteSummary[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    listQuotes()
      .then((result) => {
        if (active) {
          setQuotes(result);
          setState("ready");
        }
      })
      .catch((cause: unknown) => {
        if (active) {
          setError(
            cause instanceof Error ? cause.message : "Quotes are unavailable",
          );
          setState("error");
        }
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Quotes</h1>
        </div>
        {roles.length > 0 && (
          <Link className={styles.primaryLink} href="/quotes/new">
            Prepare a quote
          </Link>
        )}
      </header>

      {state === "loading" && <p role="status">Loading quotes…</p>}
      <ErrorPopup message={error} />
      {state === "ready" &&
        (quotes.length === 0 ? (
          <p className={styles.muted}>No quotes yet.</p>
        ) : (
          <div className={styles.tableScroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">Quote</th>
                  <th scope="col">Customer</th>
                  <th scope="col">Service</th>
                  <th scope="col">Title</th>
                  <th scope="col">Latest version</th>
                </tr>
              </thead>
              <tbody>
                {quotes.map((quote) => (
                  <tr key={quote.id}>
                    <th scope="row">
                      <Link
                        className={styles.link}
                        href={`/quotes/${quote.id}`}
                      >
                        {quote.quoteNumber ?? "Draft (not numbered)"}
                      </Link>
                    </th>
                    <td>{quote.customerCompanyName}</td>
                    <td>{serviceLineLabels[quote.serviceLine]}</td>
                    <td>{quote.title}</td>
                    <td>
                      <span className={styles.badge}>
                        v{quote.latestVersionNumber} ·{" "}
                        {quote.latestStatus === "issued" ? "Issued" : "Draft"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
    </main>
  );
}
