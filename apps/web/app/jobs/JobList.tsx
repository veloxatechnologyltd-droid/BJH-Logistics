"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { JobStatus, ServiceLine } from "@bjh/contracts";
import { listJobs, serviceLineLabels, statusLabels } from "./jobApi";
import type { Job, JobFilters } from "./jobApi";
import { JobBoard } from "./JobBoard";
import { listCustomers } from "../customers/customerApi";
import type { CustomerCompany } from "../customers/customerApi";
import { useStaffAccess } from "../auth/useStaffAccess";
import styles from "./jobs.module.css";
import { ErrorPopup } from "../ErrorPopup";

const activeStatuses: JobStatus[] = [
  "open",
  "in_progress",
  "on_hold",
  "ready_to_close",
];

/** One choice per row in the Status filter; "active" is every unfinished stage. */
const statusChoices: Array<[string, string, JobStatus[]]> = [
  ["", "Any status", []],
  ["active", "Active", activeStatuses],
  ...(Object.keys(statusLabels) as JobStatus[]).map(
    (status): [string, string, JobStatus[]] => [
      status,
      statusLabels[status],
      [status],
    ],
  ),
];

const serviceChoices: Array<[string, string, ServiceLine[]]> = [
  ["", "Any service", []],
  ["import", "Import (sea and air)", ["sea_import", "air_import"]],
  ["export", "Export (sea and air)", ["sea_export", "air_export"]],
  ...(Object.keys(serviceLineLabels) as ServiceLine[]).map(
    (line): [string, string, ServiceLine[]] => [
      line,
      serviceLineLabels[line],
      [line],
    ],
  ),
];

/** The board leaves out jobs finished longer ago than this, unless asked. */
const boardRecentDays = 30;

const empty = {
  status: "",
  service: "",
  customer: "",
  rep: "",
  openedFrom: "",
  openedTo: "",
  etaFrom: "",
  etaTo: "",
  vessel: "",
  port: "",
};

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

function formatShortDate(value: string): string {
  return new Date(value).toLocaleDateString();
}

