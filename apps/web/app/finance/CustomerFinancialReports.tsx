"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { listCustomerInsights, listCustomers } from "../customers/customerApi";
import type {
  CustomerCompany,
  CustomerInsight,
} from "../customers/customerApi";
import { formatMoney } from "../quotes/quoteApi";
import chart from "./finance.module.css";
import ui from "../jobs/jobs.module.css";
import customerStyles from "../customers/customerDirectory.module.css";
import styles from "./customerFinancialReports.module.css";

const pct = (part: number, whole: number) =>
  whole > 0 ? Math.max(0, Math.min(100, (part / whole) * 100)) : 0;

export function CustomerFinancialReports() {
  const [customers, setCustomers] = useState<CustomerCompany[]>([]);
  const [insights, setInsights] = useState<CustomerInsight[] | null>(null);
  const [currency, setCurrency] = useState("");

  useEffect(() => {
    Promise.all([listCustomers(""), listCustomerInsights()])
      .then(([companies, rows]) => {
        setCustomers(companies);
        setInsights(rows);
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
    for (const row of insights ?? []) {
      for (const entry of row.money) {
        totals.set(
          entry.currency,
          (totals.get(entry.currency) ?? 0) + entry.invoicedMinor,
        );
      }
    }
    return [...totals.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([code]) => code);
  }, [insights]);

  if (!insights || currencies.length === 0) return null;

  const byCompany = new Map(insights.map((row) => [row.companyId, row]));
  const money = (minor: number) => formatMoney(minor, currency);
  const ranked = customers
    .map((company) => {
      const entry = byCompany
        .get(company.id)
        ?.money.find((item) => item.currency === currency);
      return {
        company,
        invoiced: entry?.invoicedMinor ?? 0,
        owing: entry ? entry.invoicedMinor - entry.receivedMinor : 0,
      };
    })
    .filter((row) => row.invoiced > 0)
    .sort((a, b) => b.invoiced - a.invoiced);
  const topFive = ranked.slice(0, 5);
  const revenueTotal = ranked.reduce((total, row) => total + row.invoiced, 0);
  const topFiveTotal = topFive.reduce((total, row) => total + row.invoiced, 0);
  const owingTotal = ranked.reduce((total, row) => total + row.owing, 0);
  const topOwing = ranked
    .filter((row) => row.owing > 0)
    .sort((a, b) => b.owing - a.owing)
    .slice(0, 5);

  return (
    <section aria-label="Customer financial reports" className={styles.reports}>
      <h2>Customer reports</h2>
      <div className={customerStyles.rankingPair}>
        <section
          className={chart.chartCard}
          aria-labelledby="finance-revenue-title"
        >
          <div className={customerStyles.rankingHeader}>
            <div>
              <h2 id="finance-revenue-title">Customers by revenue</h2>
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
          {topFive.map((row) => (
            <div className={chart.row} key={row.company.id}>
              <div className={chart.rowHead}>
                <Link
                  className={customerStyles.companyLink}
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
                style={{ width: `${pct(row.invoiced, topFive[0].invoiced)}%` }}
                title={`Invoiced ${money(row.invoiced)}`}
              />
            </div>
          ))}
        </section>
        <section
          className={chart.chartCard}
          aria-labelledby="finance-owing-title"
        >
          <h2 id="finance-owing-title">Who owes you most</h2>
          <p className={chart.headline}>
            {topOwing.length
              ? `${money(owingTotal)} still to collect in ${currency}`
              : `Nobody owes anything in ${currency}`}
          </p>
          {topOwing.map((row) => (
            <div className={chart.row} key={row.company.id}>
              <div className={chart.rowHead}>
                <Link
                  className={customerStyles.companyLink}
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
    </section>
  );
}
