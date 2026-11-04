"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { NavIcon } from "../NavIcon";
import {
  createSupportRequest,
  kindLabels,
  listMySupportRequests,
  openSupportEvent,
  replyToMyRequest,
  shownError,
  supportButtonMounted,
  statusLabels,
} from "./supportApi";
import type { SupportKind, SupportRequest } from "./supportApi";
import { SupportThread } from "./SupportThread";
import styles from "./support.module.css";

const formatDate = (value: string) =>
  new Date(value).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

/**
 * "Get help" at the foot of the sidebar, for staff and customers: report a
 * problem, ask for a feature or ask a question. The page, browser and last
 * error shown are sent with it, so nobody has to describe them.
 */
export function SupportButton() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<SupportKind>("problem");
  const [description, setDescription] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [earlier, setEarlier] = useState<SupportRequest[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  // The error popup's "Report this problem" opens the form here.
  useEffect(() => {
    const show = () => {
      setKind("problem");
      setOpen(true);
    };
    window.addEventListener(openSupportEvent, show);
    const unmounted = supportButtonMounted();
    return () => {
      window.removeEventListener(openSupportEvent, show);
      unmounted();
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    setSent(false);
    setError("");
    setOpenId(null);
    textRef.current?.focus();
    listMySupportRequests()
      .then(setEarlier)
      // The list is a convenience; sending still works without it.
      .catch(() => setEarlier(null));
  }, [open]);

  const close = () => setOpen(false);

  async function reply(id: string, body: string) {
    const updated = await replyToMyRequest(id, body);
    setEarlier((current) =>
      (current ?? []).map((item) => (item.id === id ? updated : item)),
    );
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSending(true);
    setError("");
    try {
      const saved = await createSupportRequest({
        kind,
        description: description.trim(),
        pagePath: pathname,
        userAgent: navigator.userAgent.slice(0, 500),
        lastError: kind === "problem" ? shownError() : null,
      });
      setDescription("");
      setSent(true);
      setEarlier((current) => [saved, ...(current ?? [])]);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Your message was not sent",
      );
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <button
        className="nav-link support-link"
        onClick={() => setOpen(true)}
        title="Get help"
        type="button"
      >
        <NavIcon name="help" />
        <span className="nav-label">Get help</span>
      </button>

      {open && (
        <div
          className={styles.backdrop}
          onClick={close}
          onKeyDown={(event) => event.key === "Escape" && close()}
        >
          <div
            className={styles.dialog}
            role="dialog"
            aria-modal="true"
            aria-labelledby="support-title"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="support-title">Get help</h2>
            <p className={styles.hint}>
              Tell us about a problem, a feature you need, or ask a question. We
              see which page you are on, so you do not need to explain that.
            </p>

            {sent ? (
              <p className={styles.notice} role="status">
                Thank you. Your message was sent and you will hear back soon.
              </p>
            ) : (
              <form className={styles.form} onSubmit={submit}>
                <fieldset className={styles.kinds}>
                  <legend>What is this about?</legend>
                  {(Object.keys(kindLabels) as SupportKind[]).map((value) => (
                    <label key={value}>
                      <input
                        checked={kind === value}
                        name="support-kind"
                        onChange={() => setKind(value)}
                        type="radio"
                        value={value}
                      />
                      {kindLabels[value]}
                    </label>
                  ))}
                </fieldset>
                <label className={styles.field}>
                  {kind === "problem"
                    ? "What went wrong? What were you trying to do?"
                    : kind === "feature"
                      ? "What do you need, and what would it help you do?"
                      : "Your question"}
                  <textarea
                    maxLength={4000}
                    onChange={(event) => setDescription(event.target.value)}
                    ref={textRef}
                    required
                    rows={6}
                    value={description}
                  />
                </label>
                {error && (
                  <p className={styles.error} role="alert">
                    {error}
                  </p>
                )}
                <div className={styles.actions}>
                  <button
                    className={styles.secondary}
                    onClick={close}
                    type="button"
                  >
                    Cancel
                  </button>
                  <button
                    className={styles.primary}
                    disabled={sending || !description.trim()}
                    type="submit"
                  >
                    {sending ? "Sending…" : "Send"}
                  </button>
                </div>
              </form>
            )}

            {earlier && earlier.length > 0 && (
              <section aria-labelledby="support-earlier">
                <h3 id="support-earlier" className={styles.earlierTitle}>
                  What you sent before
                </h3>
                <ul className={styles.earlier}>
                  {earlier.slice(0, 5).map((item) => (
                    <li key={item.id}>
                      <button
                        aria-expanded={openId === item.id}
                        className={styles.earlierHead}
                        onClick={() =>
                          setOpenId(openId === item.id ? null : item.id)
                        }
                        type="button"
                      >
                        <span
                          className={
                            openId === item.id ? undefined : styles.earlierText
                          }
                        >
                          {kindLabels[item.kind]}: {item.description}
                        </span>
                        <span className={styles.earlierMeta}>
                          {formatDate(item.createdAt)} ·{" "}
                          <strong>{statusLabels[item.status]}</strong>
                          {item.messages.length > 0 &&
                            ` · ${item.messages.length} ${
                              item.messages.length === 1 ? "reply" : "replies"
                            }`}
                        </span>
                      </button>
                      {openId === item.id && (
                        <SupportThread
                          messages={item.messages}
                          nameFor={(message) =>
                            message.authorRole === "support" ? "Support" : "You"
                          }
                          onSend={(body) => reply(item.id, body)}
                          sendLabel="Send"
                        />
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {sent && (
              <div className={styles.actions}>
                <button
                  className={styles.primary}
                  onClick={close}
                  type="button"
                >
                  Close
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
