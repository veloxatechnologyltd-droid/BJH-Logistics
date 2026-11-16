"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import {
  getPreview,
  getRoster,
  listReports,
  submitReport,
  teamLabels,
} from "./performanceApi";
import type {
  Period,
  PerformanceReport,
  ReportPreview,
  Roster,
  RosterSlice,
  TeamKey,
} from "./performanceApi";
import styles from "../jobs/jobs.module.css";
import { ErrorPopup } from "../ErrorPopup";
import { PerformanceTabs } from "./PerformanceTabs";

const periodLabels: Record<Period, string> = {
  daily: "Daily",
  weekly: "Weekly",
};

/** "16 Nov 2026" for a day; "Week of 16 Nov 2026" for a week. */
function periodText(report: Pick<PerformanceReport, "period" | "periodStart">) {
  const day = new Date(`${report.periodStart}T00:00:00Z`).toLocaleDateString(
    "en-GB",
    { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" },
  );
  return report.period === "weekly" ? `Week of ${day}` : day;
}

/** "3 of 8 have sent it", then who has not. */
function RosterCard({ title, slice }: { title: string; slice: RosterSlice }) {
  return (
    <section className={styles.card} aria-label={title}>
      <h2>{title}</h2>
      <p>
        <strong>
          {slice.reported} of {slice.expected}
        </strong>{" "}
        have sent their report.
      </p>
      {slice.missing.length === 0 ? (
        <p className={styles.muted}>Everyone has reported.</p>
      ) : (
        <p>
          <span className={styles.muted}>Not yet: </span>
          {slice.missing
            .map(
              (person) =>
                `${person.name} (${person.teams.map((team) => teamLabels[team]).join(", ")})`,
            )
            .join(", ")}
        </p>
      )}
    </section>
  );
}

export function PerformanceReports() {
  const [reports, setReports] = useState<PerformanceReport[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [teamFilter, setTeamFilter] = useState("");
  const [periodFilter, setPeriodFilter] = useState("");
  const [blockerFilter, setBlockerFilter] = useState("");
  const [roster, setRoster] = useState<Roster | null>(null);
  const [reload, setReload] = useState(0);

  const [writing, setWriting] = useState<Period | null>(null);
  const [preview, setPreview] = useState<ReportPreview | null>(null);
  const [team, setTeam] = useState<TeamKey | "">("");
  const [blockers, setBlockers] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    let active = true;
    setState("loading");
    listReports({
      teamKey: teamFilter,
      period: periodFilter,
      blockers: blockerFilter,
    })
      .then((result) => {
        if (active) {
          setReports(result);
          setState("ready");
        }
      })
      .catch((cause: unknown) => {
        if (active) {
          setError(
            cause instanceof Error ? cause.message : "Reports are unavailable",
          );
          setState("error");
        }
      });
    return () => {
      active = false;
    };
  }, [teamFilter, periodFilter, blockerFilter, reload]);

  // Only the super admin gets a roster; for everyone else it is empty.
  useEffect(() => {
    getRoster()
      .then(setRoster)
      .catch(() => setRoster(null));
  }, [reload]);

  async function startReport(period: Period) {
    setError("");
    try {
      const result = await getPreview(period);
      setPreview(result);
      setTeam(result.teams.length > 1 ? "" : result.teamKey);
      setBlockers("");
      setNotes("");
      setWriting(period);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "The report could not open",
      );
    }
  }

  async function send(event: FormEvent) {
    event.preventDefault();
    if (!writing) return;
    setError("");
    try {
      await submitReport({
        period: writing,
        teamKey: team || undefined,
        blockers: blockers.trim() || undefined,
        notes: notes.trim() || undefined,
      });
      setWriting(null);
      setReload((count) => count + 1);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "The report was not sent",
      );
    }
  }

  return (
    <main className={styles.page}>
      <PerformanceTabs active="/performance/reports" />
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Daily & weekly reports</h1>
          <p className={styles.muted}>
            Each person sends one report for the day and one for the week. The
            numbers come from your tasks; you add what is blocking you and a
            short note.
          </p>
        </div>
        {!writing && (
          <div className={styles.formActions}>
            <button
              className={styles.secondaryButton}
              onClick={() => void startReport("weekly")}
              type="button"
            >
              Weekly report
            </button>
            <button
              className={styles.button}
              onClick={() => void startReport("daily")}
              type="button"
            >
              Daily report
            </button>
          </div>
        )}
      </header>

      <ErrorPopup message={error} />

      {roster?.manager && roster.daily && roster.weekly && (
        <div className={styles.grid}>
          <RosterCard
            slice={roster.daily}
            title={`Today · ${periodText({ period: "daily", periodStart: roster.daily.periodStart })}`}
          />
          <RosterCard
            slice={roster.weekly}
            title={periodText({
              period: "weekly",
              periodStart: roster.weekly.periodStart,
            })}
          />
        </div>
      )}

      {writing && preview && (
        <form
          className={`${styles.form} ${styles.quickUpdateForm}`}
          onSubmit={(event) => void send(event)}
        >
          <h2>
            {periodLabels[writing]} report ·{" "}
            {periodText({ period: writing, periodStart: preview.periodStart })}
          </h2>
          {preview.submitted ? (
            <p role="status">
              You have already sent this {writing === "daily" ? "day" : "week"}
              &apos;s report. It cannot be sent twice.
            </p>
          ) : (
            <>
              <p className={styles.muted}>
                From your tasks: <strong>{preview.newCount}</strong> new,{" "}
                <strong>{preview.completedCount}</strong> completed,{" "}
                <strong>{preview.overdueCount}</strong> overdue. These are
                counted for you when you send.
              </p>
              {preview.teams.length > 1 && (
                <label className={styles.field}>
                  Team
                  <select
                    onChange={(event) => setTeam(event.target.value as TeamKey)}
                    required
                    value={team}
                  >
                    <option value="">Choose a team</option>
                    {preview.teams.map((item) => (
                      <option key={item} value={item}>
                        {teamLabels[item]}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label className={styles.field}>
                Blockers (leave empty if none)
                <textarea
                  maxLength={2000}
                  onChange={(event) => setBlockers(event.target.value)}
                  rows={3}
                  value={blockers}
                />
              </label>
              <label className={styles.field}>
                Note (optional)
                <textarea
                  maxLength={2000}
                  onChange={(event) => setNotes(event.target.value)}
                  rows={3}
                  value={notes}
                />
              </label>
            </>
          )}
          <div className={styles.formActions}>
            {!preview.submitted && (
              <button className={styles.button} type="submit">
                Send report
              </button>
            )}
            <button
              className={styles.secondaryButton}
              onClick={() => setWriting(null)}
              type="button"
            >
              {preview.submitted ? "Close" : "Cancel"}
            </button>
          </div>
        </form>
      )}

      <div className={styles.filters}>
        <label className={styles.field}>
          Team
          <select
            onChange={(event) => setTeamFilter(event.target.value)}
            value={teamFilter}
          >
            <option value="">All teams</option>
            {(Object.keys(teamLabels) as TeamKey[]).map((item) => (
              <option key={item} value={item}>
                {teamLabels[item]}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          Report
          <select
            onChange={(event) => setPeriodFilter(event.target.value)}
            value={periodFilter}
          >
            <option value="">Daily and weekly</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
          </select>
        </label>
        <label className={styles.field}>
          Blockers
          <select
            onChange={(event) => setBlockerFilter(event.target.value)}
            value={blockerFilter}
          >
            <option value="">All reports</option>
            <option value="yes">Only with blockers</option>
          </select>
        </label>
      </div>

      {state === "loading" && <p role="status">Loading reports…</p>}
      {state === "ready" &&
        (reports.length === 0 ? (
          <p className={styles.muted}>
            No reports yet. Send the first one with the buttons above.
          </p>
        ) : (
          <div className={styles.tableScroll}>
            <table className={styles.table} data-cards>
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">Team / person</th>
                  <th scope="col">Report</th>
                  <th scope="col">New</th>
                  <th scope="col">Completed</th>
                  <th scope="col">Overdue</th>
                  <th scope="col">Blockers</th>
                </tr>
              </thead>
              <tbody>
                {reports.map((report) => (
                  <tr key={report.id}>
                    <th scope="row">{periodText(report)}</th>
                    <td data-label="Team / person">
                      {teamLabels[report.teamKey]}
                      <br />
                      <small>
                        {report.authorName}
                        {report.mine ? " (you)" : ""}
                      </small>
                    </td>
                    <td data-label="Report">{periodLabels[report.period]}</td>
                    <td data-label="New">{report.newCount}</td>
                    <td data-label="Completed">{report.completedCount}</td>
                    <td data-label="Overdue">
                      {report.overdueCount > 0 ? report.overdueCount : "—"}
                    </td>
                    <td data-label="Blockers" data-wide>
                      {report.blockers ? (
                        <strong>{report.blockers}</strong>
                      ) : (
                        "None"
                      )}
                      {report.notes && (
                        <>
                          <br />
                          <small>{report.notes}</small>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
    </main>
  );
}
