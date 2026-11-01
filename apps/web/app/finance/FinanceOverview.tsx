"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { FinanceTabs } from "../invoices/FinanceTabs";
import { RecordPayment } from "./RecordPayment";
import { getFinanceSummary, getOutstandingInvoices } from "../jobs/jobApi";
import type { FinanceSummary, OutstandingInvoice } from "../jobs/jobApi";
import { formatMoney } from "../quotes/quoteApi";
import styles from "../jobs/jobs.module.css";
import chart from "./finance.module.css";
import charts from "../charts/charts.module.css";
import {
  chartColors,
  ColumnChart,
  DonutChart,
  RankedBars,
} from "../charts/Charts";
import { ErrorPopup } from "../ErrorPopup";

type Row = FinanceSummary["jobs"][number];

const pct = (part: number, whole: number) =>
  whole > 0 ? Math.max(0, Math.min(100, (part / whole) * 100)) : 0;

const sum = (rows: Row[], pick: (row: Row) => number) =>
  rows.reduce((total, row) => total + pick(row), 0);

const jobs = (count: number) => `${count} ${count === 1 ? "job" : "jobs"}`;

/**
 * Money across jobs, staff only. One currency at a time: currencies are never added together.
 * The dashboard shows the figures and charts; the Jobs tab lists every job.
 */
