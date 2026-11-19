"use client";

import { useEffect, useMemo, useState } from "react";
import { getTeamPerformance } from "./performanceApi";
import type {
  MoneyFigure,
  TeamKey,
  TeamPerformance as Result,
} from "./performanceApi";
import styles from "../jobs/jobs.module.css";
import tiles from "../finance/finance.module.css";
import own from "./performance.module.css";
import { ErrorPopup } from "../ErrorPopup";
import { PerformanceTabs } from "./PerformanceTabs";

/** What each team's numbers are about, in words the staff use. */
const teamNames: Record<TeamKey, string> = {
  sales: "New business",
  customer_service: "Quotes",
  operations: "Shipments",
  finance: "Money in",
};

type Preset =
  | "today"
  | "yesterday"
  | "this_week"
  | "last_week"
  | "this_month"
  | "last_month"
  | "custom";

const presetLabels: Record<Preset, string> = {
  today: "Today",
  yesterday: "Yesterday",
  this_week: "This week",
  last_week: "Last week",
  this_month: "This month",
  last_month: "Last month",
  custom: "Choose dates",
};

const DAY = 86_400_000;
/** Ghana is on UTC, so UTC dates are the local days. */
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

function presetRange(preset: Exclude<Preset, "custom">): [string, string] {
  const now = Date.now();
  const today = iso(now);
  const monday = now - ((new Date(now).getUTCDay() + 6) % 7) * DAY;
  const firstOfMonth = `${today.slice(0, 8)}01`;
  switch (preset) {
    case "today":
      return [today, today];
    case "yesterday":
      return [iso(now - DAY), iso(now - DAY)];
    case "this_week":
      return [iso(monday), today];
    case "last_week":
      return [iso(monday - 7 * DAY), iso(monday - DAY)];
    case "this_month":
      return [firstOfMonth, today];
    case "last_month": {
      const lastDay = Date.parse(`${firstOfMonth}T00:00:00Z`) - DAY;
      return [`${iso(lastDay).slice(0, 8)}01`, iso(lastDay)];
    }
  }
}

/** "+3 vs before", "−2 vs before", "same as before". */
function change(current: number, previous: number) {
  const diff = current - previous;
  if (diff === 0) return "same as before";
  return `${diff > 0 ? "+" : "−"}${Math.abs(diff)} vs before`;
}

function money(minor: number, currency: string) {
  try {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(minor / 100);
  } catch {
    return `${currency} ${Math.round(minor / 100)}`;
  }
}

/** Adds money per currency across people. */
function sumMoney(figures: MoneyFigure[]): MoneyFigure {
  const byCurrency = new Map<string, { current: number; previous: number }>();
  for (const figure of figures) {
    for (const row of figure) {
      const sum = byCurrency.get(row.currency) ?? { current: 0, previous: 0 };
      byCurrency.set(row.currency, {
        current: sum.current + row.current,
        previous: sum.previous + row.previous,
      });
    }
  }
  return [...byCurrency.entries()]
    .map(([currency, sum]) => ({ currency, ...sum }))
    .sort((a, b) => a.currency.localeCompare(b.currency));
}

const moneyText = (figure: MoneyFigure) =>
  figure.filter((row) => row.current > 0).length === 0
    ? "—"
    : figure
        .filter((row) => row.current > 0)
        .map((row) => money(row.current, row.currency))
        .join(" · ");

