"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { requestDetailKeys, requestDetailLabels } from "@bjh/contracts";
import type { RequestDetailKey, RequestDetails } from "@bjh/contracts";
import { ErrorPopup, plainMessage } from "../../../ErrorPopup";
import { serviceLineLabels } from "../../../jobs/jobApi";
import {
  getRequestAttachmentLink,
  readRequestEmailAgain,
  saveRequestDetails,
} from "../../quoteRequestApi";
import type { QuoteRequest } from "../../quoteRequestApi";
import styles from "../../quotation.module.css";

const formatDate = (value: string) =>
  new Intl.DateTimeFormat("en-GH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Africa/Accra",
  }).format(new Date(value));

const formatSize = (bytes: number) =>
  bytes >= 1_048_576
    ? `${(bytes / 1_048_576).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;

const shown = (key: RequestDetailKey, details: RequestDetails) => {
  const value = details[key];
  if (!value) return null;
  return key === "service"
    ? (serviceLineLabels[value as keyof typeof serviceLineLabels] ?? value)
    : value;
};

/**
 * For a request that arrived by email: what AI read from the email (service,
 * route, cargo and so on) for a person to check, and the email's attachments.
 * The super admin and the rep in charge of the request's service can correct
 * the details or read the email again (`canEdit`, decided by the API).
 */
export function EmailRequestPanel({
  request,
  canEdit,
  onChange,
}: {
  request: QuoteRequest;
  canEdit: boolean;
  onChange: (request: QuoteRequest) => void;
}) {
  const intake = request.intake;
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Record<RequestDetailKey, string>>(
    () =>
      Object.fromEntries(requestDetailKeys.map((key) => [key, ""])) as never,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!intake) return null;

  async function run(action: () => Promise<QuoteRequest>) {
    setBusy(true);
    setError("");
    try {
      onChange(await action());
      setEditing(false);
    } catch (cause) {
      setError(
        plainMessage(
          cause instanceof Error ? cause.message : "The action failed",
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  function startEditing() {
    setForm(
      Object.fromEntries(
        requestDetailKeys.map((key) => [key, request.details[key] ?? ""]),
      ) as Record<RequestDetailKey, string>,
    );
    setEditing(true);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void run(() =>
      saveRequestDetails(
        request.id,
        Object.fromEntries(
          requestDetailKeys.map((key) => [key, form[key].trim() || null]),
        ) as RequestDetails,
      ),
    );
  }

  async function openAttachment(attachmentId: string) {
    setError("");
    try {
      const link = await getRequestAttachmentLink(request.id, attachmentId);
      window.open(link.url, "_blank", "noopener");
    } catch (cause) {
      setError(
        plainMessage(
          cause instanceof Error
            ? cause.message
            : "The file could not be opened",
        ),
      );
    }
  }

  const needsCheck = intake.extractionStatus === "done" && !intake.reviewedAt;

  return (
    <>
      <section
        aria-labelledby="request-details-title"
        className={styles.emailPanel}
      >
        <h3 id="request-details-title">Details from the email</h3>
        <p className={styles.emailStatus}>
          {intake.extractionStatus === "pending" &&
            "The email is waiting to be read."}
          {intake.extractionStatus === "failed" &&
            `The email could not be read automatically (${intake.extractionError ?? "unknown reason"}). Fill in the details yourself${canEdit ? ", or try reading it again" : ""}.`}
          {needsCheck && (
            <>
              <span className={styles.emailNeedsCheck}>Please check.</span> AI
              read these from the email; compare them with the message below.
            </>
          )}
          {intake.reviewedAt && `Checked on ${formatDate(intake.reviewedAt)}.`}
        </p>
        {editing ? (
          <form className={styles.detailsForm} onSubmit={submit}>
            <label>
              {requestDetailLabels.service}
              <select
                onChange={(event) =>
                  setForm({ ...form, service: event.target.value })
                }
                value={form.service}
              >
                <option value="">Not stated</option>
                {Object.entries(serviceLineLabels).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            {requestDetailKeys
              .filter((key) => key !== "service")
              .map((key) => (
                <label key={key}>
                  {requestDetailLabels[key]}
                  <input
                    onChange={(event) =>
                      setForm({ ...form, [key]: event.target.value })
                    }
                    value={form[key]}
                  />
                </label>
              ))}
            <div className={styles.emailActions}>
              <button
                className={styles.primaryButton}
                disabled={busy}
                type="submit"
              >
                Save and mark as checked
              </button>
              <button
                className={styles.secondaryButton}
                disabled={busy}
                onClick={() => setEditing(false)}
                type="button"
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <>
            <dl className={styles.detailsList}>
              {requestDetailKeys.map((key) => {
                const value = shown(key, request.details);
                return (
                  <div key={key}>
                    <dt>{requestDetailLabels[key]}</dt>
                    <dd data-unknown={value ? undefined : ""}>
                      {value ?? "Not stated"}
                    </dd>
                  </div>
                );
              })}
            </dl>
            {canEdit && (
              <div className={styles.emailActions}>
                {needsCheck && (
                  <button
                    className={styles.primaryButton}
                    disabled={busy}
                    onClick={() =>
                      void run(() =>
                        saveRequestDetails(request.id, request.details),
                      )
                    }
                    type="button"
                  >
                    Looks right
                  </button>
                )}
                <button
                  className={styles.secondaryButton}
                  disabled={busy}
                  onClick={startEditing}
                  type="button"
                >
                  Edit details
                </button>
                {!intake.reviewedAt && intake.extractionStatus !== "done" && (
                  <button
                    className={styles.secondaryButton}
                    disabled={busy}
                    onClick={() =>
                      void run(() => readRequestEmailAgain(request.id))
                    }
                    type="button"
                  >
                    Read the email again
                  </button>
                )}
              </div>
            )}
          </>
        )}
        <ErrorPopup message={error} />
      </section>

      <section
        aria-labelledby="request-email-title"
        className={styles.emailPanel}
      >
        <h3 id="request-email-title">The email</h3>
        <p className={styles.emailStatus}>
          From {intake.fromName ? `${intake.fromName} · ` : ""}
          {intake.fromEmail} · {formatDate(intake.receivedAt)}
          {intake.subject ? ` · “${intake.subject}”` : ""}
        </p>
        {intake.attachments.length > 0 && (
          <ul className={styles.attachmentList}>
            {intake.attachments.map((attachment) => (
              <li key={attachment.id}>
                <span>
                  {attachment.filename} · {formatSize(attachment.sizeBytes)}
                </span>
                <button
                  className={styles.secondaryButton}
                  onClick={() => void openAttachment(attachment.id)}
                  type="button"
                >
                  Open
                </button>
              </li>
            ))}
          </ul>
        )}
        {intake.skippedAttachments.map((skipped) => (
          <p className={styles.attachmentNote} key={skipped.filename}>
            Not kept: {skipped.filename} ({skipped.reason})
          </p>
        ))}
      </section>
    </>
  );
}
