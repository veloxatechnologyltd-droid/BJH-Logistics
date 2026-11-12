"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ErrorPopup } from "../../ErrorPopup";
import {
  announceDraftsChanged,
  approveDraft,
  approveDrafts,
  editDraft,
  listDrafts,
  rejectDraft,
} from "../salesApi";
import type { Draft, DraftListStatus } from "../salesApi";
import { draftChanged } from "../salesView";
import styles from "../sales.module.css";

const tabs: Array<[DraftListStatus, string]> = [
  ["pending", "Waiting"],
  ["approved", "Approved"],
  ["rejected", "Rejected"],
  ["sent", "Sent"],
];

const message = (cause: unknown, fallback: string) =>
  cause instanceof Error ? cause.message : fallback;

const when = (value: string) =>
  new Date(value).toLocaleString("en-GH", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

/** The emails written for found businesses. Approval adds the message to the sales mailbox send queue. */
export function Approvals() {
  const [status, setStatus] = useState<DraftListStatus>("pending");
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [counts, setCounts] = useState<Record<DraftListStatus, number>>({
    pending: 0,
    approved: 0,
    rejected: 0,
    sent: 0,
  });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(() => {
    listDrafts(status, 100)
      .then((page) => {
        setDrafts(page.items);
        setCounts(page.counts);
      })
      .catch((cause) =>
        setError(message(cause, "The emails could not be loaded")),
      );
  }, [status]);

  useEffect(() => {
    setDrafts(null);
    setSelected(new Set());
    setEditing(null);
    setRejecting(null);
    load();
  }, [load]);

  async function run(work: () => Promise<void>, failure: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await work();
      announceDraftsChanged();
      load();
    } catch (cause) {
      setError(message(cause, failure));
      // Someone else may have decided it first: show what is true now.
      load();
    } finally {
      setBusy(false);
    }
  }

  const approveOne = (draft: Draft) =>
    run(async () => {
      const result = await approveDraft(draft.id);
      setNotice(
        result.sendStatus === "suppressed"
          ? `Approved the email to ${draft.businessName}, but its address is suppressed. Review the status in Email.`
          : `Approved and queued the email to ${draft.businessName}. Its send status appears in Email.`,
      );
    }, "The email could not be approved");

  const approveChosen = () =>
    run(async () => {
      const result = await approveDrafts([...selected]);
      setSelected(new Set());
      setNotice(
        `Approved ${result.approved}; queued ${result.queued}; suppressed ${result.suppressed}.` +
          (result.notPending > 0
            ? ` ${result.notPending} had already been decided.`
            : ""),
      );
    }, "The emails could not be approved");

  const pendingIds = (drafts ?? []).map((draft) => draft.id);
  const allChosen =
    pendingIds.length > 0 && pendingIds.every((id) => selected.has(id));

  return (
    <>
      <ErrorPopup message={error} />

      <p className={styles.statusLine} role="note">
        <strong>Approval queues the email for sending.</strong> Sent lists
        emails accepted by the mail provider; this does not confirm delivery.
      </p>

      <div className={styles.filterBar}>
        <div role="group" aria-label="Show" className={styles.actions}>
          {tabs.map(([value, label]) => (
            <button
              aria-pressed={status === value}
              className={status === value ? styles.btnPrimary : styles.btn}
              key={value}
              onClick={() => setStatus(value)}
              type="button"
            >
              {label} ({counts[value]})
            </button>
          ))}
        </div>
        {status === "pending" && (drafts ?? []).length > 0 && (
          <label className={styles.check} style={{ marginLeft: "auto" }}>
            <input
              checked={allChosen}
              onChange={() =>
                setSelected(allChosen ? new Set() : new Set(pendingIds))
              }
              type="checkbox"
            />
            Choose all waiting
          </label>
        )}
      </div>

      {notice && (
        <p className={styles.statusLine} role="status">
          {notice}
        </p>
      )}

      {selected.size > 0 && (
        <div
          className={styles.bulkBar}
          role="region"
          aria-label="Chosen emails"
        >
          <span className={styles.bulkCount}>{selected.size} chosen</span>
          <button
            className={styles.btnPrimary}
            disabled={busy}
            onClick={approveChosen}
            type="button"
          >
            Approve {selected.size} {selected.size === 1 ? "email" : "emails"}
          </button>
          <button
            className={styles.btnQuiet}
            onClick={() => setSelected(new Set())}
            type="button"
          >
            Clear
          </button>
        </div>
      )}

      {!drafts && !error && <p className={styles.empty}>Loading…</p>}

      {drafts && drafts.length === 0 && (
        <div className={styles.emptyState}>
          <h2>
            {status === "pending"
              ? "No emails are waiting"
              : status === "approved"
                ? "Nothing approved yet"
                : status === "rejected"
                  ? "Nothing rejected"
                  : "Nothing sent yet"}
          </h2>
          <p>
            {status === "pending"
              ? "Choose businesses in the lead pool and press “Draft emails”. They appear here for you to read and approve."
              : "Emails you decide on are kept here."}
          </p>
          {status === "pending" && (
            <Link className={styles.btnPrimary} href="/sales/pool">
              Go to the lead pool
            </Link>
          )}
        </div>
      )}

      <div className={styles.draftList}>
        {(drafts ?? []).map((draft) => (
          <DraftCard
            busy={busy}
            chosen={selected.has(draft.id)}
            draft={draft}
            editing={editing === draft.id}
            key={draft.id}
            onApprove={() => approveOne(draft)}
            onCancel={() => {
              setEditing(null);
              setRejecting(null);
            }}
            onChoose={() =>
              setSelected((current) => {
                const next = new Set(current);
                if (next.has(draft.id)) next.delete(draft.id);
                else next.add(draft.id);
                return next;
              })
            }
            onEdit={() => {
              setRejecting(null);
              setEditing(draft.id);
            }}
            onReject={() => {
              setEditing(null);
              setRejecting(draft.id);
            }}
            onSave={(form) =>
              run(async () => {
                await editDraft(draft.id, form);
                setEditing(null);
                setNotice("Saved your changes.");
              }, "The email could not be saved")
            }
            onSubmitReject={(reason) =>
              run(async () => {
                await rejectDraft(draft.id, reason);
                setRejecting(null);
                setNotice(`Rejected the email to ${draft.businessName}.`);
              }, "The email could not be rejected")
            }
            rejecting={rejecting === draft.id}
          />
        ))}
      </div>
    </>
  );
}

