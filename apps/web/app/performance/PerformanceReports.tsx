"use client";

import { useEffect, useState } from "react";
import { milestoneTemplates } from "@bjh/contracts";
import {
  departmentLabels,
  getPreview,
  getRoster,
  jobUpdateStatusLabels,
  listReports,
  teamLabels,
} from "./performanceApi";
import type {
  ActivityItem,
  Period,
  PerformanceReport,
  ReportActivity,
  ReportPreview,
  Roster,
  TeamKey,
} from "./performanceApi";
import styles from "../jobs/jobs.module.css";
import own from "./performance.module.css";
import { ErrorPopup } from "../ErrorPopup";
import { PerformanceTabs } from "./PerformanceTabs";
import { WriteReport } from "./ReportForms";

const periodLabels: Record<Period, string> = {
  daily: "Daily",
  weekly: "Weekly",
};

const milestoneLabels = new Map(
  Object.values(milestoneTemplates)
    .flat()
    .map((milestone) => [milestone.key, milestone.label]),
);

/** Ghana is on UTC, so UTC dates and times are the local ones. */
function dayText(isoDay: string, weekday = false) {
  return new Date(`${isoDay}T00:00:00Z`).toLocaleDateString("en-GB", {
    ...(weekday ? { weekday: "long" as const } : {}),
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** "18 Nov 2026" for a day; "Week of 16 Nov 2026" for a week. */
function periodText(report: Pick<PerformanceReport, "period" | "periodStart">) {
  const day = dayText(report.periodStart);
  return report.period === "weekly" ? `Week of ${day}` : day;
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

/** One recorded item as a sentence a manager can read. */
function itemText(item: ActivityItem) {
  const ref = item.reference ?? "";
  const party = item.party ?? "";
  const forParty = party ? ` for ${party}` : "";
  const amount =
    item.amountMinor !== null && item.currency
      ? ` · ${money(item.amountMinor, item.currency)}`
      : "";
  switch (item.kind) {
    case "lead_added":
      return `Added a new lead: ${party || "unnamed company"}`;
    case "customer_won":
      return `Won ${party || "a lead"} as a customer`;
    case "quote_sent":
      return `Sent quote ${ref}${party ? ` to ${party}` : ""}${amount}`;
    case "quote_accepted":
      return `Quote ${ref} accepted${party ? ` by ${party}` : ""}${amount}`;
    case "quote_lost":
      return `Quote ${ref} lost${party ? ` (${party})` : ""}`;
    case "job_taken":
      return `Took on job ${ref}${forParty}`;
    case "job_completed":
      return `Completed job ${ref}${forParty}`;
    case "milestone":
      return `${milestoneLabels.get(item.detail ?? "") ?? "Milestone updated"} on ${ref}${party ? ` (${party})` : ""}`;
    case "task_done":
      return `Finished task: ${item.detail ?? ""}${ref ? ` (${ref})` : ""}`;
    case "invoice_sent":
      return `Sent invoice ${ref}${party ? ` to ${party}` : ""}${amount}`;
    case "payment_recorded":
      return `Recorded a payment on ${ref}${party ? ` (${party})` : ""}${amount}`;
  }
}

function itemTime(at: string, period: Period) {
  return new Date(at).toLocaleString("en-GB", {
    ...(period === "weekly" ? { weekday: "short" as const } : {}),
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  });
}

/** The results and the items behind them, as recorded by the system. */
function Recorded({
  activity,
  period,
}: {
  activity: ReportActivity;
  period: Period;
}) {
  const [all, setAll] = useState(false);
  const before = period === "daily" ? "yesterday" : "last week";
  const shown = all ? activity.items : activity.items.slice(0, 8);
  return (
    <>
      <dl className={own.counts}>
        {activity.metrics.map((metric) => (
          <div className={own.count} key={metric.key}>
            <dt>{metric.label}</dt>
            <dd>
              {metric.kind === "count"
                ? metric.current
                : (metric.money ?? []).some((row) => row.current > 0)
                  ? (metric.money ?? [])
                      .filter((row) => row.current > 0)
                      .map((row) => money(row.current, row.currency))
                      .join(" · ")
                  : "—"}
            </dd>
            <span className={own.before}>
              {before}:{" "}
              {metric.kind === "count"
                ? metric.previous
                : (metric.money ?? []).some((row) => row.previous > 0)
                  ? (metric.money ?? [])
                      .filter((row) => row.previous > 0)
                      .map((row) => money(row.previous, row.currency))
                      .join(" · ")
                  : "—"}
            </span>
          </div>
        ))}
      </dl>
      {activity.items.length === 0 ? (
        <p className={styles.muted}>
          Nothing recorded in the system for this{" "}
          {period === "daily" ? "day" : "week"} yet.
        </p>
      ) : (
        <>
          <ol className={own.timeline}>
            {shown.map((item, index) => (
              <li key={`${item.at}-${index}`}>
                <time dateTime={item.at}>{itemTime(item.at, period)}</time>
                <span>{itemText(item)}</span>
              </li>
            ))}
          </ol>
          {activity.items.length > shown.length && (
            <button
              className={own.linkButton}
              onClick={() => setAll(true)}
              type="button"
            >
              Show all {activity.items.length}
            </button>
          )}
        </>
      )}
    </>
  );
}

/** A sent report, read as a document. */
function ReportView({ report }: { report: PerformanceReport }) {
  const weekly = report.period === "weekly";
  const sections: Array<[string, string | null]> = [
    [weekly ? "Progress this week" : "What they worked on", report.summary],
    ["Customers or shipments to flag", report.notes],
    ["Blockers", report.blockers],
    [
      report.kpiTarget
        ? "Next action, responsible person and follow-up"
        : report.period === "daily"
          ? "Plan for tomorrow"
          : "Plan for next week",
      report.plan,
    ],
  ];
  return (
    <div className={own.reportBody}>
      {report.jobUpdates?.map((update, index) => (
        <section className={own.jobUpdate} key={index}>
          <h4>
            {update.jobReference ?? "Not a job yet"}
            {update.client ? ` · ${update.client}` : ""} ·{" "}
            {jobUpdateStatusLabels[update.status]}
          </h4>
          <p className={own.prose}>{update.workDone}</p>
          <p>
            <strong>Next:</strong> {update.nextAction}
            {update.nextActionName ? ` · ${update.nextActionName}` : ""}
            {update.followUpDate ? ` · by ${dayText(update.followUpDate)}` : ""}
          </p>
          {(update.agreedDeadline || update.evidence) && (
            <p className={styles.muted}>
              {[
                update.agreedDeadline && `Deadline ${update.agreedDeadline}`,
                update.evidence && `Evidence: ${update.evidence}`,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          )}
        </section>
      ))}
      {sections
        .filter(([, text]) => text)
        .map(([title, text]) => (
          <section key={title}>
            <h4>{title}</h4>
            <p className={own.prose}>{text}</p>
          </section>
        ))}
      {report.kpiTarget && (
        <section>
          <h4>
            {report.department
              ? `${departmentLabels[report.department]} figure`
              : "Department figure"}
          </h4>
          <p>
            Target {report.kpiTarget} · Actual {report.kpiActual} · Action{" "}
            {report.kpiAction}
          </p>
        </section>
      )}
      <section>
        <h4>Tasks</h4>
        <p>
          {report.openingActive !== null &&
            `${report.openingActive} open at the start · `}
          {report.newCount} new · {report.completedCount} completed ·{" "}
          {report.closingActive !== null &&
            `${report.closingActive} open at the end · `}
          {report.overdueCount} overdue
        </p>
      </section>
      {report.activity && (
        <section>
          <h4>Recorded in the system</h4>
          <Recorded activity={report.activity} period={report.period} />
        </section>
      )}
    </div>
  );
}

function ReportCard({ report }: { report: PerformanceReport }) {
  const [open, setOpen] = useState(false);
  const recorded = report.activity?.items.length ?? 0;
  return (
    <article className={`${styles.card} ${own.reportCardItem}`}>
      <header className={own.reportHead}>
        <div>
          <h3>
            {report.authorName}
            {report.mine ? " (you)" : ""}
          </h3>
          <p className={styles.muted}>
            {report.department
              ? departmentLabels[report.department]
              : teamLabels[report.teamKey]}{" "}
            · {periodLabels[report.period]} · {periodText(report)}
          </p>
        </div>
        <div className={own.flags}>
          {report.blockers && <span className={styles.badge}>Blocked</span>}
          {report.activity && (
            <span className={styles.badge}>{recorded} recorded</span>
          )}
        </div>
      </header>
      {!open && (
        <p className={own.excerpt}>
          {report.jobUpdates
            ? report.jobUpdates
                .map(
                  (update) =>
                    `${update.jobReference ?? update.client ?? "Update"}: ${update.workDone}`,
                )
                .join(" · ")
            : (report.summary ?? report.notes ?? "No summary written.")}
        </p>
      )}
      {open && <ReportView report={report} />}
      <button
        className={own.linkButton}
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        {open ? "Close report" : "Open full report"}
      </button>
    </article>
  );
}

type Step =
  | { kind: "idle" }
  | { kind: "choose"; daily?: ReportPreview; weekly?: ReportPreview }
  | { kind: "menu"; preview: ReportPreview }
  | { kind: "system"; preview: ReportPreview }
  | { kind: "write"; preview: ReportPreview };

export function PerformanceReports() {
  const [reports, setReports] = useState<PerformanceReport[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [sent, setSent] = useState("");
  const [teamFilter, setTeamFilter] = useState("");
  const [periodFilter, setPeriodFilter] = useState("");
  const [blockerFilter, setBlockerFilter] = useState("");
  const [roster, setRoster] = useState<Roster | null>(null);
  const [reload, setReload] = useState(0);

  const [step, setStep] = useState<Step>({ kind: "idle" });
  const [team, setTeam] = useState<TeamKey | "">("");

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

  /** Opens the choice of daily or weekly, with what each would cover. */
  async function choose(teamKey?: TeamKey) {
    setError("");
    setSent("");
    try {
      const [daily, weekly] = await Promise.all([
        getPreview("daily", teamKey),
        getPreview("weekly", teamKey),
      ]);
      setTeam(daily.teamKey);
      setStep({ kind: "choose", daily, weekly });
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "The report could not open",
      );
    }
  }

  /** A new report for this period: what to do first. */
  function pick(preview: ReportPreview) {
    setStep({ kind: "menu", preview });
  }

  function reportSent(period: Period) {
    setSent(
      `Your ${period === "daily" ? "daily" : "weekly"} report has been sent.`,
    );
    setStep({ kind: "idle" });
    setReload((count) => count + 1);
  }

  const canReport = roster !== null && !roster.manager;

  // Generating a report is a focused flow: one screen at a time, nothing else.
  if (step.kind !== "idle") {
    const preview = step.kind === "choose" ? null : step.preview;
    const title = preview
      ? `${periodLabels[preview.period]} report · ${
          preview.period === "daily"
            ? dayText(preview.periodStart, true)
            : periodText(preview)
        }`
      : "Generate report";
    const back = () =>
      step.kind === "choose"
        ? setStep({ kind: "idle" })
        : step.kind === "menu"
          ? void choose(team || undefined)
          : setStep({ kind: "menu", preview: step.preview });
    return (
      <main className={`${styles.page} ${own.flow}`}>
        <div className={own.flowTop}>
          <button className={own.linkButton} onClick={back} type="button">
            ← Back
          </button>
          <button
            className={own.linkButton}
            onClick={() => setStep({ kind: "idle" })}
            type="button"
          >
            Cancel
          </button>
        </div>
        <p className={own.flowLabel}>{title}</p>
        <ErrorPopup message={error} />

        {step.kind === "choose" && step.daily && step.weekly && (
          <section className={own.screen}>
            <h1 className={styles.title}>Which report?</h1>
            {step.daily.teams.length > 1 && (
              <label className={styles.field}>
                Team
                <select
                  onChange={(event) =>
                    void choose(event.target.value as TeamKey)
                  }
                  value={team}
                >
                  {step.daily.teams.map((item) => (
                    <option key={item} value={item}>
                      {teamLabels[item]}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <div className={own.choices}>
              {[step.daily, step.weekly].map((option) => (
                <button
                  className={own.choice}
                  key={option.period}
                  onClick={() => pick(option)}
                  type="button"
                >
                  <strong>{periodLabels[option.period]} report</strong>
                  <span>
                    {option.period === "daily"
                      ? `Today, ${dayText(option.periodStart, true)}`
                      : `This week, from ${dayText(option.periodStart, true)}`}
                  </span>
                  {option.submitted && (
                    <span className={own.choiceNote}>
                      You sent one at{" "}
                      {itemTime(option.submitted.createdAt, "daily")}; you can
                      add another.
                    </span>
                  )}
                </button>
              ))}
            </div>
          </section>
        )}

        {step.kind === "menu" && (
          <section className={own.screen}>
            <h1 className={styles.title}>What would you like to do?</h1>
            <div className={own.choices}>
              <button
                className={own.choice}
                onClick={() =>
                  setStep({ kind: "system", preview: step.preview })
                }
                type="button"
              >
                <strong>View system report</strong>
                <span>
                  What the system recorded for you{" "}
                  {step.preview.period === "daily" ? "today" : "this week"}.
                </span>
                <span className={own.choiceNote}>
                  {step.preview.activity.items.length} things recorded
                </span>
              </button>
              <button
                className={own.choice}
                onClick={() =>
                  setStep({ kind: "write", preview: step.preview })
                }
                type="button"
              >
                <strong>Write my report</strong>
                <span>
                  {step.preview.period === "daily"
                    ? "Your job updates: work done, next action and status."
                    : "Your weekly review: progress, your department figure and next action."}
                </span>
                <span className={own.choiceNote}>
                  The system report is attached when you send.
                </span>
              </button>
            </div>
          </section>
        )}

        {step.kind === "system" && (
          <section className={own.screen}>
            <h1 className={styles.title}>System report</h1>
            <p className={styles.muted}>
              Counted from your work in the system; you do not type these.
            </p>
            <Recorded
              activity={step.preview.activity}
              period={step.preview.period}
            />
            <p className={styles.muted}>
              Your tasks: {step.preview.newCount} new ·{" "}
              {step.preview.completedCount} completed ·{" "}
              {step.preview.overdueCount} overdue
            </p>
            <div className={styles.formActions}>
              <button
                className={styles.button}
                onClick={() =>
                  setStep({ kind: "write", preview: step.preview })
                }
                type="button"
              >
                Write my report
              </button>
            </div>
          </section>
        )}

        {step.kind === "write" && (
          <WriteReport
            onError={setError}
            onSent={() => reportSent(step.preview.period)}
            preview={step.preview}
            team={team}
          />
        )}
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <PerformanceTabs active="/performance" />
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Reports</h1>
          <p className={styles.muted}>
            {canReport
              ? "Your daily and weekly reports, and your team's."
              : "Daily and weekly reports from your staff: what the system recorded for each person, and what they wrote."}
          </p>
        </div>
        {canReport && (
          <button
            className={styles.button}
            onClick={() => void choose()}
            type="button"
          >
            Generate report
          </button>
        )}
      </header>

      <ErrorPopup message={error} />
      {sent && (
        <p className={own.notice} role="status">
          {sent}
        </p>
      )}

      <h2 className={own.listTitle}>
        {roster?.manager ? "Sent reports" : "Reports from your team"}
      </h2>
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
          <p className={styles.muted}>No reports yet.</p>
        ) : (
          <div className={own.reportList}>
            {reports.map((report) => (
              <ReportCard key={report.id} report={report} />
            ))}
          </div>
        ))}
    </main>
  );
}
