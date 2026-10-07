"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { customerActiveDays } from "@bjh/contracts";
import { listCustomerInsights, listCustomers } from "./customerApi";
import type { CustomerCompany, CustomerInsight } from "./customerApi";
import { useStaffAccess } from "../auth/useStaffAccess";
import { formatMoney } from "../quotes/quoteApi";
import chart from "../finance/finance.module.css";
import ui from "../jobs/jobs.module.css";
import styles from "./customerDirectory.module.css";
import { ErrorPopup, plainMessage } from "../ErrorPopup";

type LoadState = "loading" | "ready" | "error";
type StatusFilter = "all" | "active" | "inactive";
type SortKey = "name" | "revenue" | "owing" | "lastJob";

const shortDate = (value: string | null) =>
  value
    ? new Date(value).toLocaleDateString("en-GH", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "—";

const pct = (part: number, whole: number) =>
  whole > 0 ? Math.max(0, Math.min(100, (part / whole) * 100)) : 0;

/** Whether anyone at the company is switched on to receive messages. */
const canBeMessaged = (company: CustomerCompany) =>
  company.contacts.some((contact) => contact.notify);

export function CustomerDirectory() {
  const { isSuperAdmin } = useStaffAccess();
  const [customers, setCustomers] = useState<CustomerCompany[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadError, setLoadError] = useState("");
  const [retry, setRetry] = useState(0);
  const [query, setQuery] = useState("");
  // Business figures cover every customer, whatever the search box says.
  const [allCustomers, setAllCustomers] = useState<CustomerCompany[]>([]);
  const [insights, setInsights] = useState<Map<string, CustomerInsight> | null>(
    null,
  );
  const [currency, setCurrency] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("name");

  useEffect(() => {
    listCustomerInsights()
      .then((rows) => {
        const byCompany = new Map(rows.map((row) => [row.companyId, row]));
        setInsights(byCompany);
        // Open on the currency with the most invoiced.
        const totals = new Map<string, number>();
        for (const row of rows) {
          for (const entry of row.money) {
            totals.set(
              entry.currency,
              (totals.get(entry.currency) ?? 0) + entry.invoicedMinor,
            );
          }
        }
        const first = [...totals.entries()].sort((a, b) => b[1] - a[1])[0];
        setCurrency(first?.[0] ?? "");
      })
      .catch(() => setInsights(null));
  }, []);

  const currencies = useMemo(() => {
    const totals = new Map<string, number>();
    for (const row of insights?.values() ?? []) {
      for (const entry of row.money) {
        totals.set(
          entry.currency,
          (totals.get(entry.currency) ?? 0) + entry.invoicedMinor,
        );
      }
    }
    return [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
  }, [insights]);

  const moneyOf = (companyId: string) =>
    insights
      ?.get(companyId)
      ?.money.find((entry) => entry.currency === currency);
  const money = (minor: number) => formatMoney(minor, currency);

  const totalCompanies = allCustomers.length;
  const activeCompanies = allCustomers.filter(
    (company) => insights?.get(company.id)?.active,
  ).length;
  const owingTotal = allCustomers.reduce((total, company) => {
    const entry = moneyOf(company.id);
    return total + (entry ? entry.invoicedMinor - entry.receivedMinor : 0);
  }, 0);
  const owingCustomers = allCustomers.filter((company) => {
    const entry = moneyOf(company.id);
    return entry ? entry.invoicedMinor - entry.receivedMinor > 0 : false;
  }).length;
  const quotesAwaiting = allCustomers.reduce(
    (total, company) =>
      total + (insights?.get(company.id)?.quotesAwaiting ?? 0),
    0,
  );
  const unreachable = allCustomers.filter(
    (company) => !canBeMessaged(company),
  ).length;

  const topByRevenue = allCustomers
    .map((company) => ({
      company,
      invoiced: moneyOf(company.id)?.invoicedMinor ?? 0,
      owing: moneyOf(company.id)
        ? (moneyOf(company.id)?.invoicedMinor ?? 0) -
          (moneyOf(company.id)?.receivedMinor ?? 0)
        : 0,
    }))
    .filter((row) => row.invoiced > 0)
    .sort((a, b) => b.invoiced - a.invoiced);
  const revenueTotal = topByRevenue.reduce((t, row) => t + row.invoiced, 0);
  const topFive = topByRevenue.slice(0, 5);
  const topOwing = topByRevenue
    .filter((row) => row.owing > 0)
    .sort((a, b) => b.owing - a.owing)
    .slice(0, 5);
  const topFiveTotal = topFive.reduce((t, row) => t + row.invoiced, 0);

  const rows = useMemo(() => {
    const figure = (company: CustomerCompany) => {
      const entry = insights
        ?.get(company.id)
        ?.money.find((m) => m.currency === currency);
      return {
        invoiced: entry?.invoicedMinor ?? 0,
        owing: entry ? entry.invoicedMinor - entry.receivedMinor : 0,
        lastJob: insights?.get(company.id)?.lastJobAt ?? "",
      };
    };
    const filtered = customers.filter((company) => {
      if (status === "all" || !insights) return true;
      const active = insights.get(company.id)?.active ?? false;
      return status === "active" ? active : !active;
    });
    return [...filtered].sort((a, b) => {
      if (sortKey === "revenue") return figure(b).invoiced - figure(a).invoiced;
      if (sortKey === "owing") return figure(b).owing - figure(a).owing;
      if (sortKey === "lastJob") {
        return figure(b).lastJob.localeCompare(figure(a).lastJob);
      }
      return a.companyName.localeCompare(b.companyName);
    });
  }, [customers, insights, status, sortKey, currency]);

  useEffect(() => {
    let active = true;
    setLoadState("loading");
    setLoadError("");
    listCustomers(query)
      .then((results) => {
        if (active) {
          setCustomers(results);
          if (!query.trim()) setAllCustomers(results);
          setLoadState("ready");
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setLoadError(
            error instanceof Error
              ? error.message
              : "The customer directory is unavailable",
          );
          setLoadState("error");
        }
      });

    return () => {
      active = false;
    };
  }, [query, retry]);

  return (
    <>
      <section className={styles.overview} aria-label="Customer overview">
        <div className={styles.metric}>
          <span>Active customers</span>
          <strong>
            {insights && totalCompanies ? activeCompanies : "—"}
            {insights && totalCompanies > 0 && (
              <em className={styles.metricOf}> of {totalCompanies}</em>
            )}
          </strong>
          <small>
            A job still open or opened in the last {customerActiveDays} days
          </small>
        </div>
        <div className={styles.metric}>
          <span>Owing{currency ? ` (${currency})` : ""}</span>
          <strong>{insights && currency ? money(owingTotal) : "—"}</strong>
          <small>
            {insights && currency
              ? `${owingCustomers} ${owingCustomers === 1 ? "customer owes" : "customers owe"} money`
              : "No invoices issued yet"}
          </small>
        </div>
        <div className={styles.metric}>
          <span>Quotes awaiting an answer</span>
          <strong>{insights ? quotesAwaiting : "—"}</strong>
          <small>Issued, and the customer has not replied</small>
        </div>
        <div className={styles.metric}>
          <span>No one to message</span>
          <strong>{totalCompanies ? unreachable : "—"}</strong>
          <small>Companies with no contact switched on for messages</small>
        </div>
      </section>

      {insights && currencies.length > 0 && (
        <div className={styles.rankingPair}>
          <section className={chart.chartCard} aria-labelledby="revenue-title">
            <div className={styles.rankingHeader}>
              <div>
                <h2 id="revenue-title">Customers by revenue</h2>
                <p className={chart.headline}>
                  {topFive.length
                    ? topFive.length === 1
                      ? `One customer accounts for all ${money(revenueTotal)} invoiced`
                      : `The top ${topFive.length} bring in ${Math.round(pct(topFiveTotal, revenueTotal))}% of ${money(revenueTotal)} invoiced`
                    : `Nothing invoiced in ${currency} yet`}
                </p>
              </div>
              {currencies.length > 1 && (
                <div
                  className={ui.segmented}
                  role="group"
                  aria-label="Currency"
                >
                  {currencies.map((code) => (
                    <button
                      aria-pressed={currency === code}
                      className={currency === code ? ui.segmentActive : ""}
                      key={code}
                      onClick={() => setCurrency(code)}
                      type="button"
                    >
                      {code}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {topFive.map((row) => (
              <div className={chart.row} key={row.company.id}>
                <div className={chart.rowHead}>
                  <Link
                    className={styles.companyLink}
                    href={`/customers/${row.company.id}`}
                  >
                    <strong>{row.company.companyName}</strong>
                  </Link>
                  <span>
                    {money(row.invoiced)}
                    {row.owing > 0 ? ` · owes ${money(row.owing)}` : ""}
                  </span>
                </div>
                <div
                  className={`${chart.bar} ${chart.invoiced} ${chart.single}`}
                  style={{
                    width: `${pct(row.invoiced, topFive[0].invoiced)}%`,
                  }}
                  title={`Invoiced ${money(row.invoiced)}`}
                />
              </div>
            ))}
          </section>
          <section className={chart.chartCard} aria-labelledby="owing-title">
            <h2 id="owing-title">Who owes you most</h2>
            <p className={chart.headline}>
              {topOwing.length
                ? `${money(owingTotal)} still to collect in ${currency}`
                : `Nobody owes anything in ${currency}`}
            </p>
            {topOwing.map((row) => (
              <div className={chart.row} key={row.company.id}>
                <div className={chart.rowHead}>
                  <Link
                    className={styles.companyLink}
                    href={`/customers/${row.company.id}`}
                  >
                    <strong>{row.company.companyName}</strong>
                  </Link>
                  <span>{money(row.owing)}</span>
                </div>
                <div
                  className={`${chart.bar} ${chart.invoiced} ${chart.single}`}
                  style={{ width: `${pct(row.owing, topOwing[0].owing)}%` }}
                  title={`Owing ${money(row.owing)}`}
                />
              </div>
            ))}
          </section>
        </div>
      )}

      <section className={styles.directory} aria-label="Customer companies">
        <div className={styles.searchHeader}>
          <div>
            <label className={styles.searchLabel} htmlFor="customer-search">
              Customer records
            </label>
            <p className={styles.searchHint}>
              Search profiles and contacts, then open a record to see its jobs,
              quotes and money.
            </p>
          </div>
          {isSuperAdmin && (
            <Link className={styles.newCustomerLink} href="/customers/new">
              New customer
            </Link>
          )}
        </div>

        <div className={styles.searchRow}>
          <span className={styles.searchIcon} aria-hidden="true">
            ⌕
          </span>
          <input
            autoComplete="off"
            className={styles.searchInput}
            id="customer-search"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Try a company, ID number, address, contact, or phone"
            type="search"
            value={query}
          />
          {query && (
            <button
              aria-label="Clear customer search"
              className={styles.clearButton}
              onClick={() => setQuery("")}
              type="button"
            >
              Clear
            </button>
          )}
        </div>

        {insights && (
          <div className={styles.filterRow}>
            <div className={ui.segmented} role="group" aria-label="Status">
              {(["all", "active", "inactive"] as const).map((option) => (
                <button
                  aria-pressed={status === option}
                  className={status === option ? ui.segmentActive : ""}
                  key={option}
                  onClick={() => setStatus(option)}
                  type="button"
                >
                  {option === "all"
                    ? "All"
                    : option === "active"
                      ? "Active"
                      : "Inactive"}
                </button>
              ))}
            </div>
            <label className={styles.sortLabel}>
              Sort by
              <select
                onChange={(event) => setSortKey(event.target.value as SortKey)}
                value={sortKey}
              >
                <option value="name">Name</option>
                <option value="revenue">Revenue</option>
                <option value="owing">Amount owing</option>
                <option value="lastJob">Latest job</option>
              </select>
            </label>
            {currencies.length > 1 && (
              <label className={styles.sortLabel}>
                Amounts in
                <select
                  onChange={(event) => setCurrency(event.target.value)}
                  value={currency}
                >
                  {currencies.map((code) => (
                    <option key={code} value={code}>
                      {code}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        )}

        {loadState === "loading" && (
          <div className={styles.emptyState} role="status" aria-live="polite">
            <h2>Loading customers</h2>
          </div>
        )}

        {loadState === "error" && (
          <div className={styles.emptyState}>
            <ErrorPopup message={loadError} />
            <h2>Customers could not be loaded</h2>
            <p>{plainMessage(loadError)}</p>
            <button
              className={styles.emptyClearButton}
              onClick={() => setRetry((current) => current + 1)}
              type="button"
            >
              Try again
            </button>
          </div>
        )}

        {loadState === "ready" && (
          <>
            <p
              className={styles.resultSummary}
              role="status"
              aria-live="polite"
            >
              {rows.length} {rows.length === 1 ? "company" : "companies"}
              {query.trim() ? " match your search" : " in the directory"}
            </p>

            {rows.length > 0 ? (
              <div className={styles.tableScroll}>
                <table className={styles.customerTable}>
                  <thead>
                    <tr>
                      <th scope="col">Company</th>
                      <th scope="col">Customer ID</th>
                      {insights && <th scope="col">Status</th>}
                      <th scope="col">Contacts</th>
                      {insights && (
                        <>
                          <th scope="col">Jobs</th>
                          <th scope="col">Latest job</th>
                          <th className={styles.numeric} scope="col">
                            Invoiced{currency ? ` (${currency})` : ""}
                          </th>
                          <th className={styles.numeric} scope="col">
                            Owing
                          </th>
                        </>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((customer) => {
                      const insight = insights?.get(customer.id);
                      const entry = moneyOf(customer.id);
                      return (
                        <tr key={customer.id}>
                          <th scope="row">
                            <Link
                              className={styles.companyLink}
                              href={`/customers/${customer.id}`}
                            >
                              {customer.companyName}
                              {customer.tradingName && (
                                <span className={styles.tradingName}>
                                  Trading as {customer.tradingName}
                                </span>
                              )}
                            </Link>
                          </th>
                          <td>
                            <span className={styles.customerId}>
                              {customer.customerNumber}
                            </span>
                          </td>
                          {insights && (
                            <td>
                              <span
                                className={`${ui.badge} ${insight?.active ? "" : styles.inactiveBadge}`}
                                title={
                                  insight?.active
                                    ? undefined
                                    : `No job in the last ${customerActiveDays} days`
                                }
                              >
                                {insight?.active ? "Active" : "Inactive"}
                              </span>
                            </td>
                          )}
                          <td>
                            {customer.contacts
                              .map((contact) => contact.name)
                              .join(", ") || "—"}
                          </td>
                          {insights && (
                            <>
                              <td className={styles.nowrap}>
                                {insight
                                  ? `${insight.activeJobs} open · ${insight.totalJobs} total`
                                  : "—"}
                              </td>
                              <td className={styles.nowrap}>
                                {shortDate(insight?.lastJobAt ?? null)}
                              </td>
                              <td className={styles.numeric}>
                                {entry ? money(entry.invoicedMinor) : "—"}
                              </td>
                              <td className={styles.numeric}>
                                {entry
                                  ? money(
                                      entry.invoicedMinor - entry.receivedMinor,
                                    )
                                  : "—"}
                              </td>
                            </>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : query.trim() ? (
              <div className={styles.emptyState}>
                <span className={styles.emptyIcon} aria-hidden="true">
                  ⌕
                </span>
                <h2>No customers match</h2>
                <p>Try another company, contact name, or email address.</p>
                <button
                  className={styles.emptyClearButton}
                  onClick={() => setQuery("")}
                  type="button"
                >
                  Clear search
                </button>
              </div>
            ) : (
              <div className={styles.emptyState}>
                <h2>No customers yet</h2>
                <p>
                  {isSuperAdmin
                    ? "Create a company profile to start the customer directory."
                    : "Customer profiles will appear here when they are available."}
                </p>
                {isSuperAdmin && (
                  <Link
                    className={styles.emptyClearButton}
                    href="/customers/new"
                  >
                    New customer
                  </Link>
                )}
              </div>
            )}
          </>
        )}
      </section>
    </>
  );
}
