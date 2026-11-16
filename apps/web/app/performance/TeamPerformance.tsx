"use client";

import { useEffect, useMemo, useState } from "react";
import { getTeamPerformance, teamLabels } from "./performanceApi";
import type { TeamKey, TeamPerformance as Result } from "./performanceApi";
import styles from "../jobs/jobs.module.css";
import tiles from "../finance/finance.module.css";
import own from "./performance.module.css";
import { ErrorPopup } from "../ErrorPopup";
import { PerformanceTabs } from "./PerformanceTabs";

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

/** The days a preset covers, counted in Ghana time. */
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

const dayText = (value: string) =>
  new Date(`${value}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });

const rangeText = (from: string, to: string) =>
  from === to ? dayText(from) : `${dayText(from)} to ${dayText(to)}`;

/** "+3 on the previous period", "2 fewer", "same as before". */
function change(current: number, previous: number) {
  const diff = current - previous;
  if (diff === 0) return "same as the period before";
  return diff > 0
    ? `${diff} more than the period before`
    : `${-diff} fewer than the period before`;
}

function money(minor: number, currency: string) {
  try {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency,
    }).format(minor / 100);
  } catch {
    return `${currency} ${(minor / 100).toFixed(2)}`;
  }
}

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

  // Team totals for the tiles.
  const totals = columns.map((column) => {
    let current = 0;
    let previous = 0;
    for (const person of people) {
      current += person.metrics[column.key]?.current ?? 0;
      previous += person.metrics[column.key]?.previous ?? 0;
    }
    return { ...column, current, previous };
  });
  const collected = new Map<string, { current: number; previous: number }>();
  for (const person of people) {
    for (const row of person.collected) {
      const sum = collected.get(row.currency) ?? { current: 0, previous: 0 };
      collected.set(row.currency, {
        current: sum.current + row.current,
        previous: sum.previous + row.previous,
      });
    }
  }
  const total = (key: string) => totals.find((t) => t.key === key);
  const accepted = total("quotes_accepted")?.current ?? 0;
  const rejected = total("quotes_rejected")?.current ?? 0;

  return (
    <main className={styles.page}>
      <PerformanceTabs active="/performance" />
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Team performance</h1>
          <p className={styles.muted}>
            {result && !result.manager
              ? "Your own work, counted from what you did in the system."
              : "What each member of staff has done, counted from their own work in the system: nobody types these numbers in."}
          </p>
        </div>
      </header>

      <div className={styles.filters}>
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

      <ErrorPopup message={error} />
      {loading && <p role="status">Counting…</p>}

      {result && (
        <>
          <p className={styles.muted}>
            {rangeText(result.from, result.to)}, compared with{" "}
            {rangeText(result.previousFrom, result.previousTo)}.
          </p>

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
                  {teamLabels[entry.teamKey]}
                </button>
              ))}
            </nav>
          )}

          {people.length === 0 ? (
            <p className={styles.muted}>
              Nobody on this team yet. Give staff their roles in Settings.
            </p>
          ) : (
            <>
              <section
                className={tiles.kpis}
                aria-label={`${team ? teamLabels[team] : ""} totals`}
              >
                {totals.map((item) => (
                  <div className={tiles.kpi} key={item.key}>
                    <span>{item.label}</span>
                    <strong>{item.current}</strong>
                    <small>{change(item.current, item.previous)}</small>
                  </div>
                ))}
                {team === "customer_service" && accepted + rejected > 0 && (
                  <div className={tiles.kpi}>
                    <span>Quote win rate</span>
                    <strong>
                      {Math.round((accepted / (accepted + rejected)) * 100)}%
                    </strong>
                    <small>
                      {accepted} accepted of {accepted + rejected} decided
                    </small>
                  </div>
                )}
                {team === "finance" &&
                  [...collected.entries()].map(([currency, sum]) => (
                    <div className={tiles.kpi} key={currency}>
                      <span>Collected ({currency})</span>
                      <strong>{money(sum.current, currency)}</strong>
                      <small>
                        {money(sum.previous, currency)} the period before
                      </small>
                    </div>
                  ))}
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
                      {team === "finance" && <th scope="col">Collected</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {people.map((person) => (
                      <tr key={person.userId}>
                        <th scope="row">
                          {person.name}
                          {person.mine ? " (you)" : ""}
                          <br />
                          <small>{person.roles.join(", ")}</small>
                        </th>
                        {columns.map((column) => {
                          const value = person.metrics[column.key] ?? {
                            current: 0,
                            previous: 0,
                          };
                          return (
                            <td data-label={column.label} key={column.key}>
                              <strong>{value.current}</strong>
                              <br />
                              <small>was {value.previous}</small>
                            </td>
                          );
                        })}
                        {team === "finance" && (
                          <td data-label="Collected">
                            {person.collected.length === 0
                              ? "—"
                              : person.collected
                                  .map((row) =>
                                    money(row.current, row.currency),
                                  )
                                  .join(", ")}
                          </td>
                        )}
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
