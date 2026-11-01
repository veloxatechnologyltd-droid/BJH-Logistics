"use client";

import { useEffect, useMemo, useState } from "react";
import { customerActiveDays } from "@bjh/contracts";
import { listCustomerInsights, listCustomers } from "./customerApi";
import type { CustomerCompany, CustomerInsight } from "./customerApi";
import { formatMoney } from "../quotes/quoteApi";
import { chartColors, DonutChart } from "../charts/Charts";
import charts from "../charts/charts.module.css";
import ui from "../jobs/jobs.module.css";
import styles from "./customerDirectory.module.css";

/** Whether anyone at the company is switched on to receive messages. */
const canBeMessaged = (company: CustomerCompany) =>
  company.contacts.some((contact) => contact.notify);

/** The customer base at a glance: figures and charts. The records themselves are in the Directory tab. */
export function CustomerOverview() {
  const [customers, setCustomers] = useState<CustomerCompany[]>([]);
  const [insights, setInsights] = useState<Map<string, CustomerInsight> | null>(
    null,
  );
  const [loaded, setLoaded] = useState(false);
  const [currency, setCurrency] = useState("");

  useEffect(() => {
    listCustomers("")
      .then(setCustomers)
      .catch(() => setCustomers([]))
      .finally(() => setLoaded(true));
    listCustomerInsights()
      .then((rows) => {
        setInsights(new Map(rows.map((row) => [row.companyId, row])));
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
        setCurrency(
          [...totals.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "",
        );
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

  const money = (minor: number) => formatMoney(minor, currency);
  const moneyOf = (companyId: string) =>
    insights
      ?.get(companyId)
      ?.money.find((entry) => entry.currency === currency);

  const total = customers.length;
  const active = customers.filter(
    (company) => insights?.get(company.id)?.active,
  ).length;
  const owingTotal = customers.reduce((sum, company) => {
    const entry = moneyOf(company.id);
    return sum + (entry ? entry.invoicedMinor - entry.receivedMinor : 0);
  }, 0);
  const owingCustomers = customers.filter((company) => {
    const entry = moneyOf(company.id);
    return entry ? entry.invoicedMinor - entry.receivedMinor > 0 : false;
  }).length;
  const unreachable = customers.filter(
    (company) => !canBeMessaged(company),
  ).length;

  const quotes = customers.reduce(
    (sum, company) => {
      const insight = insights?.get(company.id);
      return {
        sent: sum.sent + (insight?.quotesSent ?? 0),
        accepted: sum.accepted + (insight?.quotesAccepted ?? 0),
        awaiting: sum.awaiting + (insight?.quotesAwaiting ?? 0),
      };
    },
    { sent: 0, accepted: 0, awaiting: 0 },
  );
  const notAccepted = Math.max(
    0,
    quotes.sent - quotes.accepted - quotes.awaiting,
  );

  const revenue = customers
    .map((company) => ({
      name: company.companyName,
      amount: moneyOf(company.id)?.invoicedMinor ?? 0,
    }))
    .filter((row) => row.amount > 0)
    .sort((a, b) => b.amount - a.amount);
  const revenueTotal = revenue.reduce((sum, row) => sum + row.amount, 0);
  const topRevenue = revenue.slice(0, 3);
  const otherRevenue = revenue
    .slice(3)
    .reduce((sum, row) => sum + row.amount, 0);
  const revenueShades = [
    chartColors.blue,
    chartColors.blueMid,
    chartColors.blueLight,
  ];

  const ready = loaded && insights !== null;

  return (
    <>
      <section className={styles.overview} aria-label="Customer overview">
        <div className={styles.metric}>
          <span>Active customers</span>
          <strong>
            {ready && total ? active : "—"}
            {ready && total > 0 && (
              <em className={styles.metricOf}> of {total}</em>
            )}
          </strong>
          <small>
            A job still open or opened in the last {customerActiveDays} days
          </small>
        </div>
        <div className={styles.metric}>
          <span>Owing{currency ? ` (${currency})` : ""}</span>
          <strong>{ready && currency ? money(owingTotal) : "—"}</strong>
          <small>
            {ready && currency
              ? `${owingCustomers} ${owingCustomers === 1 ? "customer owes" : "customers owe"} money`
              : "No invoices issued yet"}
          </small>
        </div>
        <div className={styles.metric}>
          <span>Quotes awaiting an answer</span>
          <strong>{ready ? quotes.awaiting : "—"}</strong>
          <small>Issued, and the customer has not replied</small>
        </div>
        <div className={styles.metric}>
          <span>No one to message</span>
          <strong>{total ? unreachable : "—"}</strong>
          <small>Companies with no contact switched on for messages</small>
        </div>
      </section>

      {ready && total > 0 && (
        <div className={charts.grid}>
          <section className={charts.card} aria-labelledby="activity-title">
            <h2 id="activity-title">Who is active</h2>
            <p className={charts.headline}>
              {active} of {total} customers have work in progress or recent jobs
            </p>
            <DonutChart
              centerLabel={`of ${total} active`}
              centerValue={String(active)}
              segments={[
                {
                  label: "Active",
                  value: active,
                  display: String(active),
                  color: chartColors.blue,
                },
                {
                  label: "Inactive",
                  value: total - active,
                  display: String(total - active),
                  color: chartColors.other,
                },
              ]}
            />
          </section>

          <section className={charts.card} aria-labelledby="quotes-title">
            <h2 id="quotes-title">What happens to our quotes</h2>
            <p className={charts.headline}>
              {quotes.sent
                ? `${quotes.sent} ${quotes.sent === 1 ? "quote" : "quotes"} issued to customers`
                : "No quotes issued yet"}
            </p>
            {quotes.sent > 0 && (
              <DonutChart
                centerLabel="accepted"
                centerValue={`${Math.round((quotes.accepted / quotes.sent) * 100)}%`}
                segments={[
                  {
                    label: "Accepted",
                    value: quotes.accepted,
                    display: String(quotes.accepted),
                    color: chartColors.good,
                  },
                  {
                    label: "Awaiting an answer",
                    value: quotes.awaiting,
                    display: String(quotes.awaiting),
                    color: chartColors.warning,
                  },
                  {
                    label: "Not accepted",
                    value: notAccepted,
                    display: String(notAccepted),
                    color: chartColors.other,
                  },
                ]}
              />
            )}
          </section>

          <section
            className={`${charts.card} ${charts.wide}`}
            aria-labelledby="revenue-title"
          >
            <div className={styles.rankingHeader}>
              <div>
                <h2 id="revenue-title">Revenue by customer</h2>
                <p className={charts.headline}>
                  {revenue.length
                    ? `${money(revenueTotal)} invoiced across ${revenue.length} ${revenue.length === 1 ? "customer" : "customers"}`
                    : "Nothing invoiced yet"}
                </p>
              </div>
              {currencies.length > 1 && (
                <div
                  className={ui.segmented}
                  role="group"
                  aria-label="Report currency"
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
            {revenue.length > 0 && (
              <DonutChart
                centerLabel={revenue.length === 1 ? "customer" : "customers"}
                centerValue={String(revenue.length)}
                segments={[
                  ...topRevenue.map((row, index) => ({
                    label: row.name,
                    value: row.amount,
                    display: money(row.amount),
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
        </div>
      )}
    </>
  );
}
