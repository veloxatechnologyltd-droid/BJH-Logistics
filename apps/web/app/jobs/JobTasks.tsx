"use client";

import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { staffRoleKeys, taskKinds } from "@bjh/contracts";
import type { StaffRoleKey, TaskKind } from "@bjh/contracts";
import {
  completeJobTask,
  createJobTask,
  listJobTasks,
  roleLabels,
  taskKindLabels,
} from "./jobApi";
import type { JobTask } from "./jobApi";
import styles from "./jobs.module.css";
import { ErrorPopup } from "../ErrorPopup";

export function JobTasks({
  jobId,
  canEdit,
}: {
  jobId: string;
  canEdit: boolean;
}) {
  const [tasks, setTasks] = useState<JobTask[] | null>(null);
  const [error, setError] = useState("");
  const [kind, setKind] = useState<TaskKind>("task");
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [role, setRole] = useState<StaffRoleKey>("super_admin");
  const [dueDate, setDueDate] = useState("");
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    try {
      setTasks(await listJobTasks(jobId));
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Tasks could not be loaded",
      );
    }
  }, [jobId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(action: () => Promise<unknown>) {
    setError("");
    try {
      await action();
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The action failed");
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      await createJobTask(jobId, {
        kind,
        title: title.trim(),
        details: details.trim() || undefined,
        assignedRole: role,
        dueDate: dueDate || undefined,
      });
      setTitle("");
      setDetails("");
      setDueDate("");
      setAdding(false);
    });
  }

  return (
    <section className={styles.card} aria-labelledby="tasks-title">
      <div className={styles.stepsHeading}>
        <h2 id="tasks-title">Tasks and exceptions</h2>
        {canEdit && !adding && (
          <button
            className={styles.secondaryButton}
            onClick={() => setAdding(true)}
            type="button"
          >
            Add task
          </button>
        )}
      </div>
      <ErrorPopup message={error} />
      {tasks && tasks.length === 0 && (
        <p className={styles.muted}>No tasks on this job.</p>
      )}
      {tasks && tasks.length > 0 && (
        <ul className={styles.itemList}>
          {tasks.map((task) => (
            <li key={task.id}>
              <div>
                <span>
                  {taskKindLabels[task.kind]}
                  {task.status === "done" ? " · done" : ""}
                </span>
                <strong>{task.title}</strong>
                <small>
                  {roleLabels[task.assignedRole]}
                  {task.dueDate ? ` · due ${task.dueDate}` : ""}
                  {task.details ? ` · ${task.details}` : ""}
                  {task.completionNote ? ` · ${task.completionNote}` : ""}
                </small>
              </div>
              {task.status !== "done" && canEdit && (
                <button
                  className={styles.textButton}
                  onClick={() =>
                    void run(() =>
                      completeJobTask(
                        jobId,
                        task.id,
                        window.prompt("Completion note (optional)") ||
                          undefined,
                      ),
                    )
                  }
                  type="button"
                >
                  Mark done
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canEdit && adding && (
        <form
          className={`${styles.form} ${styles.quickUpdateForm}`}
          onSubmit={submit}
        >
          <label className={styles.field}>
            Title
            <input
              autoFocus
              onChange={(event) => setTitle(event.target.value)}
              required
              value={title}
            />
          </label>
          <label className={styles.field}>
            Type
            <select
              onChange={(event) => setKind(event.target.value as TaskKind)}
              value={kind}
            >
              {taskKinds.map((item) => (
                <option key={item} value={item}>
                  {taskKindLabels[item]}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            Assigned to
            <select
              onChange={(event) => setRole(event.target.value as StaffRoleKey)}
              value={role}
            >
              {staffRoleKeys.map((item) => (
                <option key={item} value={item}>
                  {roleLabels[item]}
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
            Details (optional)
            <input
              onChange={(event) => setDetails(event.target.value)}
              value={details}
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
    </section>
  );
}