export function TeamPerformance() {
  const [preset, setPreset] = useState<Preset>("this_month");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [team, setTeam] = useState<TeamKey | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const [from, to] =
    preset === "custom" ? [customFrom, customTo] : presetRange(preset);

  useEffect(() => {
    if (!from || !to) return;
    let active = true;
    setLoading(true);
    setError("");
    getTeamPerformance(from, to)
      .then((data) => {
        if (!active) return;
        setResult(data);
        setTeam((current) =>
          current && data.teams.some((t) => t.teamKey === current)
            ? current
            : (data.teams[0]?.teamKey ?? null),
        );
      })
      .catch((cause: unknown) => {
        if (active) {
          setError(
            cause instanceof Error
              ? cause.message
              : "Performance is unavailable",
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [from, to]);

  const columns = result?.teams.find((t) => t.teamKey === team)?.metrics ?? [];
  const people = useMemo(
    () =>
      result && team
        ? result.people.filter((person) => person.teams.includes(team))
        : [],
    [result, team],
  );
  const countTotal = (key: string) =>
    people.reduce(
      (sum, person) => ({
        current: sum.current + (person.metrics[key]?.current ?? 0),
        previous: sum.previous + (person.metrics[key]?.previous ?? 0),
      }),
      { current: 0, previous: 0 },
    );
  const sent = countTotal("quotes_sent").current;
  const accepted = countTotal("quotes_accepted").current;

  return (
    <main className={styles.page}>
      <PerformanceTabs active="/performance/team" />
      <header className={`${styles.header} ${own.topBar}`}>
        <h1 className={styles.title}>Team performance</h1>
        <div className={own.periodPicker}>
          <label className={styles.field}>
            Period
            <select
              onChange={(event) => setPreset(event.target.value as Preset)}
              value={preset}
            >
              {(Object.keys(presetLabels) as Preset[]).map((key) => (
                <option key={key} value={key}>
                  {presetLabels[key]}
                </option>
              ))}
            </select>
          </label>
          {preset === "custom" && (
            <>
              <label className={styles.field}>
                From
                <input
                  onChange={(event) => setCustomFrom(event.target.value)}
                  type="date"
                  value={customFrom}
                />
              </label>
              <label className={styles.field}>
                To
                <input
                  onChange={(event) => setCustomTo(event.target.value)}
                  type="date"
                  value={customTo}
                />
              </label>
            </>
          )}
        </div>
      </header>

      <ErrorPopup message={error} />
      {loading && !result && <p role="status">Counting…</p>}

      {result && (
        <>
          {result.teams.length > 1 && (
            <nav className={styles.tabs} aria-label="Teams">
              {result.teams.map((entry) => (
                <button
                  aria-pressed={entry.teamKey === team}
                  className={`${styles.tab} ${own.teamTab}${entry.teamKey === team ? ` ${styles.tabActive}` : ""}`}
                  key={entry.teamKey}
                  onClick={() => setTeam(entry.teamKey)}
                  type="button"
                >
                  {teamNames[entry.teamKey]}
                </button>
              ))}
            </nav>
          )}

          {people.length === 0 ? (
            <p className={styles.muted}>Nobody on this team yet.</p>
          ) : (
            <>
              <section
                className={tiles.kpis}
                aria-label={`${team ? teamNames[team] : ""} totals`}
              >
                {columns.map((column) => {
                  if (column.kind === "money") {
                    const total = sumMoney(
                      people.map((p) => p.money[column.key] ?? []),
                    );
                    return (
                      <div className={tiles.kpi} key={column.key}>
                        <span>{column.label}</span>
                        <strong>{moneyText(total)}</strong>
                        <small>
                          {total.some((row) => row.previous > 0)
                            ? `${total
                                .filter((row) => row.previous > 0)
                                .map((row) => money(row.previous, row.currency))
                                .join(" · ")} before`
                            : "none before"}
                        </small>
                      </div>
                    );
                  }
                  const total = countTotal(column.key);
                  return (
                    <div className={tiles.kpi} key={column.key}>
                      <span>{column.label}</span>
                      <strong>{total.current}</strong>
                      <small>{change(total.current, total.previous)}</small>
                    </div>
                  );
                })}
                {team === "customer_service" && sent > 0 && (
                  <div className={tiles.kpi}>
                    <span>Win rate</span>
                    <strong>{Math.round((accepted / sent) * 100)}%</strong>
                    <small>
                      {accepted} of {sent} quotes accepted
                    </small>
                  </div>
                )}
              </section>

              <div className={styles.tableScroll}>
                <table className={styles.table} data-cards>
                  <thead>
                    <tr>
                      <th scope="col">Person</th>
                      {columns.map((column) => (
                        <th key={column.key} scope="col">
                          {column.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {people.map((person) => (
                      <tr key={person.userId}>
                        <th scope="row">
                          {person.name}
                          {person.mine ? " (you)" : ""}
                        </th>
                        {columns.map((column) => {
                          if (column.kind === "money") {
                            return (
                              <td data-label={column.label} key={column.key}>
                                {moneyText(person.money[column.key] ?? [])}
                              </td>
                            );
                          }
                          return (
                            <td data-label={column.label} key={column.key}>
                              {person.metrics[column.key]?.current ?? 0}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </main>
  );
}
