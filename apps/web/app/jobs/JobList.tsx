"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { listJobs, serviceLineLabels, statusLabels } from "./jobApi";
import type { Job } from "./jobApi";
import { JobBoard } from "./JobBoard";
import { useStaffAccess } from "../auth/useStaffAccess";
import styles from "./jobs.module.css";
import { ErrorPopup } from "../ErrorPopup";

export function JobList() {
  const { roles } = useStaffAccess();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"board" | "list">("list");
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setState("loading");
    listJobs(search)
      .then((result) => {
        if (active) {
          setJobs(result);
          setState("ready");
        }
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
  }, [search]);

  return (
    <main
      className={`${styles.page}${view === "board" ? ` ${styles.pageWide}` : ""}`}
    >
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Jobs</h1>
        </div>
        {roles.length > 0 && (
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
          placeholder="Search jobs"
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

      {state === "loading" && <p role="status">Loading jobs…</p>}
      <ErrorPopup message={error} />
      {state === "ready" && view === "board" && (
        <JobBoard canMove={roles.length > 0} jobs={jobs} setJobs={setJobs} />
      )}
      {state === "ready" &&
        view === "list" &&
        (jobs.length === 0 ? (
          <p className={styles.muted}>
            {search.trim() ? "No jobs match." : "No jobs yet."}
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
                    <td>{new Date(job.openedAt).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
    </main>
  );
}