export function JobList() {
  const { roles } = useStaffAccess();
  const isStaff = roles.length > 0;
  const [jobs, setJobs] = useState<Job[]>([]);
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"board" | "list">("list");
  const [filters, setFilters] = useState(empty);
  const [olderOnBoard, setOlderOnBoard] = useState(false);
  const [customers, setCustomers] = useState<CustomerCompany[]>([]);
  // Leads seen so far, so the Rep filter can offer them even once narrowed.
  const [reps, setReps] = useState<Map<string, string>>(new Map());
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isStaff) return;
    listCustomers("")
      .then(setCustomers)
      .catch(() => undefined);
  }, [isStaff]);

  useEffect(() => {
    let active = true;
    const query: JobFilters = {
      status: statusChoices.find(([key]) => key === filters.status)?.[2],
      serviceLine: serviceChoices.find(([key]) => key === filters.service)?.[2],
      customerCompanyId: filters.customer || undefined,
      assignedTo: filters.rep || undefined,
      openedFrom: filters.openedFrom || undefined,
      openedTo: filters.openedTo || undefined,
      etaFrom: filters.etaFrom || undefined,
      etaTo: filters.etaTo || undefined,
      vessel: filters.vessel.trim() || undefined,
      port: filters.port.trim() || undefined,
      // Years of finished jobs would bury the board; the list keeps them all.
      closedSince:
        view === "board" && !olderOnBoard
          ? daysAgo(boardRecentDays)
          : undefined,
    };
    setState("loading");
    listJobs(search, query)
      .then((result) => {
        if (!active) return;
        setJobs(result);
        setReps((current) => {
          const next = new Map(current);
          for (const job of result) {
            if (job.leadUserId)
              next.set(job.leadUserId, job.leadEmail ?? "Staff member");
          }
          return next.size === current.size ? current : next;
        });
        setState("ready");
      })
      .catch((cause: unknown) => {
        if (active) {
          setError(
            cause instanceof Error ? cause.message : "Jobs are unavailable",
          );
          setState("error");
        }
      });
    return () => {
      active = false;
    };
  }, [search, filters, view, olderOnBoard]);

  const set = (key: keyof typeof empty) => (value: string) =>
    setFilters((current) => ({ ...current, [key]: value }));
  const filtered =
    search.trim() !== "" ||
    Object.values(filters).some((value) => value !== "");

  return (
    <main
      className={`${styles.page}${view === "board" ? ` ${styles.pageWide}` : ""}`}
    >
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Jobs</h1>
        </div>
        {isStaff && (
          <Link className={styles.primaryLink} href="/jobs/new">
            Open a job
          </Link>
        )}
      </header>

      <div className={styles.toolbar}>
        <input
          aria-label="Search jobs"
          autoComplete="off"
          className={styles.searchInput}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search file number, customer, B/L, container…"
          type="search"
          value={search}
        />
        <div className={styles.segmented} role="group" aria-label="View">
          {(["list", "board"] as const).map((option) => (
            <button
              aria-pressed={view === option}
              className={view === option ? styles.segmentActive : ""}
              key={option}
              onClick={() => setView(option)}
              type="button"
            >
              {option === "board" ? "Status board" : "List"}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.filters}>
        <label className={styles.field}>
          Status
          <select
            onChange={(event) => set("status")(event.target.value)}
            value={filters.status}
          >
            {statusChoices.map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          Service
          <select
            onChange={(event) => set("service")(event.target.value)}
            value={filters.service}
          >
            {serviceChoices.map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {isStaff && (
          <>
            <label className={styles.field}>
              Customer
              <select
                onChange={(event) => set("customer")(event.target.value)}
                value={filters.customer}
              >
                <option value="">Any customer</option>
                {customers.map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.companyName}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.field}>
              Rep
              <select
                onChange={(event) => set("rep")(event.target.value)}
                value={filters.rep}
              >
                <option value="">Anyone</option>
                <option value="me">My jobs</option>
                {[...reps].map(([id, email]) => (
                  <option key={id} value={id}>
                    {email}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
      </div>
      <details className={styles.moreFilters}>
        <summary className={styles.disclosureSummary}>
          Dates, vessel and port
        </summary>
        <div className={styles.filters}>
          <label className={styles.field}>
            Vessel
            <input
              onChange={(event) => set("vessel")(event.target.value)}
              placeholder="Part of the vessel name"
              value={filters.vessel}
            />
          </label>
          <label className={styles.field}>
            Port
            <input
              onChange={(event) => set("port")(event.target.value)}
              placeholder="Loading or discharge"
              value={filters.port}
            />
          </label>
          {(
            [
              ["openedFrom", "Opened from"],
              ["openedTo", "Opened to"],
              ["etaFrom", "ETA from"],
              ["etaTo", "ETA to"],
            ] as const
          ).map(([key, label]) => (
            <label className={styles.field} key={key}>
              {label}
              <input
                onChange={(event) => set(key)(event.target.value)}
                type="date"
                value={filters[key]}
              />
            </label>
          ))}
        </div>
      </details>
      <div className={styles.filterSummary}>
        {state === "ready" && (
          <span className={styles.muted}>
            {jobs.length} {jobs.length === 1 ? "job" : "jobs"}
            {view === "board" && !olderOnBoard
              ? ` · finished jobs from the last ${boardRecentDays} days only`
              : ""}
          </span>
        )}
        {view === "board" && (
          <button
            className={styles.textButton}
            onClick={() => setOlderOnBoard((current) => !current)}
            type="button"
          >
            {olderOnBoard
              ? "Hide older finished jobs"
              : "Show older finished jobs"}
          </button>
        )}
        {filtered && (
          <button
            className={styles.textButton}
            onClick={() => {
              setFilters(empty);
              setSearch("");
            }}
            type="button"
          >
            Clear filters
          </button>
        )}
      </div>

      {state === "loading" && <p role="status">Loading jobs…</p>}
      <ErrorPopup message={error} />
      {state === "ready" && view === "board" && (
        <JobBoard canMove={isStaff} jobs={jobs} setJobs={setJobs} />
      )}
      {state === "ready" &&
        view === "list" &&
        (jobs.length === 0 ? (
          <p className={styles.muted}>
            {filtered ? "No jobs match." : "No jobs yet."}
          </p>
        ) : (
          <div className={styles.tableScroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">File number</th>
                  <th scope="col">Customer</th>
                  <th scope="col">Service</th>
                  <th scope="col">Status</th>
                  {isStaff && <th scope="col">Lead</th>}
                  <th scope="col">ETA</th>
                  <th scope="col">Opened</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  <tr key={job.id}>
                    <th scope="row">
                      <Link className={styles.link} href={`/jobs/${job.id}`}>
                        {job.fileNumber}
                      </Link>
                    </th>
                    <td>{job.customerCompanyName}</td>
                    <td>{serviceLineLabels[job.serviceLine]}</td>
                    <td>
                      <span className={styles.badge}>
                        {statusLabels[job.status]}
                      </span>
                    </td>
                    {isStaff && <td>{job.leadEmail ?? "—"}</td>}
                    <td>
                      {job.currentEtaAt
                        ? formatShortDate(job.currentEtaAt)
                        : "—"}
                    </td>
                    <td>{formatShortDate(job.openedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
    </main>
  );
}
