"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AuthStatus } from "../auth/AuthStatus";
import { FinanceTabs } from "../invoices/FinanceTabs";
import { getFinanceSummary } from "../jobs/jobApi";
import type { FinanceSummary } from "../jobs/jobApi";
import { formatMoney } from "../quotes/quoteApi";
import styles from "../jobs/jobs.module.css";
import chart from "./finance.module.css";
import { ErrorPopup } from "../ErrorPopup";

type Row = FinanceSummary["jobs"][number];

const pct = (part: number, whole: number) =>
  whole > 0 ? Math.max(0, Math.min(100, (part / whole) * 100)) : 0;

const sum = (rows: Row[], pick: (row: Row) => number) =>
  rows.reduce((total, row) => total + pick(row), 0);

/** Money across jobs, staff only. One currency at a time: currencies are never added together. */
export function FinanceOverview() {
  const [summary, setSummary] = useState<FinanceSummary | null>(null);
  const [error, setError] = useState("");
  const [currency, setCurrency] = useState("");
  const [customer, setCustomer] = useState("");
  const [query, setQuery] = useState("");

  useEffect(() => {
    getFinanceSummary()
      .then((result) => {
        setSummary(result);
        // Open on the currency with the most invoiced.
        const first = [...result.totals].sort(
          (a, b) => b.invoicedMinor - a.invoicedMinor,
        )[0];
        setCurrency(first?.currency ?? "");
      })
      .catch((cause) =>
        setError(
          cause instanceof Error
            ? cause.message
            : "Finance could not be loaded",
        ),
      );
  }, []);

  const customers = useMemo(
    () =>
      [
        ...new Set((summary?.jobs ?? []).map((row) => row.customerCompanyName)),
      ].sort(),
    [summary],
  );

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (summary?.jobs ?? []).filter(
      (row) =>
        row.currency === currency &&
        (!customer || row.customerCompanyName === customer) &&
        (!needle ||
          row.fileNumber.toLowerCase().includes(needle) ||
          row.customerCompanyName.toLowerCase().includes(needle)),
    );
  }, [summary, currency, customer, query]);

  const invoiced = sum(rows, (row) => row.invoicedMinor);
  const received = sum(rows, (row) => row.receivedMinor);
  const owing = sum(rows, (row) => row.owingMinor);
  const costs = sum(rows, (row) => row.costMinor);
  const comparable = rows.filter((row) => row.marginMinor !== null);
  const profit = sum(comparable, (row) => row.marginMinor ?? 0);
  const collected = pct(received, invoiced);

  const owedBy = useMemo(() => {
    const byCustomer = new Map<string, number>();
    for (const row of rows) {
      byCustomer.set(
        row.customerCompanyName,
        (byCustomer.get(row.customerCompanyName) ?? 0) + row.owingMinor,
      );
    }
    return [...byCustomer.entries()]
      .filter(([, amount]) => amount > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
  }, [rows]);

  const money = (minor: number) => formatMoney(minor, currency);
  const currencies = summary?.totals.map((total) => total.currency) ?? [];
  const shown = comparable.slice(0, 8);
  const scale = Math.max(
    1,
    ...shown.map((row) => Math.max(row.invoicedMinor, row.costMinor)),
  );

  return (
    <>
      <header className="topbar">
        <div className="breadcrumb">
          <Link href="/">Workspace</Link>
          <span aria-hidden="true">/</span>
          <strong>Finance</strong>
        </div>
        <AuthStatus />
      </header>
      <main className={styles.page}>
        <header className={styles.header}>
          <div>
            <h1 className={styles.title}>Finance</h1>
          </div>
        </header>
        <FinanceTabs active="/finance" />
        <ErrorPopup message={error} />
        {!summary && !error && <p className={styles.muted}>Loading…</p>}
        {summary && summary.jobs.length === 0 && (
          <p className={styles.muted}>No invoices or costs recorded yet.</p>
        )}
        {summary && summary.jobs.length > 0 && (
          <>
            <div className={chart.filters}>
              <label className={styles.field}>
                Currency
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
              <label className={styles.field}>
                Customer
                <select
                  onChange={(event) => setCustomer(event.target.value)}
                  value={customer}
                >
                  <option value="">All customers</option>
                  {customers.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
              <label className={styles.field}>
                Search
                <input
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Job file or customer"
                  type="search"
                  value={query}
                />
              </label>
            </div>

            <div className={chart.kpis}>
              <div className={chart.kpi}>
                <span>Invoiced</span>
                <strong>{money(invoiced)}</strong>
                <small>
                  {rows.filter((r) => r.invoicedMinor > 0).length} jobs
                </small>
              </div>
              <div className={chart.kpi}>
                <span>Received</span>
                <strong>{money(received)}</strong>
                <small>{Math.round(collected)}% of invoiced</small>
              </div>
              <div className={chart.kpi}>
                <span>Owing</span>
                <strong>{money(owing)}</strong>
                <small>Credits: none, overpayments are refused</small>
              </div>
              <div className={chart.kpi}>
                <span>Total costs</span>
                <strong>{money(costs)}</strong>
                <small>
                  {rows.filter((r) => r.costMinor > 0).length} jobs with costs
                </small>
              </div>
              <div className={chart.kpi}>
                <span>Profit</span>
                <strong>{comparable.length ? money(profit) : "-"}</strong>
                <small>
                  {comparable.length
                    ? `${comparable.length} jobs with invoice and costs`
                    : "No job has both in " + currency}
                </small>
              </div>
            </div>

            {rows.length === 0 && (
              <p className={styles.muted}>Nothing matches these filters.</p>
            )}

            {rows.length > 0 && (
              <div className={chart.charts}>
                <section
                  className={chart.chartCard}
                  aria-labelledby="collect-title"
                >
                  <h2 id="collect-title">Are we getting paid?</h2>
                  <p className={chart.headline}>
                    {invoiced > 0
                      ? `${Math.round(collected)}% of ${money(invoiced)} collected`
                      : "Nothing invoiced yet"}
                  </p>
                  {invoiced > 0 && (
                    <div className={chart.track}>
                      {received > 0 && (
                        <div
                          className={`${chart.bar} ${chart.collected}`}
                          style={{ width: `${collected}%` }}
                          title={`Collected ${money(received)}`}
                        />
                      )}
                      {owing > 0 && (
                        <div
                          className={`${chart.bar} ${chart.owing}`}
                          style={{ width: `${100 - collected}%` }}
                          title={`Still owing ${money(owing)}`}
                        />
                      )}
                    </div>
                  )}
                  <ul className={chart.legend}>
                    <li>
                      <span className={`${chart.swatch} ${chart.collected}`} />
                      Collected {money(received)}
                    </li>
                    <li>
                      <span className={`${chart.swatch} ${chart.owing}`} />
                      Still owing {money(owing)}
                    </li>
                  </ul>
                  {owedBy.length > 0 && (
                    <>
                      <h3 className={chart.subhead}>Who owes the most</h3>
                      {owedBy.map(([name, amount]) => (
                        <div className={chart.row} key={name}>
                          <div className={chart.rowHead}>
                            <span>{name}</span>
                            <span>{money(amount)}</span>
                          </div>
                          <div
                            className={`${chart.bar} ${chart.owing} ${chart.single}`}
                            style={{ width: `${pct(amount, owedBy[0][1])}%` }}
                            title={`${name} owes ${money(amount)}`}
                          />
                        </div>
                      ))}
                    </>
                  )}
                </section>
                <section
                  className={chart.chartCard}
                  aria-labelledby="profit-title"
                >
                  <h2 id="profit-title">What each job earns</h2>
                  <p className={chart.headline}>
                    {shown.length
                      ? "Invoiced against costs per job"
                      : `No job has both an invoice and costs in ${currency}. Costs are recorded in GHS, so other currencies are not compared.`}
                  </p>
                  {shown.map((row) => (
                    <div className={chart.row} key={row.jobId}>
                      <div className={chart.rowHead}>
                        <strong>{row.fileNumber}</strong>
                        <span>
                          {(row.marginMinor ?? 0) < 0 ? "Loss " : "Profit "}
                          {money(Math.abs(row.marginMinor ?? 0))}
                        </span>
                      </div>
                      <div
                        className={`${chart.bar} ${chart.invoiced} ${chart.single}`}
                        style={{ width: `${pct(row.invoicedMinor, scale)}%` }}
                        title={`Invoiced ${money(row.invoicedMinor)}`}
                      />
                      <div
                        className={`${chart.bar} ${chart.cost} ${chart.single}`}
                        style={{ width: `${pct(row.costMinor, scale)}%` }}
                        title={`Costs ${money(row.costMinor)}`}
                      />
                    </div>
                  ))}
                  {shown.length > 0 && (
                    <ul className={chart.legend}>
                      <li>
                        <span className={`${chart.swatch} ${chart.invoiced}`} />
                        Invoiced
                      </li>
                      <li>
                        <span className={`${chart.swatch} ${chart.cost}`} />
                        Costs
                      </li>
                    </ul>
                  )}
                </section>
              </div>
            )}

            {rows.length > 0 && (
              <section className={styles.card} aria-labelledby="jobs-title">
                <h2 id="jobs-title">Jobs</h2>
                <div className={styles.tableScroll}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>Job</th>
                        <th>Customer</th>
                        <th>Invoiced</th>
                        <th>Received</th>
                        <th>Owing</th>
                        <th>Costs</th>
                        <th>Profit</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => (
                        <tr key={`${row.jobId}-${row.currency}`}>
                          <td>
                            <Link
                              className={styles.link}
                              href={`/jobs/${row.jobId}/money`}
                            >
                              {row.fileNumber}
                            </Link>
                          </td>
                          <td>{row.customerCompanyName}</td>
                          <td>{money(row.invoicedMinor)}</td>
                          <td>{money(row.receivedMinor)}</td>
                          <td>{money(row.owingMinor)}</td>
                          <td>{money(row.costMinor)}</td>
                          <td>
                            {row.marginMinor === null
                              ? "-"
                              : money(row.marginMinor)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <th colSpan={2}>Total</th>
                        <th>{money(invoiced)}</th>
                        <th>{money(received)}</th>
                        <th>{money(owing)}</th>
                        <th>{money(costs)}</th>
                        <th>{comparable.length ? money(profit) : "-"}</th>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </section>
            )}
          </>
        )}
      </main>
    </>
  );
}
