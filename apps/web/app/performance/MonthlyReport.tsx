"use client";

import { useEffect, useState } from "react";
import { getMonthlyReport, teamLabels } from "./performanceApi";
import type { MonthlyReport as Month } from "./performanceApi";
import { PerformanceTabs } from "./PerformanceTabs";
import styles from "../jobs/jobs.module.css";
import own from "./performance.module.css";
import { ErrorPopup } from "../ErrorPopup";

/** "16 Nov" for a day; "Week of 16 Nov" for a week. */
function entryDate(period: string, periodStart: string) {
  const day = new Date(`${periodStart}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
  return period === "weekly" ? `Week of ${day}` : day;
}

/** The month, generated from the daily and weekly reports sent in it. */
export function MonthlyReport() {
  const [month, setMonth] = useState(() =>
    new Date().toISOString().slice(0, 7),
  );
  const [result, setResult] = useState<Month | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!month) return;
    let active = true;
    setError("");
    getMonthlyReport(month)
      .then((value) => {
        if (active) setResult(value);
      })
      .catch((cause: unknown) => {
        if (active)
          setError(
            cause instanceof Error
              ? cause.message
              : "The report is unavailable",
          );
      });
    return () => {
      active = false;
    };
  }, [month]);

  const withEntries = result?.people.filter((p) => p.entries.length) ?? [];

  return (
    <main className={styles.page}>
      <PerformanceTabs active="/performance/monthly" />
      <header className={`${styles.header} ${own.topBar}`}>
        <h1 className={styles.title}>Monthly report</h1>
        <div className={own.periodPicker}>
          <label className={styles.field}>
            Month
            <input
              max={new Date().toISOString().slice(0, 7)}
              onChange={(event) => setMonth(event.target.value)}
              type="month"
              value={month}
            />
          </label>
        </div>
      </header>

      <ErrorPopup message={error} />
      {!result && !error && <p role="status">Building the report…</p>}

      {result &&
        (result.people.length === 0 ? (
          <p className={styles.muted}>No team members to report on.</p>
        ) : (
          <>
            <div className={styles.tableScroll}>
              <table className={styles.table} data-cards>
                <thead>
                  <tr>
                    <th scope="col">Person</th>
                    <th scope="col">Daily reports</th>
                    <th scope="col">Weekly reports</th>
                    <th scope="col">Tasks done</th>
                    <th scope="col">Overdue</th>
                  </tr>
                </thead>
                <tbody>
                  {result.people.map((person) => (
                    <tr key={person.userId}>
                      <th scope="row">
                        {person.name}
                        {person.mine ? " (you)" : ""}
                        <br />
                        <small>
                          {person.teams
                            .map((team) => teamLabels[team])
                            .join(", ")}
                        </small>
                      </th>
                      <td data-label="Daily reports">{person.dailyCount}</td>
                      <td data-label="Weekly reports">{person.weeklyCount}</td>
                      <td data-label="Tasks done">
                        {person.completedCount} of {person.newCount}
                      </td>
                      <td data-label="Overdue">
                        {person.overdueCount > 0 ? person.overdueCount : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <h2>Blockers and notes</h2>
            {withEntries.length === 0 ? (
              <p className={styles.muted}>None reported this month.</p>
            ) : (
              <div className={styles.grid}>
                {withEntries.map((person) => (
                  <section
                    aria-label={person.name}
                    className={styles.card}
                    key={person.userId}
                  >
                    <h3>{person.name}</h3>
                    <ul className={own.entries}>
                      {person.entries.map((entry) => (
                        <li key={`${entry.period}-${entry.periodStart}`}>
                          <small className={styles.muted}>
                            {entryDate(entry.period, entry.periodStart)}
                          </small>
                          {entry.blockers && (
                            <p>
                              <strong>{entry.blockers}</strong>
                            </p>
                          )}
                          {entry.notes && <p>{entry.notes}</p>}
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            )}
          </>
        ))}
    </main>
  );
}
