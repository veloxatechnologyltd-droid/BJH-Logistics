"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { RequestKind } from "@bjh/contracts";
import { ErrorPopup, plainMessage } from "../../../ErrorPopup";
import {
  draftRequestReply,
  saveRequestReply,
  sendRequestReply,
} from "../../quoteRequestApi";
import type { QuoteRequest } from "../../quoteRequestApi";
import styles from "../../quotation.module.css";

const kindLabels: Record<RequestKind, string> = {
  quote: "Asks for a quote",
  inquiry: "Asks a question",
  other: "Needs no answer",
};

const formatDate = (value: string) =>
  new Intl.DateTimeFormat("en-GH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Africa/Accra",
  }).format(new Date(value));

/**
 * For a request that arrived by email: what the assistant did with it (linked
 * or created the customer, drafted a quote), and the reply it drafted. A
 * person edits the reply and presses Send; nothing is sent before that. The
 * super admin and the rep in charge of the request's service can act
 * (`canEdit`, decided by the API).
 */
export function AssistantPanel({
  request,
  canEdit,
  onChange,
}: {
  request: QuoteRequest;
  canEdit: boolean;
  onChange: (request: QuoteRequest) => void;
}) {
  const intake = request.intake;
  const reply = intake?.reply ?? null;
  const [subject, setSubject] = useState(reply?.subject ?? "");
  const [body, setBody] = useState(reply?.body ?? "");
  const [busy, setBusy] = useState<"" | "draft" | "save" | "send">("");
  const [error, setError] = useState("");

  // A new draft from the server replaces what is in the boxes.
  useEffect(() => {
    setSubject(reply?.subject ?? "");
    setBody(reply?.body ?? "");
  }, [reply?.subject, reply?.body]);

  if (!intake || intake.extractionStatus !== "done") return null;

  async function run(
    kind: "draft" | "save" | "send",
    action: () => Promise<QuoteRequest>,
  ) {
    setBusy(kind);
    setError("");
    try {
      onChange(await action());
    } catch (cause) {
      setError(
        plainMessage(
          cause instanceof Error ? cause.message : "The action failed",
        ),
      );
    } finally {
      setBusy("");
    }
  }

  const sent = reply?.sentAt ?? null;
  const ready = subject.trim() !== "" && body.trim() !== "";
  const edited =
    subject !== (reply?.subject ?? "") || body !== (reply?.body ?? "");

  return (
    <section aria-labelledby="assistant-title" className={styles.emailPanel}>
      <h3 id="assistant-title">What the assistant did</h3>
      <p className={styles.emailStatus}>
        {intake.kind ? kindLabels[intake.kind] : "Not sorted: decide by hand"}
      </p>
      {intake.assistantNotes.length > 0 && (
        <ul className={styles.assistantNotes}>
          {intake.assistantNotes.map((note, index) => (
            <li key={index}>{note}</li>
          ))}
        </ul>
      )}
      {request.quoteId && request.quoteStatus === "draft" && (
        <p className={styles.emailStatus}>
          <Link href={`/quotes/${request.quoteId}`}>
            Check the draft quote, then issue it
          </Link>
        </p>
      )}

      {intake.kind !== "other" && (
        <div className={styles.replyBlock}>
          <h3>Reply to {intake.fromEmail}</h3>
          {sent ? (
            <>
              <p className={styles.emailStatus}>
                Sent on {formatDate(sent)}. It is listed under Settings,
                Customer messages.
              </p>
              <p className={styles.replySubject}>{reply?.subject}</p>
              <p className={styles.replySent}>{reply?.body}</p>
            </>
          ) : (
            <>
              <p className={styles.emailStatus}>
                {reply?.model
                  ? `Drafted by AI${reply.draftedAt ? ` on ${formatDate(reply.draftedAt)}` : ""}. Read it, correct anything wrong, then send it.`
                  : reply
                    ? "Edited by staff, not sent yet."
                    : "No reply drafted yet."}
              </p>
              <form
                className={styles.replyForm}
                onSubmit={(event) => {
                  event.preventDefault();
                  void run("send", () =>
                    sendRequestReply(request.id, { subject, body }),
                  );
                }}
              >
                <label>
                  Subject
                  <input
                    disabled={!canEdit}
                    onChange={(event) => setSubject(event.target.value)}
                    value={subject}
                  />
                </label>
                <label>
                  Message
                  <textarea
                    disabled={!canEdit}
                    onChange={(event) => setBody(event.target.value)}
                    rows={12}
                    value={body}
                  />
                </label>
                {canEdit && (
                  <div className={styles.emailActions}>
                    <button
                      className={styles.primaryButton}
                      disabled={
                        busy !== "" || !ready || !request.customerCompanyId
                      }
                      type="submit"
                    >
                      {busy === "send" ? "Sending…" : "Send reply"}
                    </button>
                    <button
                      className={styles.secondaryButton}
                      disabled={busy !== "" || !ready || !edited}
                      onClick={() =>
                        void run("save", () =>
                          saveRequestReply(request.id, { subject, body }),
                        )
                      }
                      type="button"
                    >
                      Save changes
                    </button>
                    <button
                      className={styles.secondaryButton}
                      disabled={busy !== ""}
                      onClick={() =>
                        void run("draft", () => draftRequestReply(request.id))
                      }
                      type="button"
                    >
                      {busy === "draft"
                        ? "Drafting…"
                        : reply
                          ? "Draft again"
                          : "Draft with AI"}
                    </button>
                  </div>
                )}
                {canEdit && !request.customerCompanyId && (
                  <p className={styles.attachmentNote}>
                    Link the request to a customer before sending.
                  </p>
                )}
              </form>
            </>
          )}
        </div>
      )}
      <ErrorPopup message={error} />
    </section>
  );
}
