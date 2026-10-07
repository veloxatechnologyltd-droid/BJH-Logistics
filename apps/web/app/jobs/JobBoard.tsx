"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { Dispatch, FormEvent, SetStateAction } from "react";
import {
  jobStatusKeys,
  jobStatusReasonRequired,
  jobStatusTransitions,
} from "@bjh/contracts";
import type { JobStatus } from "@bjh/contracts";
import { changeStatus, serviceLineLabels, statusLabels } from "./jobApi";
import type { Job } from "./jobApi";
import styles from "./jobs.module.css";
import { ErrorPopup } from "../ErrorPopup";

type Move = { job: Job; to: JobStatus };

export function JobBoard({
  jobs,
  setJobs,
  canMove,
}: {
  jobs: Job[];
  setJobs: Dispatch<SetStateAction<Job[]>>;
  canMove: boolean;
}) {
  const [dragging, setDragging] = useState<Job | null>(null);
  const [over, setOver] = useState<JobStatus | null>(null);
  const [pending, setPending] = useState<Move | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (pending) dialog.current?.showModal();
    else dialog.current?.close();
  }, [pending]);

  const canDrop = (job: Job, to: JobStatus) =>
    jobStatusTransitions[job.status].includes(to);

  async function apply(job: Job, to: JobStatus, why?: string) {
    setError("");
    const before = job.status;
    setJobs((current) =>
      current.map((item) =>
        item.id === job.id ? { ...item, status: to } : item,
      ),
    );
    try {
      await changeStatus(job.id, { status: to, reason: why || undefined });
    } catch (cause) {
      setJobs((current) =>
        current.map((item) =>
          item.id === job.id ? { ...item, status: before } : item,
        ),
      );
      setError(cause instanceof Error ? cause.message : "The move failed");
    }
  }

  function requestMove(job: Job, to: JobStatus) {
    if (!canMove || job.status === to) return;
    if (!canDrop(job, to)) {
      setError(
        `A job cannot move from ${statusLabels[job.status]} to ${statusLabels[to]}.`,
      );
      return;
    }
    if (jobStatusReasonRequired(job.status, to)) {
      setReason("");
      setPending({ job, to });
      return;
    }
    void apply(job, to);
  }

  function confirmMove(event: FormEvent) {
    event.preventDefault();
    if (!pending || !reason.trim()) return;
    const { job, to } = pending;
    setPending(null);
    void apply(job, to, reason.trim());
  }

  return (
    <>
      <ErrorPopup message={error} />
      <div className={styles.board}>
        {jobStatusKeys.map((status) => {
          const column = jobs.filter((job) => job.status === status);
          const accepting = dragging !== null && canDrop(dragging, status);
          return (
            <section
              aria-label={`${statusLabels[status]}, ${column.length} jobs`}
              className={`${styles.column}${
                accepting ? ` ${styles.columnAccepting}` : ""
              }${over === status && accepting ? ` ${styles.columnOver}` : ""}`}
              key={status}
              onDragLeave={() => setOver(null)}
              onDragOver={(event) => {
                if (!accepting) return;
                event.preventDefault();
                setOver(status);
              }}
              onDrop={(event) => {
                event.preventDefault();
                setOver(null);
                if (dragging) requestMove(dragging, status);
                setDragging(null);
              }}
            >
              <header className={styles.columnHeader}>
                <h2>{statusLabels[status]}</h2>
                <span className={styles.count}>{column.length}</span>
              </header>
              <div className={styles.cards}>
                {column.length === 0 && (
                  <p className={styles.columnEmpty}>No jobs</p>
                )}
                {column.map((job) => {
                  const targets = jobStatusTransitions[job.status];
                  return (
                    <article
                      className={`${styles.jobCard}${
                        canMove ? ` ${styles.draggable}` : ""
                      }${dragging?.id === job.id ? ` ${styles.dragging}` : ""}`}
                      draggable={canMove}
                      key={job.id}
                      onDragEnd={() => {
                        setDragging(null);
                        setOver(null);
                      }}
                      onDragStart={(event) => {
                        event.dataTransfer.effectAllowed = "move";
                        event.dataTransfer.setData("text/plain", job.id);
                        setError("");
                        setDragging(job);
                      }}
                    >
                      <Link className={styles.link} href={`/jobs/${job.id}`}>
                        {job.fileNumber}
                      </Link>
                      <p className={styles.cardCustomer}>
                        {job.customerCompanyName}
                      </p>
                      <p className={styles.cardMeta}>
                        {serviceLineLabels[job.serviceLine]} · opened{" "}
                        {new Date(job.openedAt).toLocaleDateString()}
                      </p>
                      {canMove && targets.length > 0 && (
                        <select
                          aria-label={`Move ${job.fileNumber} to another stage`}
                          className={styles.moveSelect}
                          onChange={(event) => {
                            const to = event.target.value as JobStatus;
                            event.target.value = "";
                            if (to) requestMove(job, to);
                          }}
                          value=""
                        >
                          <option value="">Move to…</option>
                          {targets.map((to) => (
                            <option key={to} value={to}>
                              {statusLabels[to]}
                            </option>
                          ))}
                        </select>
                      )}
                    </article>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>

      <dialog
        aria-labelledby="move-title"
        className={styles.dialog}
        onCancel={() => setPending(null)}
        ref={dialog}
      >
        {pending && (
          <form className={styles.form} onSubmit={confirmMove}>
            <h2 id="move-title">
              Move {pending.job.fileNumber} to {statusLabels[pending.to]}
            </h2>
            <label className={styles.field}>
              Reason (required)
              <input
                autoFocus
                onChange={(event) => setReason(event.target.value)}
                required
                value={reason}
              />
            </label>
            <div className={styles.actions}>
              <button className={styles.button} type="submit">
                Move job
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
    </>
  );
}