function DraftCard(props: {
  draft: Draft;
  chosen: boolean;
  editing: boolean;
  rejecting: boolean;
  busy: boolean;
  onChoose: () => void;
  onEdit: () => void;
  onReject: () => void;
  onCancel: () => void;
  onApprove: () => void;
  onSave: (form: {
    recipientEmail: string;
    subject: string;
    body: string;
  }) => void;
  onSubmitReject: (reason: string) => void;
}) {
  const { draft, editing, rejecting, busy } = props;
  const [form, setForm] = useState({
    recipientEmail: draft.recipientEmail,
    subject: draft.subject,
    body: draft.body,
  });
  const [reason, setReason] = useState("");
  const [sentExpanded, setSentExpanded] = useState(false);

  // Opening the editor starts from what is saved now.
  useEffect(() => {
    if (editing) {
      setForm({
        recipientEmail: draft.recipientEmail,
        subject: draft.subject,
        body: draft.body,
      });
    }
  }, [editing, draft.recipientEmail, draft.subject, draft.body]);

  const pending = draft.status === "pending";
  const sent = draft.sendStatus === "accepted" && draft.sentAt !== null;

  return (
    <article
      className={`${styles.draft}${sent && !sentExpanded ? ` ${styles.sentCollapsed}` : sent ? ` ${styles.sentDraft}` : ""}`}
      aria-label={`Email to ${draft.businessName}`}
    >
      {sent && (
        <button
          aria-expanded={sentExpanded}
          className={styles.sentSummary}
          onClick={() => setSentExpanded((expanded) => !expanded)}
          type="button"
        >
          <strong>{draft.businessName}</strong>
          <span className={styles.sentSubject}>{draft.subject}</span>
          <span className={styles.sentDate}>Sent {when(draft.sentAt!)}</span>
          <span aria-hidden="true" className={styles.sentChevron}>
            {sentExpanded ? "▾" : "▸"}
          </span>
        </button>
      )}

      <div className={styles.draftTop}>
        {pending && (
          <input
            aria-label={`Choose the email to ${draft.businessName}`}
            checked={props.chosen}
            onChange={props.onChoose}
            style={{ marginTop: 5 }}
            type="checkbox"
          />
        )}
        <div className={styles.draftWho}>
          <strong>{draft.businessName}</strong>
          <span className={styles.bizSub}>
            {draft.campaignName}
            {draft.score !== null ? ` · Fit ${draft.score}` : ""}
            {draft.category ? ` · ${draft.category}` : ""}
          </span>
        </div>
        <div className={styles.draftMeta}>
          <span className={styles.pill}>
            {draft.method === "ai" ? "Written by AI" : "Standard wording"}
          </span>
          {draft.edited && (
            <span className={`${styles.pill} ${styles.pillOutline}`}>
              Edited
            </span>
          )}
          {draft.status === "approved" && statusBadge(draft)}
          {draft.status === "rejected" && (
            <span className={`${styles.pill} ${styles.pillOutline}`}>
              Rejected
            </span>
          )}
          {!sent && draft.sentAt && (
            <span className={styles.pillStrong}>Sent {when(draft.sentAt)}</span>
          )}
        </div>
      </div>

      {editing ? (
        <form
          className={styles.editForm}
          onSubmit={(event) => {
            event.preventDefault();
            props.onSave({
              recipientEmail: form.recipientEmail.trim(),
              subject: form.subject.trim(),
              body: form.body.trim(),
            });
          }}
        >
          <label>
            To
            <input
              onChange={(event) =>
                setForm({ ...form, recipientEmail: event.target.value })
              }
              required
              type="email"
              value={form.recipientEmail}
            />
          </label>
          <label>
            Subject
            <input
              maxLength={200}
              onChange={(event) =>
                setForm({ ...form, subject: event.target.value })
              }
              required
              value={form.subject}
            />
          </label>
          <label>
            Message
            <textarea
              maxLength={5000}
              onChange={(event) =>
                setForm({ ...form, body: event.target.value })
              }
              required
              value={form.body}
            />
          </label>
          <div className={styles.actions}>
            <button
              className={styles.btnPrimary}
              disabled={busy || !draftChanged(draft, form)}
              type="submit"
            >
              Save changes
            </button>
            <button
              className={styles.btn}
              onClick={props.onCancel}
              type="button"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div className={styles.mail}>
          <p className={styles.mailTo}>To: {draft.recipientEmail}</p>
          <p className={styles.mailSubject}>{draft.subject}</p>
          <pre className={styles.mailBody}>{draft.body}</pre>
        </div>
      )}

      {pending && !editing && !rejecting && (
        <div className={styles.actions}>
          <button
            className={styles.btnPrimary}
            disabled={busy}
            onClick={props.onApprove}
            type="button"
          >
            Approve
          </button>
          <button className={styles.btn} onClick={props.onEdit} type="button">
            Edit
          </button>
          <button className={styles.btn} onClick={props.onReject} type="button">
            Reject
          </button>
        </div>
      )}

      {rejecting && (
        <form
          className={styles.editForm}
          onSubmit={(event) => {
            event.preventDefault();
            props.onSubmitReject(reason.trim());
          }}
        >
          <label>
            Why? (optional)
            <input
              maxLength={500}
              onChange={(event) => setReason(event.target.value)}
              placeholder="For example: wrong tone, or not a fit"
              value={reason}
            />
          </label>
          <div className={styles.actions}>
            <button className={styles.btnPrimary} disabled={busy} type="submit">
              Reject this email
            </button>
            <button
              className={styles.btn}
              onClick={props.onCancel}
              type="button"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {draft.decidedAt && (
        <p className={styles.decisionNote}>
          {draft.status === "approved" ? "Approved" : "Rejected"} by{" "}
          {draft.decidedByName ?? "a staff member"} on {when(draft.decidedAt)}
          {draft.rejectedReason ? ` · ${draft.rejectedReason}` : ""}
        </p>
      )}
    </article>
  );
}

function statusBadge(draft: Draft) {
  const label =
    draft.sendStatus === "queued"
      ? "Approved · queued"
      : draft.sendStatus === "sending"
        ? "Sending"
        : draft.sendStatus === "accepted"
          ? "Sent · provider accepted"
          : draft.sendStatus === "failed"
            ? "Send failed"
            : draft.sendStatus === "unknown"
              ? "Send status unknown"
              : draft.sendStatus === "stubbed"
                ? "Stubbed · not sent"
                : "Approved · waiting to send";
  return <span className={`${styles.pill} ${styles.pillStrong}`}>{label}</span>;
}
