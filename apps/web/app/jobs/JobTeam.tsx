"use client";

import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useStaffAccess } from "../auth/useStaffAccess";
import { assignJobMember, getJobTeam, removeJobMember } from "./jobApi";
import type { JobTeam as Team } from "./jobApi";
import styles from "./jobs.module.css";
import { ErrorPopup } from "../ErrorPopup";

const kindLabels = { lead: "Lead", assistant: "Assisting" } as const;

/** Who works the job. Customer service assigns once the client has accepted the invoice. */
export function JobTeam({
  jobId,
  closedJob,
}: {
  jobId: string;
  closedJob: boolean;
}) {
  const { roles, isSuperAdmin } = useStaffAccess();
  const canAssign =
    !closedJob && (isSuperAdmin || roles.includes("customer_service_rep"));
  const [view, setView] = useState<Team | null>(null);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const [userId, setUserId] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setView(await getJobTeam(jobId));
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "The team could not be loaded",
      );
    }
  }, [jobId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!view) return <ErrorPopup message={error} />;

  const lead = view.team.find((member) => member.kind === "lead");
  const onTeam = new Set(view.team.map((member) => member.userId));
  const choices = view.candidates.filter((item) => !onTeam.has(item.userId));
  const kind = lead ? "assistant" : "lead";
  // Before the invoice is accepted only the super admin may assign, with a reason.
  const blocked = !view.invoiceAccepted && !isSuperAdmin;
  const needsReason = !view.invoiceAccepted && isSuperAdmin;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!userId) return;
    setSaving(true);
    setError("");
    try {
      await assignJobMember(jobId, {
        userId,
        kind,
        overrideReason: needsReason ? reason.trim() : undefined,
      });
      setUserId("");
      setReason("");
      setAdding(false);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The action failed");
    } finally {
      setSaving(false);
    }
  }

  async function remove(assignmentId: string) {
    setError("");
    try {
      await removeJobMember(jobId, assignmentId);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The action failed");
    }
  }

  return (
    <section className={styles.card} aria-labelledby="team-title">
      <div className={styles.stepsHeading}>
        <h2 id="team-title">Team</h2>
        {canAssign && !adding && !blocked && choices.length > 0 && (
          <button
            className={styles.secondaryButton}
            onClick={() => setAdding(true)}
            type="button"
          >
            {lead ? "Add an assistant" : "Assign a lead"}
          </button>
        )}
      </div>
      <ErrorPopup message={error} />
      {view.team.length === 0 ? (
        <p className={styles.muted}>
          {view.invoiceAccepted
            ? "Nobody assigned yet."
            : "Waiting for the client to accept the invoice."}
        </p>
      ) : (
        <ul className={styles.nextTasks}>
          {view.team.map((member) => (
            <li key={member.id}>
              <strong>{member.email ?? "Staff member"}</strong>
              <span>
                {kindLabels[member.kind]}
                {member.overrideReason
                  ? ` · Assigned before invoice acceptance: ${member.overrideReason}`
                  : ""}
              </span>
              {canAssign && (
                <button
                  className={styles.secondaryButton}
                  onClick={() => void remove(member.id)}
                  type="button"
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canAssign && adding && (
        <form className={styles.form} onSubmit={(event) => void submit(event)}>
          <label className={styles.field}>
            {lead ? "Assistant" : "Lead"}
            <select
              onChange={(event) => setUserId(event.target.value)}
              required
              value={userId}
            >
              <option value="">Choose a rep</option>
              {choices.map((item) => (
                <option key={item.userId} value={item.userId}>
                  {item.email ?? item.userId}
                </option>
              ))}
            </select>
          </label>
          {needsReason && (
            <label className={styles.field}>
              Reason to assign before the client accepts the invoice
              <input
                onChange={(event) => setReason(event.target.value)}
                required
                value={reason}
              />
            </label>
          )}
          <div className={styles.actions}>
            <button className={styles.button} disabled={saving} type="submit">
              {saving ? "Assigning…" : "Assign"}
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
      {view.history.length > view.team.length && (
        <details className={styles.etaHistory}>
          <summary>History</summary>
          <ul className={styles.list}>
            {view.history
              .filter((member) => member.removedAt)
              .map((member) => (
                <li key={member.id}>
                  {member.email ?? "Staff member"} · {kindLabels[member.kind]}{" "}
                  until {new Date(member.removedAt!).toLocaleDateString()}
                </li>
              ))}
          </ul>
        </details>
      )}
    </section>
  );
}
