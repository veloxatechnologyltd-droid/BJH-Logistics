"use client";

import { useEffect, useState } from "react";
import { canWorkFinance } from "../auth/roleAccess";
import { useStaffAccess } from "../auth/useStaffAccess";
import styles from "../jobs/jobs.module.css";
import { ReportLibrary } from "./ReportLibrary";
import reportStyles from "./reports.module.css";

type Preset = "day" | "week" | "month" | "year" | "custom";
type Range = { from: string; to: string };

const dateString = (date: Date) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Accra",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
};

function rangeFor(preset: Exclude<Preset, "custom">, now = new Date()): Range {
  const [year, month, day] = dateString(now).split("-").map(Number);
  const end = new Date(Date.UTC(year, month - 1, day));
  const start = new Date(end);
  if (preset === "week")
    start.setUTCDate(end.getUTCDate() - ((end.getUTCDay() + 6) % 7));
  else if (preset === "month") start.setUTCDate(1);
  else if (preset === "year") start.setUTCMonth(0, 1);
  return { from: dateString(start), to: dateString(end) };
}

export function ReportsHome() {
  const { roles } = useStaffAccess();
  const isStaff = roles.length > 0;
  const [preset, setPreset] = useState<Preset>("month");
  const showFinance = canWorkFinance(roles);
  const [range, setRange] = useState<Range>({ from: "", to: "" });

  useEffect(() => setRange(rangeFor("month")), []);

  const setPeriod = (value: Exclude<Preset, "custom">) => {
    setPreset(value);
    setRange(rangeFor(value));
  };

  if (!isStaff)
    return (
      <main className={styles.page}>
        <h1 className={styles.title}>Reports are for staff</h1>
      </main>
    );

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Reports</h1>
          <p className={styles.muted}>
            Sales, customer service, operations
            {showFinance ? " and finance" : ""}: choose the dates, then open a
            report as a PDF to read, print or save.
          </p>
        </div>
      </header>
      <section className={styles.card} aria-label="Report date range">
        <div className={reportStyles.controls}>
          <div
            className={reportStyles.presets}
            aria-label="Date period"
            role="group"
          >
            {(["day", "week", "month", "year"] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={preset === value}
                className={preset === value ? reportStyles.activePreset : ""}
                onClick={() => setPeriod(value)}
              >
                {value === "day"
                  ? "Today"
                  : value === "week"
                    ? "This week"
                    : value === "month"
                      ? "This month"
                      : "This year"}
              </button>
            ))}
          </div>
          <label className={styles.field}>
            From
            <input
              type="date"
              value={range.from}
              onChange={(event) => {
                setPreset("custom");
                setRange((current) => ({
                  ...current,
                  from: event.target.value,
                }));
              }}
            />
          </label>
          <label className={styles.field}>
            To
            <input
              type="date"
              value={range.to}
              onChange={(event) => {
                setPreset("custom");
                setRange((current) => ({ ...current, to: event.target.value }));
              }}
            />
          </label>
        </div>
        {range.from > range.to && (
          <p className={styles.error}>
            The start date must be on or before the end date.
          </p>
        )}
      </section>
      <ReportLibrary
        from={range.from}
        to={range.to}
        showFinance={showFinance}
      />
    </main>
  );
}
