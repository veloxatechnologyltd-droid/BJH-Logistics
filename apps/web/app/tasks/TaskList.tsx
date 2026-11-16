"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import {
  completeJobTask,
  completeTodo,
  createTodo,
  listTasks,
  roleLabels,
  taskKindLabels,
} from "../jobs/jobApi";
import type { JobTask } from "../jobs/jobApi";
import { listTeamPeople } from "../team-chat/teamChatApi";
import type { TeamPerson } from "../team-chat/teamChatApi";
import styles from "../jobs/jobs.module.css";
import { ErrorPopup } from "../ErrorPopup";

/** Ghana is on UTC, so the date part of an ISO time is the local day. */
const todayIso = () => new Date().toISOString().slice(0, 10);

export function TaskList() {
  const [person, setPerson] = useState("");
  const [people, setPeople] = useState<TeamPerson[]>([]);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [forUser, setForUser] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [remindAt, setRemindAt] = useState("");
  const [status, setStatus] = useState<"open" | "all">("open");
  const [tasks, setTasks] = useState<JobTask[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);

  async function markDone(task: JobTask) {
    setError("");
    try {
      if (task.jobId) await completeJobTask(task.jobId, task.id);
      else await completeTodo(task.id);
      setReload((count) => count + 1);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "The task could not be saved",
      );
      setState("error");
    }
  }

  async function addTodo(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      await createTodo({
        title: title.trim(),
        assignedUserId: forUser,
        dueDate: dueDate || undefined,
        remindAt: remindAt ? new Date(remindAt).toISOString() : undefined,
      });
      setTitle("");
      setDueDate("");
      setRemindAt("");
      setAdding(false);
      setReload((count) => count + 1);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "The to-do could not be saved",
      );
    }
  }

  useEffect(() => {
    listTeamPeople()
      .then((result) => {
        setPeople(result);
        setForUser(result.find((item) => item.you)?.userId ?? "");
      })
      // The filter and the form fall back to "everyone" and "me" without it.
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    let active = true;
    setState("loading");
    listTasks("", status, person)
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
  }, [person, status, reload]);

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Tasks</h1>
          <p className={styles.muted}>
            Things that still need doing, each for one person: chasing a missing
            document, dealing with damaged cargo, or any to-do of your own. Job
            tasks are added from inside a job.
          </p>
        </div>
        {!adding && (
          <button
            className={styles.button}
            onClick={() => setAdding(true)}
            type="button"
          >
            Add to-do
          </button>
        )}
      </header>

      {adding && (
        <form
          className={`${styles.form} ${styles.quickUpdateForm}`}
          onSubmit={(event) => void addTodo(event)}
        >
          <label className={styles.field}>
            To-do
            <input
              autoFocus
              maxLength={200}
              onChange={(event) => setTitle(event.target.value)}
              required
              value={title}
            />
          </label>
          <label className={styles.field}>
            For
            <select
              onChange={(event) => setForUser(event.target.value)}
              required
              value={forUser}
            >
              {people.map((item) => (
                <option key={item.userId} value={item.userId}>
                  {item.name}
                  {item.you ? " (me)" : ""}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            Due date (optional)
            <input
              onChange={(event) => setDueDate(event.target.value)}
              type="date"
              value={dueDate}
            />
          </label>
          <label className={styles.field}>
            Remind them at (optional)
            <input
              onChange={(event) => setRemindAt(event.target.value)}
              type="datetime-local"
              value={remindAt}
            />
          </label>
          <div className={styles.formActions}>
            <button className={styles.button} type="submit">
              Save
            </button>
            <button
              className={styles.secondaryButton}
              onClick={() => setAdding(false)}
              type="button"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      <div className={styles.filters}>
        <label className={styles.field}>
          Whose work?
          <select
            onChange={(event) => setPerson(event.target.value)}
            value={person}
          >
            <option value="">Everyone</option>
            <option value="me">Me</option>
            {people
              .filter((item) => !item.you)
              .map((item) => (
                <option key={item.userId} value={item.userId}>
                  {item.name}
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
              ? "Nothing left to do. Add a to-do above, or add a task from inside a job."
              : "No tasks yet. Add a to-do above, or add a task from inside a job."}
          </p>
        ) : (
          <div className={styles.tableScroll}>
            <table className={styles.table} data-cards>
              <thead>
                <tr>
                  <th scope="col">Task</th>
                  <th scope="col">Whose work</th>
                  <th scope="col">Due</th>
                  <th scope="col">Job</th>
                  <th scope="col">Type</th>
                  <th scope="col">Status</th>
                  <th scope="col">Action</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((task) => (
                  <tr key={task.id}>
                    <th scope="row">{task.title}</th>
                    <td data-label="Whose work">
                      {task.assignedUserName ??
                        (task.assignedRole
                          ? roleLabels[task.assignedRole]
                          : "—")}
                    </td>
                    <td data-label="Due">
                      {task.dueDate ?? "—"}
                      {task.status === "open" &&
                        task.dueDate !== null &&
                        task.dueDate < todayIso() && (
                          <>
                            {" "}
                            <strong>Overdue</strong>
                          </>
                        )}
                    </td>
                    <td data-label="Job" data-wide>
                      {task.jobId ? (
                        <>
                          <Link
                            className={styles.link}
                            href={`/jobs/${task.jobId}`}
                          >
                            {task.fileNumber}
                          </Link>{" "}
                          · {task.customerCompanyName}
                        </>
                      ) : (
                        "Not tied to a job"
                      )}
                    </td>
                    <td data-label="Type">{taskKindLabels[task.kind]}</td>
                    <td data-label="Status">
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