export function FinanceOverview({ view }: { view: "dashboard" | "jobs" }) {
  const [summary, setSummary] = useState<FinanceSummary | null>(null);
  const [overdueInvoices, setOverdueInvoices] = useState<
    OutstandingInvoice[] | null
  >(null);
  const [error, setError] = useState("");
  const [currency, setCurrency] = useState("");
  const [customer, setCustomer] = useState("");
  const [query, setQuery] = useState("");

  // Only the split of what is owing needs this; without it the chart shows one "owing" part.
  useEffect(() => {
    if (view !== "dashboard") return;
    getOutstandingInvoices("")
      .then((result) => setOverdueInvoices(result.invoices))
      .catch(() => setOverdueInvoices(null));
  }, [view]);

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

  // After a payment: update the figures but keep the chosen currency.
  const refresh = () => {
    if (view === "dashboard") {
      getOutstandingInvoices("")
        .then((result) => setOverdueInvoices(result.invoices))
        .catch(() => setOverdueInvoices(null));
    }
    return getFinanceSummary()
      .then(setSummary)
      .catch((cause) =>
        setError(
          cause instanceof Error
            ? cause.message
            : "Finance could not be loaded",
        ),
      );
  };

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

  // Of what is owing, how much is past its due date (the rest is not yet due).
  const overdue =
    overdueInvoices === null
      ? null
      : Math.min(
          owing,
          overdueInvoices
            .filter(
              (invoice) =>
                invoice.overdue &&
                invoice.currency === currency &&
                (!customer || invoice.customerCompanyName === customer),
            )
            .reduce((total, invoice) => total + invoice.outstandingMinor, 0),
        );

  // Costs against profit, on the jobs that have both an invoice and costs.
  const comparableInvoiced = sum(comparable, (row) => row.invoicedMinor);
  const comparableCosts = sum(comparable, (row) => row.costMinor);
  const margin =
    comparableInvoiced > 0
      ? Math.round((profit / comparableInvoiced) * 100)
      : 0;

  // Revenue by customer: the three biggest, the rest together.
  const revenueBy = useMemo(() => {
    const byCustomer = new Map<string, number>();
    for (const row of rows) {
      byCustomer.set(
        row.customerCompanyName,
        (byCustomer.get(row.customerCompanyName) ?? 0) + row.invoicedMinor,
      );
    }
    return [...byCustomer.entries()]
      .filter(([, amount]) => amount > 0)
      .sort((a, b) => b[1] - a[1]);
  }, [rows]);
  const topRevenue = revenueBy.slice(0, 3);
  const otherRevenue = revenueBy
    .slice(3)
    .reduce((total, [, amount]) => total + amount, 0);
  const revenueShades = [
    chartColors.blue,
    chartColors.blueMid,
    chartColors.blueLight,
  ];

  // Money in and out by month, for the chosen currency and customer.
  const trendMonths = summary?.trend?.months ?? [];
  const trendRows = (summary?.trend?.rows ?? []).filter(
    (row) =>
      row.currency === currency &&
      (!customer || row.customerCompanyName === customer),
  );
  const monthTotal = (month: string, pick: "invoicedMinor" | "receivedMinor") =>
    trendRows
      .filter((row) => row.month === month)
      .reduce((total, row) => total + row[pick], 0);
  const trendInvoiced = trendMonths.map((m) => monthTotal(m, "invoicedMinor"));
  const trendReceived = trendMonths.map((m) => monthTotal(m, "receivedMinor"));
  const monthName = (month: string, style: "short" | "long") =>
    new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-GH", {
      month: style === "short" ? "short" : "long",
      ...(style === "long" ? { year: "numeric" } : {}),
      timeZone: "UTC",
    });
  const trendHasMoney = [...trendInvoiced, ...trendReceived].some(
    (amount) => amount > 0,
  );

  const profitRows = [...comparable]
    .sort((a, b) => (b.marginMinor ?? 0) - (a.marginMinor ?? 0))
    .slice(0, 6);

  return (
    <>
      <main className={styles.page}>
        <header className={styles.header}>
          <div>
            <h1 className={styles.title}>Finance</h1>
          </div>
          {summary && <RecordPayment onRecorded={() => void refresh()} />}
        </header>
        <FinanceTabs active={view === "jobs" ? "/finance/jobs" : "/finance"} />
        <ErrorPopup message={error} />
        {!summary && !error && <p className={styles.muted}>Loading…</p>}
        {summary && summary.jobs.length === 0 && (
          <p className={styles.muted}>No invoices or costs recorded yet.</p>
        )}
        {summary && summary.jobs.length > 0 && (
          <div className={chart.board}>
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
              {view === "jobs" && (
                <label className={styles.field}>
                  Search
                  <input
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Job file or customer"
                    type="search"
                    value={query}
                  />
                </label>
              )}
            </div>

            {view === "dashboard" && (
              <div className={chart.kpis}>
                <div className={chart.kpi}>
                  <span>Invoiced</span>
                  <strong>{money(invoiced)}</strong>
                  <small>
                    {jobs(rows.filter((r) => r.invoicedMinor > 0).length)}
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
                  <small>
                    {owing > 0
                      ? `${jobs(rows.filter((r) => r.owingMinor > 0).length)} still owe`
                      : "Nothing outstanding"}
                  </small>
                </div>
                <div className={chart.kpi}>
                  <span>Total costs</span>
                  <strong>{money(costs)}</strong>
                  <small>
                    {jobs(rows.filter((r) => r.costMinor > 0).length)} with
                    costs
                  </small>
                </div>
                <div className={chart.kpi}>
                  <span>Profit</span>
                  <strong>{comparable.length ? money(profit) : "-"}</strong>
                  <small>
                    {comparable.length
                      ? `${jobs(comparable.length)} with invoice and costs`
                      : "No job has both in " + currency}
                  </small>
                </div>
              </div>
            )}

            {rows.length === 0 && (
              <p className={styles.muted}>Nothing matches these filters.</p>
            )}

            {view === "dashboard" && rows.length > 0 && (
              <div className={charts.grid}>
                {trendMonths.length > 0 && (
                  <section
                    className={`${charts.card} ${charts.wide}`}
                    aria-labelledby="trend-title"
                  >
                    <h2 id="trend-title">Money in and out</h2>
                    <p className={charts.headline}>
                      {trendHasMoney
                        ? `Invoiced ${money(trendInvoiced.reduce((a, b) => a + b, 0))} and received ${money(trendReceived.reduce((a, b) => a + b, 0))} over the last ${trendMonths.length} months`
                        : `No invoices or payments in ${currency} over the last ${trendMonths.length} months`}
                    </p>
                    {trendHasMoney && (
                      <ColumnChart
                        axisFormat={(minor) =>
                          new Intl.NumberFormat("en-GH", {
                            notation: "compact",
                            maximumFractionDigits: 1,
                          }).format(minor / 100)
                        }
                        format={money}
                        periods={trendMonths.map((month) => ({
                          short: monthName(month, "short"),
                          full: monthName(month, "long"),
                        }))}
                        series={[
                          {
                            name: "Invoiced",
                            color: chartColors.blue,
                            values: trendInvoiced,
                          },
                          {
                            name: "Received",
                            color: chartColors.good,
                            values: trendReceived,
                          },
                        ]}
                      />
                    )}
                  </section>
                )}

                <section
                  className={charts.card}
                  aria-labelledby="collect-title"
                >
                  <h2 id="collect-title">Are we getting paid?</h2>
                  <p className={charts.headline}>
                    {invoiced > 0
                      ? `${Math.round(collected)}% of ${money(invoiced)} collected`
                      : "Nothing invoiced yet"}
                  </p>
                  {invoiced > 0 && (
                    <DonutChart
                      centerLabel="collected"
                      centerValue={`${Math.round(collected)}%`}
                      segments={
                        overdue === null
                          ? [
                              {
                                label: "Collected",
                                value: received,
                                display: money(received),
                                color: chartColors.good,
                              },
                              {
                                label: "Still owing",
                                value: owing,
                                display: money(owing),
                                color: chartColors.warning,
                              },
                            ]
                          : [
                              {
                                label: "Collected",
                                value: received,
                                display: money(received),
                                color: chartColors.good,
                              },
                              {
                                label: "Owing, not yet due",
                                value: owing - overdue,
                                display: money(owing - overdue),
                                color: chartColors.warning,
                              },
                              {
                                label: "Overdue",
                                value: overdue,
                                display: money(overdue),
                                color: chartColors.bad,
                              },
                            ]
                      }
                    />
                  )}
                </section>

                <section className={charts.card} aria-labelledby="owes-title">
                  <h2 id="owes-title">Who owes the most</h2>
                  <p className={charts.headline}>
                    {owedBy.length
                      ? `${money(owing)} still to collect`
                      : "Nobody owes anything"}
                  </p>
                  <RankedBars
                    rows={owedBy.map(([name, amount]) => ({
                      key: name,
                      label: name,
                      value: amount,
                      display: money(amount),
                      color: chartColors.warning,
                    }))}
                  />
                </section>

                <section
                  className={charts.card}
                  aria-labelledby="revenue-title"
                >
                  <h2 id="revenue-title">Revenue by customer</h2>
                  <p className={charts.headline}>
                    {revenueBy.length
                      ? `${money(invoiced)} invoiced across ${revenueBy.length} ${revenueBy.length === 1 ? "customer" : "customers"}`
                      : "Nothing invoiced yet"}
                  </p>
                  {revenueBy.length > 0 && (
                    <DonutChart
                      centerLabel={
                        revenueBy.length === 1 ? "customer" : "customers"
                      }
                      centerValue={String(revenueBy.length)}
                      segments={[
                        ...topRevenue.map(([name, amount], index) => ({
                          label: name,
                          value: amount,
                          display: money(amount),
                          color: revenueShades[index],
                        })),
                        ...(otherRevenue > 0
                          ? [
                              {
                                label: "All others",
                                value: otherRevenue,
                                display: money(otherRevenue),
                                color: chartColors.other,
                              },
                            ]
                          : []),
                      ]}
                    />
                  )}
                </section>

                <section className={charts.card} aria-labelledby="margin-title">
                  <h2 id="margin-title">Costs against profit</h2>
                  <p className={charts.headline}>
                    {comparable.length
                      ? `${jobs(comparable.length)} with an invoice and costs`
                      : `No job has both an invoice and costs in ${currency}. Costs are recorded in GHS, so other currencies are not compared.`}
                  </p>
                  {comparable.length > 0 && (
                    <DonutChart
                      centerLabel="margin"
                      centerValue={`${margin}%`}
                      segments={
                        profit >= 0
                          ? [
                              {
                                label: "Costs",
                                value: comparableCosts,
                                display: money(comparableCosts),
                                color: chartColors.cost,
                              },
                              {
                                label: "Profit",
                                value: profit,
                                display: money(profit),
                                color: chartColors.blue,
                              },
                            ]
                          : [
                              {
                                label: "Covered by invoices",
                                value: comparableInvoiced,
                                display: money(comparableInvoiced),
                                color: chartColors.blue,
                              },
                              {
                                label: "Loss",
                                value: -profit,
                                display: money(-profit),
                                color: chartColors.bad,
                              },
                            ]
                      }
                    />
                  )}
                </section>

                {profitRows.length > 0 && (
                  <section
                    className={`${charts.card} ${charts.wide}`}
                    aria-labelledby="job-profit-title"
                  >
                    <h2 id="job-profit-title">Profit by job</h2>
                    <p className={charts.headline}>
                      Best first. Jobs that lost money are in red.
                    </p>
                    <RankedBars
                      rows={profitRows.map((row) => {
                        const result = row.marginMinor ?? 0;
                        return {
                          key: row.jobId,
                          label: (
                            <Link
                              className={styles.link}
                              href={`/jobs/${row.jobId}/money`}
                            >
                              {row.fileNumber}
                            </Link>
                          ),
                          value: Math.abs(result),
                          display: `${result < 0 ? "Loss " : "Profit "}${money(Math.abs(result))}`,
                          color:
                            result < 0 ? chartColors.bad : chartColors.good,
                        };
                      })}
                    />
                  </section>
                )}
              </div>
            )}

            {view === "jobs" && rows.length > 0 && (
              <section className={styles.card} aria-labelledby="jobs-title">
                <h2 id="jobs-title">Jobs</h2>
                <div className={chart.tableWrap}>
                  <table className={chart.cardTable}>
                    <thead>
                      <tr>
                        <th scope="col">Job and customer</th>
                        <th className={chart.num} scope="col">
                          Invoiced
                        </th>
                        <th className={chart.num} scope="col">
                          Received
                        </th>
                        <th className={chart.num} scope="col">
                          Owing
                        </th>
                        <th className={chart.num} scope="col">
                          Costs
                        </th>
                        <th className={chart.num} scope="col">
                          Profit
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => (
                        <tr key={`${row.jobId}-${row.currency}`}>
                          <td className={chart.jobCell}>
                            <Link
                              className={styles.link}
                              href={`/jobs/${row.jobId}/money`}
                            >
                              {row.fileNumber}
                            </Link>
                            <span className={chart.customerName}>
                              {row.customerCompanyName}
                            </span>
                          </td>
                          <td className={chart.num} data-label="Invoiced">
                            {money(row.invoicedMinor)}
                          </td>
                          <td className={chart.num} data-label="Received">
                            {money(row.receivedMinor)}
                          </td>
                          <td
                            className={`${chart.num}${row.owingMinor > 0 ? ` ${chart.owingText}` : ""}`}
                            data-label="Owing"
                          >
                            {money(row.owingMinor)}
                          </td>
                          <td className={chart.num} data-label="Costs">
                            {money(row.costMinor)}
                          </td>
                          <td
                            className={`${chart.num}${(row.marginMinor ?? 0) < 0 ? ` ${chart.lossText}` : ""}`}
                            data-label="Profit"
                          >
                            {row.marginMinor === null
                              ? "-"
                              : money(row.marginMinor)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <th className={chart.jobCell} scope="row">
                          Total
                        </th>
                        <td className={chart.num} data-label="Invoiced">
                          {money(invoiced)}
                        </td>
                        <td className={chart.num} data-label="Received">
                          {money(received)}
                        </td>
                        <td className={chart.num} data-label="Owing">
                          {money(owing)}
                        </td>
                        <td className={chart.num} data-label="Costs">
                          {money(costs)}
                        </td>
                        <td className={chart.num} data-label="Profit">
                          {comparable.length ? money(profit) : "-"}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </section>
            )}
          </div>
        )}
      </main>
    </>
  );
}
