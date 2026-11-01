"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { listJobTasks, statusLabels, taskKindLabels } from "../jobApi";
import type { JobTask } from "../jobApi";
import { formatDate } from "../jobFormat";
import { JobEta } from "../JobEta";
import { JobStage } from "../JobStage";
import { JobSteps } from "../JobSteps";
import { JobTeam } from "../JobTeam";
import { useJob } from "../JobShell";
import styles from "../jobs.module.css";

export default function JobOverviewPage() {
  const { job, status, timeline, isStaff, closedJob, run } = useJob();
  const [tasks, setTasks] = useState<JobTask[] | null>(null);

  useEffect(() => {
    if (!isStaff) return;
    void listJobTasks(job.id)
      .then(setTasks)
      .catch(() => setTasks([]));
  }, [isStaff, job.id]);

  const openTasks = (tasks ?? [])
    .filter((task) => task.status === "open")
    .sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999"));
  return (
    <>
      <section className={styles.card} aria-labelledby="job-progress-title">
        <h2 id="job-progress-title">Job progress</h2>
        <JobStage
          allowedNext={status.allowedNext}
          canEdit={isStaff}
          job={job}
          run={run}
        />
        {timeline.template.length > 0 && (
          <JobSteps
            canEdit={isStaff && !closedJob}
            job={job}
            run={run}
            timeline={timeline}
          />
        )}
        <details className={styles.progressHistory}>
          <summary className={styles.disclosureSummary}>Status history</summary>
          <div className={styles.disclosureContent}>
            {status.history.length === 0 ? (
              <p className={styles.muted}>No changes yet.</p>
            ) : (
              <ul className={styles.list}>
                {status.history.map((entry) => (
                  <li key={entry.id}>
                    {statusLabels[entry.fromStatus]} →{" "}
                    {statusLabels[entry.toStatus]} ·{" "}
                    {formatDate(entry.changedAt)}
                    {entry.reason ? ` — ${entry.reason}` : ""}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </details>
      </section>

      {isStaff && <JobTeam closedJob={closedJob} jobId={job.id} />}

      <JobEta canEdit={isStaff && !closedJob} jobId={job.id} />

      {isStaff && tasks !== null && (
        <section className={styles.card} aria-labelledby="tasks-title">
          <div className={styles.stepsHeading}>
            <h2 id="tasks-title">Tasks</h2>
            <Link
              className={styles.secondaryButton}
              href={`/jobs/${job.id}/tasks`}
            >
              {openTasks.length > 0 ? "Open tasks" : "Add a task"}
            </Link>
          </div>
          {openTasks.length === 0 ? (
            <p className={styles.muted}>No open tasks.</p>
          ) : (
            <ul className={styles.nextTasks}>
              {openTasks.slice(0, 3).map((task) => (
                <li key={task.id}>
                  <strong>{task.title}</strong>
                  <span>
                    {taskKindLabels[task.kind]}
                    {task.dueDate ? ` · Due ${task.dueDate}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </>
  );
}
