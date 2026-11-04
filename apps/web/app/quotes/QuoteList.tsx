"use client";

import Link from "next/link";
import { Fragment, useEffect, useMemo, useState } from "react";
import { canWorkQuotes } from "../auth/roleAccess";
import { useStaffAccess } from "../auth/useStaffAccess";
import cards from "../finance/finance.module.css";
import { serviceLineLabels } from "../jobs/jobApi";
import styles from "../jobs/jobs.module.css";
import { listQuotes } from "./quoteApi";
import type { QuoteSummary } from "./quoteApi";
import { ErrorPopup } from "../ErrorPopup";

type Filter = "all" | QuoteSummary["latestStatus"];

const filters: Array<[Filter, string]> = [
  ["all", "All quotes"],
  ["draft", "Drafts"],
  ["issued", "Issued"],
];

export function QuoteList() {
  const { roles } = useStaffAccess();
  const [quotes, setQuotes] = useState<QuoteSummary[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [opened, setOpened] = useState<Set<string>>(new Set());

  const shown = useMemo(() => {
    const text = search.trim().toLowerCase();
    return quotes.filter(
      (quote) =>
        (filter === "all" || quote.latestStatus === filter) &&
        (!text ||
          [
            quote.customerCompanyName,
            quote.quoteNumber ?? "",
            quote.title,
            serviceLineLabels[quote.serviceLine],
          ]
            .join(" ")
            .toLowerCase()
            .includes(text)),
    );
  }, [quotes, search, filter]);
  // One row per client, newest quote first; the quotes show when it is opened.
  const groups = useMemo(() => {
    const byClient = new Map<string, QuoteSummary[]>();
    for (const quote of shown) {
      byClient.set(quote.customerCompanyId, [
        ...(byClient.get(quote.customerCompanyId) ?? []),
        quote,
      ]);
    }
    return [...byClient.values()];
  }, [shown]);
  // Searching, or a single client, shows the quotes straight away.
  const openAll = groups.length === 1 || search.trim() !== "";
  const toggleClient = (id: string) =>
    setOpened((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

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
        {canWorkQuotes(roles) && (
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
          <>
            <div className={cards.filters}>
              <label className={styles.field}>
                Search
                <input
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Client, quote number or title"
                  type="search"
                  value={search}
                />
              </label>
              <label className={styles.field}>
                Show
                <select
                  onChange={(event) => setFilter(event.target.value as Filter)}
                  value={filter}
                >
                  {filters.map(([key, label]) => (
                    <option key={key} value={key}>
                      {label} (
                      {
                        quotes.filter(
                          (quote) =>
                            key === "all" || quote.latestStatus === key,
                        ).length
                      }
                      )
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {groups.length === 0 ? (
              <p className={styles.muted}>Nothing matches these filters.</p>
            ) : (
              <div className={styles.tableScroll}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th scope="col">Client and quotes</th>
                      <th scope="col">Service</th>
                      <th scope="col">Title</th>
                      <th scope="col">Latest version</th>
                      <th scope="col">
                        <span className={cards.srOnly}>Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {groups.map((group) => {
                      const id = group[0].customerCompanyId;
                      const open = openAll || opened.has(id);
                      const drafts = group.filter(
                        (quote) => quote.latestStatus === "draft",
                      ).length;
                      return (
                        <Fragment key={id}>
                          <tr className={cards.clientRow}>
                            <td className={cards.jobCell}>
                              <button
                                aria-expanded={open}
                                className={cards.clientToggle}
                                onClick={() => toggleClient(id)}
                                type="button"
                              >
                                <span aria-hidden="true">
                                  {open ? "▾" : "▸"}
                                </span>{" "}
                                {group[0].customerCompanyName}
                              </button>
                              <span className={cards.customerName}>
                                {group.length}{" "}
                                {group.length === 1 ? "quote" : "quotes"}
                              </span>
                            </td>
                            <td />
                            <td />
                            <td>
                              {drafts > 0 && (
                                <span className={styles.badge}>
                                  {drafts} {drafts === 1 ? "draft" : "drafts"}
                                </span>
                              )}
                            </td>
                            <td />
                          </tr>
                          {open &&
                            group.map((quote) => (
                              <tr className={cards.invoiceRow} key={quote.id}>
                                <th className={cards.jobCell} scope="row">
                                  <Link
                                    className={styles.link}
                                    href={`/quotes/${quote.id}`}
                                  >
                                    {quote.quoteNumber ??
                                      "Draft (not numbered)"}
                                  </Link>
                                </th>
                                <td>{serviceLineLabels[quote.serviceLine]}</td>
                                <td>{quote.title}</td>
                                <td>
                                  <span className={styles.badge}>
                                    v{quote.latestVersionNumber} ·{" "}
                                    {quote.latestStatus === "issued"
                                      ? "Issued"
                                      : "Draft"}
                                  </span>
                                </td>
                                <td className={cards.rowActions}>
                                  {canWorkQuotes(roles) &&
                                    quote.latestStatus === "draft" && (
                                      <Link
                                        className={styles.link}
                                        href={`/quotes/${quote.id}?edit=1`}
                                      >
                                        Edit
                                      </Link>
                                    )}
                                </td>
                              </tr>
                            ))}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        ))}
    </main>
  );
}
