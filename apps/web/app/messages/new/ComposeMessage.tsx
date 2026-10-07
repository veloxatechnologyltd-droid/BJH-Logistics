"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { listCustomers } from "../../customers/customerApi";
import type { CustomerCompany } from "../../customers/customerApi";
import styles from "../../jobs/jobs.module.css";
import { getFeed, sendClientMessage } from "../messageApi";
import type { ChannelMode, SendResult } from "../messageApi";
import { ErrorPopup } from "../../ErrorPopup";

/** Write to one company, several, or all of them, by the channels set in Business settings. */
export function ComposeMessage() {
  const [companies, setCompanies] = useState<CustomerCompany[]>([]);
  const [channels, setChannels] = useState<ChannelMode>("both");
  const [everyone, setEveryone] = useState(false);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<SendResult | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    listCustomers("")
      .then(setCompanies)
      .catch((cause: unknown) =>
        setError(
          cause instanceof Error ? cause.message : "Clients are unavailable",
        ),
      );
    getFeed({ limit: 1 })
      .then((feed) => setChannels(feed.channels))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (confirming) dialog.current?.showModal();
    else dialog.current?.close();
  }, [confirming]);

  const audience = useMemo(
    () =>
      everyone ? companies : companies.filter((item) => chosen.has(item.id)),
    [companies, chosen, everyone],
  );
  const reached = audience.flatMap((company) =>
    company.contacts.filter((contact) => contact.notify),
  );
  const companiesReached = audience.filter((company) =>
    company.contacts.some((contact) => contact.notify),
  ).length;
  const emails = channels === "sms" ? 0 : reached.length;
  const texts =
    channels === "email"
      ? 0
      : reached.filter((contact) => contact.phone).length;
  const visible = companies.filter((company) =>
    company.companyName.toLowerCase().includes(search.trim().toLowerCase()),
  );

  function toggle(id: string) {
    setChosen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function review(event: FormEvent) {
    event.preventDefault();
    setError("");
    setResult(null);
    if (audience.length === 0) {
      setError("Choose at least one client to write to.");
      return;
    }
    setConfirming(true);
  }

  async function send() {
    setSending(true);
    setError("");
    try {
      const outcome = await sendClientMessage({
        audience: everyone ? "all" : [...chosen],
        subject: subject.trim() || undefined,
        body,
      });
      setResult(outcome);
      setBody("");
      setSubject("");
      setChosen(new Set());
      setEveryone(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Sending failed");
    } finally {
      setSending(false);
      setConfirming(false);
    }
  }

  return (
    <>
      <form className={styles.compose} onSubmit={review}>
        <section className={styles.card} aria-labelledby="who-title">
          <h2 id="who-title">Who is it for?</h2>
          <label className={styles.choice}>
            <input
              checked={!everyone}
              name="audience"
              onChange={() => setEveryone(false)}
              type="radio"
            />
            <span>
              <strong>Chosen clients</strong>
              <small>Tick one company or several.</small>
            </span>
          </label>
          <label className={styles.choice}>
            <input
              checked={everyone}
              name="audience"
              onChange={() => setEveryone(true)}
              type="radio"
            />
            <span>
              <strong>Every client</strong>
              <small>A broadcast to all {companies.length} companies.</small>
            </span>
          </label>
          {!everyone && (
            <>
              <input
                aria-label="Search clients"
                className={styles.searchInput}
                onChange={(changed) => setSearch(changed.target.value)}
                placeholder="Search clients"
                type="search"
                value={search}
              />
              <div className={styles.picker}>
                {visible.length === 0 && (
                  <p className={styles.muted}>No clients match.</p>
                )}
                {visible.map((company) => {
                  const people = company.contacts.filter(
                    (contact) => contact.notify,
                  ).length;
                  return (
                    <label className={styles.choice} key={company.id}>
                      <input
                        checked={chosen.has(company.id)}
                        onChange={() => toggle(company.id)}
                        type="checkbox"
                      />
                      <span>
                        <strong>{company.companyName}</strong>
                        <small>
                          {people === 0
                            ? "Nobody to notify"
                            : `${people} ${people === 1 ? "person" : "people"}`}
                        </small>
                      </span>
                    </label>
                  );
                })}
              </div>
            </>
          )}
        </section>

        <section className={styles.card} aria-labelledby="what-title">
          <h2 id="what-title">What do you want to say?</h2>
          <div className={styles.form}>
            <label className={styles.field}>
              Subject (optional)
              <input
                maxLength={200}
                onChange={(changed) => setSubject(changed.target.value)}
                value={subject}
              />
            </label>
            <label className={styles.field}>
              Message
              <textarea
                maxLength={1500}
                onChange={(changed) => setBody(changed.target.value)}
                required
                rows={7}
                value={body}
              />
              <small className={styles.hint}>{body.length} / 1500</small>
            </label>
          </div>
          <p className={styles.muted}>
            {audience.length === 0
              ? "Choose who it is for."
              : `${reached.length} ${reached.length === 1 ? "person" : "people"} at ${companiesReached} ${companiesReached === 1 ? "company" : "companies"} · ${emails} ${emails === 1 ? "email" : "emails"}${channels === "email" ? "" : `, ${texts} ${texts === 1 ? "text" : "texts"}`}`}
          </p>
          <button
            className={styles.button}
            disabled={sending || audience.length === 0 || !body.trim()}
            type="submit"
          >
            Review and send
          </button>
        </section>
      </form>

      <ErrorPopup message={error} />
      {result && (
        <section className={styles.card} aria-live="polite">
          <h2>
            {result.sent.length === 0
              ? "Nothing was sent"
              : `Sent to ${result.sent.length} ${result.sent.length === 1 ? "company" : "companies"}`}
          </h2>
          {result.skipped.length > 0 && (
            <>
              <p className={styles.muted}>
                These companies have nobody to notify, so they were skipped:
              </p>
              <ul className={styles.list}>
                {result.skipped.map((item) => (
                  <li key={item.companyId}>{item.companyName}</li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}

      <dialog
        aria-labelledby="send-title"
        className={styles.dialog}
        onCancel={() => setConfirming(false)}
        ref={dialog}
      >
        <div className={styles.form}>
          <h2 id="send-title">Send this message?</h2>
          <p className={styles.muted}>
            It will go to {reached.length}{" "}
            {reached.length === 1 ? "person" : "people"} at {companiesReached}{" "}
            {companiesReached === 1 ? "company" : "companies"}. A message that
            has been sent cannot be taken back.
          </p>
          <div className={styles.actions}>
            <button
              className={styles.button}
              disabled={sending}
              onClick={() => void send()}
              type="button"
            >
              {sending ? "Sending…" : "Send now"}
            </button>
            <button
              className={styles.secondaryButton}
              onClick={() => setConfirming(false)}
              type="button"
            >
              Go back
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}
