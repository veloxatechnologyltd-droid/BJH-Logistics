"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useStaffAccess } from "../auth/useStaffAccess";
import {
  getOutstandingInvoices,
  listJobs,
  listTasks,
  roleLabels,
  serviceLineLabels,
  statusLabels,
  taskKindLabels,
} from "../jobs/jobApi";
import type { Job, JobTask, OutstandingInvoice } from "../jobs/jobApi";
import { NavIcon } from "../NavIcon";
import type { NavIconName } from "../NavIcon";
import { listQuoteRequests } from "../quotations/quoteRequestApi";
import type { QuoteRequest } from "../quotations/quoteRequestApi";
import { listQuotes } from "../quotes/quoteApi";
import type { QuoteSummary } from "../quotes/quoteApi";
import styles from "./overview.module.css";
import { ErrorPopup } from "../ErrorPopup";

type Totals = Array<{
  currency: string;
  outstandingMinor: number;
  overdueMinor: number;
}>;

/** One data source: a failing source must not blank the rest of the page. */
type Source<T> =
  { state: "loading" } | { state: "ready"; data: T } | { state: "unavailable" };

const loading = { state: "loading" } as const;

/** Status colours: blue open, yellow in progress, orange on hold, green ready, grey closed, red cancelled. */
const stages = [
  { key: "open", color: "#2563eb" },
  { key: "in_progress", color: "#eab308" },
  { key: "on_hold", color: "#f97316" },
  { key: "ready_to_close", color: "#16a34a" },
  { key: "closed", color: "#94a3b8" },
  { key: "cancelled", color: "#dc2626" },
] as const;

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("en-GH", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function formatMoney(amountMinor: number, currency: string) {
  return new Intl.NumberFormat("en-GH", {
    style: "currency",
    currency,
  }).format(amountMinor / 100);
}

function settle<T>(promise: Promise<T>): Promise<Source<T>> {
  return promise.then(
    (data): Source<T> => ({ state: "ready", data }),
    (): Source<T> => ({ state: "unavailable" }),
  );
}

function rows<T>(source: Source<T[]>): T[] {
  return source.state === "ready" ? source.data : [];
}

type Segment = { label: string; value: number; color: string };

/** A ring chart with the total in the middle and a legend that can be read without colour. */
function Donut({
  segments,
  centerValue,
  centerLabel,
}: {
  segments: Segment[];
  centerValue: string;
  centerLabel: string;
}) {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const visible = segments.filter((segment) => segment.value > 0);
  // A thin gap between arcs keeps neighbouring blues apart.
  const gap = visible.length > 1 ? 2 : 0;
  let offset = 0;
  return (
    <div className={styles.donutWrap}>
      <svg
        aria-label={segments
          .map((segment) => `${segment.label}: ${segment.value}`)
          .join(", ")}
        className={styles.donut}
        role="img"
        viewBox="0 0 140 140"
      >
        <circle
          cx="70"
          cy="70"
          fill="none"
          r={radius}
          stroke="#eaf1fb"
          strokeWidth="18"
        />
        {total > 0 &&
          visible.map((segment) => {
            const length = (segment.value / total) * circumference;
            const arc = (
              <circle
                cx="70"
                cy="70"
                fill="none"
                key={segment.label}
                r={radius}
                stroke={segment.color}
                strokeDasharray={`${length - gap} ${circumference - length + gap}`}
                strokeDashoffset={-offset}
                strokeWidth="18"
                transform="rotate(-90 70 70)"
              />
            );
            offset += length;
            return arc;
          })}
        <text className={styles.donutValue} textAnchor="middle" x="70" y="72">
          {centerValue}
        </text>
        <text className={styles.donutLabel} textAnchor="middle" x="70" y="90">
          {centerLabel}
        </text>
      </svg>
      <ul className={styles.legend}>
        {segments.map((segment) => (
          <li key={segment.label}>
            <span
              aria-hidden="true"
              className={styles.swatch}
              style={{ background: segment.color }}
            />
            <span>{segment.label}</span>
            <strong>{segment.value}</strong>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function OverviewDashboard() {
  const { status, roles } = useStaffAccess();
  const [jobs, setJobs] = useState<Source<Job[]>>(loading);
  const [tasks, setTasks] = useState<Source<JobTask[]>>(loading);
  const [money, setMoney] =
    useState<Source<{ invoices: OutstandingInvoice[]; totals: Totals }>>(
      loading,
    );
  const [requests, setRequests] = useState<Source<QuoteRequest[]>>(loading);
  const [quotes, setQuotes] = useState<Source<QuoteSummary[]>>(loading);
  const [notificationsOpen, setNotificationsOpen] = useState(false);

  useEffect(() => {
    if (status !== "ready" || roles.length === 0) return;

    let active = true;
    const feed =
      <T,>(set: (source: Source<T>) => void) =>
      (source: Source<T>) => {
        if (active) set(source);
      };
    void settle(listJobs("")).then(feed(setJobs));
    void settle(listTasks("", "open")).then(feed(setTasks));
    void settle(getOutstandingInvoices("")).then(feed(setMoney));
    void settle(listQuoteRequests()).then(feed(setRequests));
    void settle(listQuotes()).then(feed(setQuotes));

    return () => {
      active = false;
    };
  }, [roles.length, status]);

  if (status === "ready" && roles.length === 0) {
    return (
      <main className={styles.dashboard}>
        <p className={styles.error} role="status">
          This overview is available to staff accounts.
        </p>
      </main>
    );
  }

  if (status === "unavailable") {
    return (
      <main className={styles.dashboard}>
        <ErrorPopup message="Sign in to load your operations overview." />
      </main>
    );
  }

  const today = new Date().toISOString().slice(0, 10);
  const jobList = rows(jobs);
  const taskList = rows(tasks);
  const invoices = money.state === "ready" ? money.data.invoices : [];
  const totals = money.state === "ready" ? money.data.totals : [];
  const requestList = rows(requests);
  const quoteList = rows(quotes);

  const count = (jobStatus: Job["status"]) =>
    jobList.filter((job) => job.status === jobStatus).length;
  const activeJobs = jobList.filter(
    (job) => job.status !== "closed" && job.status !== "cancelled",
  );
  const overdueTasks = taskList.filter(
    (task) => task.dueDate !== null && task.dueDate < today,
  );
  const overdueInvoices = invoices.filter((invoice) => invoice.daysOverdue > 0);
  const waitingRequests = requestList.filter(
    (request) => request.quoteId === null,
  );
  const draftQuotes = quoteList.filter(
    (quote) => quote.latestStatus === "draft",
  );
  const attentionTasks = [...taskList]
    .sort((first, second) => {
      const firstOverdue = first.dueDate !== null && first.dueDate < today;
      const secondOverdue = second.dueDate !== null && second.dueDate < today;
      if (firstOverdue !== secondOverdue) return firstOverdue ? -1 : 1;
      if (first.dueDate === null) return second.dueDate === null ? 0 : 1;
      if (second.dueDate === null) return -1;
      return first.dueDate.localeCompare(second.dueDate);
    })
    .slice(0, 5);

  const show = (source: Source<unknown>, value: number) =>
    source.state === "ready" ? value.toLocaleString("en-GH") : "—";

  const attention = [
    {
      label: "Overdue tasks",
      value: overdueTasks.length,
      href: "/tasks",
      source: tasks,
    },
    {
      label: "Overdue invoices",
      value: overdueInvoices.length,
      href: "/invoices",
      source: money,
    },
    {
      label: "Requests waiting for a quote",
      value: waitingRequests.length,
      href: "/quotations",
      source: requests,
    },
    {
      label: "Quotes still in draft",
      value: draftQuotes.length,
      href: "/quotes",
      source: quotes,
    },
    {
      label: "Jobs on hold",
      value: count("on_hold"),
      href: "/jobs",
      source: jobs,
    },
    {
      label: "Jobs ready to close",
      value: count("ready_to_close"),
      href: "/jobs",
      source: jobs,
    },
  ].filter((item) => item.source.state === "ready" && item.value > 0);
  const stillLoading = [jobs, tasks, money, requests, quotes].some(
    (source) => source.state === "loading",
  );

  const kpis: Array<{
    label: string;
    value: string;
    note: string;
    href: string;
    icon: NavIconName;
  }> = [
    {
      label: "Active jobs",
      value: show(jobs, activeJobs.length),
      note: `${count("on_hold")} on hold`,
      href: "/jobs",
      icon: "jobs",
    },
    {
      label: "Unpaid invoices",
      value: show(money, invoices.length),
      note: `${overdueInvoices.length} overdue`,
      href: "/invoices",
      icon: "invoices",
    },
    {
      label: "Open tasks",
      value: show(tasks, taskList.length),
      note: `${overdueTasks.length} overdue`,
      href: "/tasks",
      icon: "tasks",
    },
  ];

  const unavailable = (source: Source<unknown>, name: string) =>
    source.state === "loading" ? (
      <p className={styles.empty}>Loading {name}…</p>
    ) : (
      <p className={styles.empty}>
        {name[0].toUpperCase() + name.slice(1)} are not available to your
        account right now.
      </p>
    );

  return (
    <main className={styles.dashboard} id="overview" aria-busy={stillLoading}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Overview</h1>
        </div>
        <div className={styles.headerActions}>
          <span className={styles.environment}>
            <span aria-hidden="true" /> LOCAL WORKSPACE
          </span>
          <div className={styles.bellWrap}>
            <button
              aria-expanded={notificationsOpen}
              aria-label={`Notifications, ${attention.length} need attention`}
              className={styles.bell}
              onClick={() => setNotificationsOpen((open) => !open)}
              type="button"
            >
              <svg
                aria-hidden="true"
                fill="none"
                height="22"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                viewBox="0 0 24 24"
                width="22"
              >
                <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0" />
              </svg>
              {attention.length > 0 && (
                <span className={styles.bellCount}>{attention.length}</span>
              )}
            </button>
            {notificationsOpen && (
              <div
                className={styles.notifications}
                role="region"
                aria-label="Notifications"
              >
                <h2>Notifications</h2>
                {stillLoading && attention.length === 0 ? (
                  <p className={styles.empty}>Checking your work…</p>
                ) : attention.length === 0 ? (
                  <p className={styles.clear}>
                    All clear. Nothing needs attention.
                  </p>
                ) : (
                  attention.map((item) => (
                    <Link
                      className={styles.notification}
                      href={item.href}
                      key={item.label}
                    >
                      <strong>{item.value}</strong>
                      <span>{item.label}</span>
                      <span aria-hidden="true">→</span>
                    </Link>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      </header>

      <section className={styles.metrics} aria-label="At a glance">
        {kpis.map((metric) => (
          <Link className={styles.metric} href={metric.href} key={metric.label}>
            <span className={styles.metricIcon} aria-hidden="true">
              <NavIcon name={metric.icon} />
            </span>
            <span className={styles.metricText}>
              <span className={styles.metricLabel}>{metric.label}</span>
              <strong className={styles.metricValue}>{metric.value}</strong>
              <span className={styles.metricNote}>{metric.note}</span>
            </span>
          </Link>
        ))}
      </section>

      <section className={styles.grid} aria-label="Charts">
        <article className={styles.panel}>
          <div className={styles.panelHeading}>
            <h2>Jobs by stage</h2>
            <Link className={styles.panelLink} href="/jobs">
              Open the board <span aria-hidden="true">→</span>
            </Link>
          </div>
          {jobs.state !== "ready" ? (
            unavailable(jobs, "jobs")
          ) : jobList.length === 0 ? (
            <p className={styles.empty}>No job files yet.</p>
          ) : (
            <Donut
              centerLabel="jobs"
              centerValue={String(jobList.length)}
              segments={stages.map((stage) => ({
                label: statusLabels[stage.key],
                value: count(stage.key),
                color: stage.color,
              }))}
            />
          )}
        </article>

        <article className={styles.panel}>
          <div className={styles.panelHeading}>
            <h2>Money owed to us</h2>
            <Link className={styles.panelLink} href="/invoices">
              Invoices <span aria-hidden="true">→</span>
            </Link>
          </div>
          {money.state !== "ready" ? (
            unavailable(money, "invoices")
          ) : invoices.length === 0 ? (
            <p className={styles.empty}>No unpaid invoices.</p>
          ) : (
            <>
              <Donut
                centerLabel="unpaid"
                centerValue={String(invoices.length)}
                segments={[
                  {
                    label: "Overdue",
                    value: overdueInvoices.length,
                    color: "#dc2626",
                  },
                  {
                    label: "Not yet due",
                    value: invoices.length - overdueInvoices.length,
                    color: "#16a34a",
                  },
                ]}
              />
              <ul className={styles.totals}>
                {totals.map((total) => (
                  <li key={total.currency}>
                    <span>{total.currency} outstanding</span>
                    <strong>
                      {formatMoney(total.outstandingMinor, total.currency)}
                    </strong>
                  </li>
                ))}
              </ul>
            </>
          )}
        </article>
      </section>

      <section className={styles.grid} aria-label="Recent work">
        <article className={styles.panel}>
          <div className={styles.panelHeading}>
            <h2>Latest jobs</h2>
            <Link className={styles.panelLink} href="/jobs">
              All jobs <span aria-hidden="true">→</span>
            </Link>
          </div>
          {jobs.state !== "ready" ? (
            unavailable(jobs, "job files")
          ) : jobList.length === 0 ? (
            <p className={styles.empty}>New job files will appear here.</p>
          ) : (
            <div className={styles.list}>
              {jobList.slice(0, 5).map((job) => (
                <Link
                  className={styles.row}
                  href={`/jobs/${job.id}`}
                  key={job.id}
                >
                  <span className={styles.rowMain}>
                    <strong>{job.fileNumber}</strong>
                    <span>
                      {job.customerCompanyName} ·{" "}
                      {serviceLineLabels[job.serviceLine]}
                    </span>
                  </span>
                  <span className={styles.pill}>
                    {statusLabels[job.status]}
                  </span>
                  <time className={styles.date} dateTime={job.openedAt}>
                    {formatDate(job.openedAt)}
                  </time>
                </Link>
              ))}
            </div>
          )}
        </article>

        <article className={styles.panel}>
          <div className={styles.panelHeading}>
            <h2>Tasks coming due</h2>
            <Link className={styles.panelLink} href="/tasks">
              All tasks <span aria-hidden="true">→</span>
            </Link>
          </div>
          {tasks.state !== "ready" ? (
            unavailable(tasks, "tasks")
          ) : taskList.length === 0 ? (
            <p className={styles.empty}>No open tasks.</p>
          ) : (
            <div className={styles.list}>
              {attentionTasks.map((task) => {
                const overdue = task.dueDate !== null && task.dueDate < today;
                return (
                  <Link
                    className={styles.row}
                    href={`/jobs/${task.jobId}/tasks`}
                    key={task.id}
                  >
                    <span className={styles.rowMain}>
                      <strong>{task.title}</strong>
                      <span>
                        {task.fileNumber} · {task.customerCompanyName}
                      </span>
                      <small>
                        {taskKindLabels[task.kind]} ·{" "}
                        {roleLabels[task.assignedRole]}
                      </small>
                    </span>
                    <span
                      className={`${styles.date}${overdue ? ` ${styles.overdue}` : ""}`}
                    >
                      {overdue ? "Overdue · " : ""}
                      {task.dueDate ? formatDate(task.dueDate) : "No due date"}
                    </span>
                  </Link>
                );
              })}
            </div>
          )}
        </article>
      </section>
    </main>
  );
}
