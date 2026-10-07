"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { staffRoleKeys } from "@bjh/contracts";
import {
  completeJobTask,
  listTasks,
  roleLabels,
  taskKindLabels,
} from "../jobs/jobApi";
import type { JobTask } from "../jobs/jobApi";
import styles from "../jobs/jobs.module.css";
import { ErrorPopup } from "../ErrorPopup";

export function TaskList() {
  const [role, setRole] = useState("");
  const [status, setStatus] = useState<"open" | "all">("open");
  const [tasks, setTasks] = useState<JobTask[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);

  async function markDone(task: JobTask) {
    setError("");
    try {
      await completeJobTask(task.jobId, task.id);
      setReload((count) => count + 1);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "The task could not be saved",
      );
      setState("error");
    }
  }

  useEffect(() => {
    let active = true;
    setState("loading");
    listTasks(role, status)
      .then((result) => {
        if (active) {
          setTasks(result);
          setState("ready");
        }
      })
      .catch((cause: unknown) => {
        if (active) {
          setError(
            cause instanceof Error ? cause.message : "Tasks are unavailable",
          );
          setState("error");
        }
      });
    return () => {
      active = false;
    };
  }, [role, status, reload]);

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Tasks</h1>
          <p className={styles.muted}>
            Things that still need doing on your jobs, such as chasing a missing
            document or dealing with damaged cargo. Open a job to add a new
            task.
          </p>
        </div>
      </header>

      <div className={styles.filters}>
        <label className={styles.field}>
          Whose work?
          <select
            onChange={(event) => setRole(event.target.value)}
            value={role}
          >
            <option value="">Everyone's tasks</option>
            {staffRoleKeys.map((item) => (
              <option key={item} value={item}>
                {roleLabels[item]}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          Show
          <select
            onChange={(event) =>
              setStatus(event.target.value as "open" | "all")
            }
            value={status}
          >
            <option value="open">Still to do</option>
            <option value="all">Still to do and finished</option>
          </select>
        </label>
      </div>

      {state === "loading" && <p role="status">Loading tasks…</p>}
      <ErrorPopup message={error} />
      {state === "ready" &&
        (tasks.length === 0 ? (
          <p className={styles.muted}>
            {status === "open"
              ? "Nothing left to do. New tasks are added from inside a job, under its Tasks tab."
              : "No tasks yet. Tasks are added from inside a job, under its Tasks tab."}
          </p>
        ) : (
          <div className={styles.tableScroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">Task</th>
                  <th scope="col">Job</th>
                  <th scope="col">Type</th>
                  <th scope="col">Whose work</th>
                  <th scope="col">Due</th>
                  <th scope="col">Status</th>
                  <th scope="col">Action</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((task) => (
                  <tr key={task.id}>
                    <th scope="row">{task.title}</th>
                    <td>
                      <Link
                        className={styles.link}
                        href={`/jobs/${task.jobId}`}
                      >
                        {task.fileNumber}
                      </Link>{" "}
                      · {task.customerCompanyName}
                    </td>
                    <td>{taskKindLabels[task.kind]}</td>
                    <td>{roleLabels[task.assignedRole]}</td>
                    <td>{task.dueDate ?? "—"}</td>
                    <td>
                      <span className={styles.badge}>
                        {task.status === "done" ? "Done" : "To do"}
                      </span>
                    </td>
                    <td>
                      {task.status !== "done" && (
                        <button
                          className={styles.secondaryButton}
                          onClick={() => void markDone(task)}
                          type="button"
                        >
                          Mark done
                        </button>
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
