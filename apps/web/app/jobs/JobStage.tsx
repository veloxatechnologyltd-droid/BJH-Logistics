"use client";

import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { jobStatusReasonRequired } from "@bjh/contracts";
import type { JobStatus } from "@bjh/contracts";
import { changeStatus, listJobTasks, statusLabels } from "./jobApi";
import type { Job } from "./jobApi";
import styles from "./jobs.module.css";

/** The natural next move from each status. */
const nextMove: Record<JobStatus, { to: JobStatus; label: string }> = {
  open: { to: "in_progress", label: "Start work" },
  in_progress: { to: "ready_to_close", label: "Mark ready to close" },
  on_hold: { to: "in_progress", label: "Resume work" },
  ready_to_close: { to: "closed", label: "Close job" },
  closed: { to: "in_progress", label: "Reopen job" },
  cancelled: { to: "in_progress", label: "Reopen job" },
};

const otherLabels: Partial<Record<JobStatus, string>> = {
  in_progress: "Back to in progress",
  on_hold: "Put on hold",
  ready_to_close: "Mark ready to close",
  closed: "Close job",
  cancelled: "Cancel job",
};

/** Where the job stands, and the one button that moves it on. */
export function JobStage({
  job,
  allowedNext,
  canEdit,
  run,
}: {
  job: Job;
  allowedNext: JobStatus[];
  canEdit: boolean;
  run: (action: () => Promise<unknown>, after?: () => void) => Promise<void>;
}) {
  const [pending, setPending] = useState<JobStatus | null>(null);
  const [reason, setReason] = useState("");
  /** Open tasks shown before closing or cancelling, so none is forgotten. */
  const [openTasks, setOpenTasks] = useState<string[]>([]);
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (pending) dialog.current?.showModal();
    else dialog.current?.close();
  }, [pending]);

  const main = nextMove[job.status];
  const others = allowedNext.filter((status) => status !== main.to);

  const needsReason = (to: JobStatus) =>
    jobStatusReasonRequired(job.status, to);

  async function move(to: JobStatus) {
    const stillOpen =
      to === "closed" || to === "cancelled"
        ? await listJobTasks(job.id)
            .then((tasks) =>
              tasks
                .filter((task) => task.status !== "done")
                .map((task) => task.title),
            )
            .catch(() => [])
        : [];
    if (needsReason(to) || stillOpen.length > 0) {
      setReason("");
      setOpenTasks(stillOpen);
      setPending(to);
      return;
    }
    void run(() => changeStatus(job.id, { status: to }));
  }

  function confirm(event: FormEvent) {
    event.preventDefault();
    if (!pending) return;
    const to = pending;
    const why = reason.trim();
    if (needsReason(to) && !why) return;
    setPending(null);
    void run(() =>
      changeStatus(job.id, why ? { status: to, reason: why } : { status: to }),
    );
  }

  return (
    <div className={styles.progressStatus}>
      <strong>Overall status: {statusLabels[job.status]}</strong>
      {canEdit && allowedNext.length > 0 && (
        <div className={styles.actions}>
          {allowedNext.includes(main.to) && (
            <button
              className={styles.button}
              onClick={() => void move(main.to)}
              type="button"
            >
              {main.label}
            </button>
          )}
          {others.length > 0 && (
            <details className={styles.moreMenu}>
              <summary className={styles.secondaryButton}>More</summary>
              <div>
                {others.map((status) => (
                  <button
                    key={status}
                    onClick={() => void move(status)}
                    type="button"
                  >
                    {otherLabels[status] ?? statusLabels[status]}
                  </button>
                ))}
              </div>
            </details>
          )}
        </div>
      )}

      <dialog
        aria-labelledby="stage-title"
        className={styles.dialog}
        onCancel={() => setPending(null)}
        ref={dialog}
      >
        {pending && (
          <form className={styles.form} onSubmit={confirm}>
            <h2 id="stage-title">
              {pending === main.to
                ? main.label
                : (otherLabels[pending] ?? statusLabels[pending])}
            </h2>
            {openTasks.length > 0 && (
              <div role="alert">
                <p>
                  {openTasks.length === 1
                    ? "This task is still open:"
                    : `These ${openTasks.length} tasks are still open:`}
                </p>
                <ul>
                  {openTasks.map((title, index) => (
                    <li key={index}>{title}</li>
                  ))}
                </ul>
                <p>
                  You can still mark them done after the job is{" "}
                  {pending === "cancelled" ? "cancelled" : "closed"}.
                </p>
              </div>
            )}
            {needsReason(pending) && (
              <label className={styles.field}>
                Reason
                <input
                  autoFocus
                  onChange={(event) => setReason(event.target.value)}
                  required
                  value={reason}
                />
              </label>
            )}
            <div className={styles.actions}>
              <button className={styles.button} type="submit">
                {openTasks.length > 0
                  ? pending === "cancelled"
                    ? "Cancel the job anyway"
                    : "Close anyway"
                  : "Confirm"}
              </button>
              <button
                className={styles.secondaryButton}
                onClick={() => setPending(null)}
                type="button"
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </dialog>
    </div>
  );
}
