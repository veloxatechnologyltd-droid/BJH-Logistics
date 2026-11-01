"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useStaffAccess } from "../../auth/useStaffAccess";
import styles from "../../jobs/jobs.module.css";
import { ErrorPopup } from "../../ErrorPopup";
import {
  createKnowledge,
  deleteKnowledge,
  listKnowledge,
  markKnowledgeReviewed,
  updateKnowledge,
} from "./knowledgeApi";
import type { KnowledgeEntry } from "./knowledgeApi";

/**
 * The knowledge base the assistant answers inquiries from: one topic and its
 * answer per entry. An inquiry it cannot answer from these waits for a
 * person. Staff may read it; only the super admin changes it.
 */
export function KnowledgeBase() {
  const { isSuperAdmin } = useStaffAccess();
  const [entries, setEntries] = useState<KnowledgeEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  /** The entry being edited; "new" for a new one, null when the form is closed. */
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [title, setTitle] = useState("");
  const [answer, setAnswer] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setEntries(await listKnowledge());
      setLoaded(true);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not load the entries",
      );
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function open(entry: KnowledgeEntry | null) {
    setEditing(entry ? entry.id : "new");
    setTitle(entry?.title ?? "");
    setAnswer(entry?.answer ?? "");
    setNotice("");
    setError("");
  }

  async function act(action: () => Promise<unknown>, done: string) {
    setBusy(true);
    setError("");
    try {
      await action();
      setNotice(done);
      setEditing(null);
      setConfirmDelete(null);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const entry = { title: title.trim(), answer: answer.trim() };
    void act(
      () =>
        editing === "new"
          ? createKnowledge(entry)
          : updateKnowledge(editing!, entry),
      editing === "new" ? "Entry added." : "Entry saved.",
    );
  }

  const form = (
    <form className={styles.card} onSubmit={submit}>
      <div className={styles.form}>
        <label className={styles.field}>
          Topic
          <input
            maxLength={200}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="For example: Documents for sea import clearing"
            required
            value={title}
          />
        </label>
        <label className={styles.field}>
          Answer
          <textarea
            maxLength={5000}
            onChange={(event) => setAnswer(event.target.value)}
            required
            rows={6}
            value={answer}
          />
        </label>
        <div className={styles.actions}>
          <button className={styles.button} disabled={busy} type="submit">
            {busy ? "Saving…" : "Save entry"}
          </button>
          <button
            className={styles.secondaryButton}
            disabled={busy}
            onClick={() => setEditing(null)}
            type="button"
          >
            Cancel
          </button>
        </div>
      </div>
    </form>
  );

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Knowledge base</h1>
          <p className={styles.muted}>
            What the assistant may tell people who write to the inquiries
            address. It answers from these entries and the Email assistant text
            in Business settings; anything they do not cover goes to a person.
            {!isSuperAdmin && " · View only"}
          </p>
          {entries.some((entry) => entry.needsReview) && (
            <p className={styles.notice}>
              {entries.filter((entry) => entry.needsReview).length} entries were
              drafted from BJH&apos;s website and company profile. They are
              already used to answer inquiries: check each one, correct it, or
              delete it.
            </p>
          )}
        </div>
        <Link className={styles.secondaryButton} href="/settings">
          Back to settings
        </Link>
      </header>

      <ErrorPopup message={error} />
      {notice && <p className={styles.notice}>{notice}</p>}
      {!loaded && !error && <p role="status">Loading entries…</p>}

      {loaded && isSuperAdmin && editing === null && (
        <div className={styles.actions}>
          <button
            className={styles.button}
            onClick={() => open(null)}
            type="button"
          >
            Add an entry
          </button>
        </div>
      )}
      {editing === "new" && form}

      {loaded && entries.length === 0 && editing !== "new" && (
        <section className={styles.card}>
          <p className={styles.muted}>
            No entries yet. Add your services, documents needed, procedures,
            timelines and office hours, one topic per entry.
          </p>
        </section>
      )}

      {entries.map((entry) =>
        editing === entry.id ? (
          <div key={entry.id}>{form}</div>
        ) : (
          <section className={styles.card} key={entry.id}>
            <h2>{entry.title}</h2>
            {entry.needsReview && (
              <p className={styles.muted}>
                <strong>Drafted from your website: check it</strong>
              </p>
            )}
            <p style={{ whiteSpace: "pre-wrap" }}>{entry.answer}</p>
            <p className={styles.muted}>
              {entry.needsReview ? "Drafted" : "Last changed"}{" "}
              {new Intl.DateTimeFormat("en-GH", {
                dateStyle: "medium",
                timeStyle: "short",
                timeZone: "Africa/Accra",
              }).format(new Date(entry.updatedAt))}
            </p>
            {isSuperAdmin && editing === null && (
              <div className={styles.actions}>
                {entry.needsReview && (
                  <button
                    className={styles.button}
                    disabled={busy}
                    onClick={() =>
                      void act(
                        () => markKnowledgeReviewed(entry.id),
                        "Marked as checked.",
                      )
                    }
                    type="button"
                  >
                    Looks right
                  </button>
                )}
                <button
                  className={styles.secondaryButton}
                  onClick={() => open(entry)}
                  type="button"
                >
                  Edit
                </button>
                {confirmDelete === entry.id ? (
                  <>
                    <button
                      className={styles.button}
                      disabled={busy}
                      onClick={() =>
                        void act(
                          () => deleteKnowledge(entry.id),
                          "Entry deleted.",
                        )
                      }
                      type="button"
                    >
                      Yes, delete it
                    </button>
                    <button
                      className={styles.secondaryButton}
                      onClick={() => setConfirmDelete(null)}
                      type="button"
                    >
                      Keep it
                    </button>
                  </>
                ) : (
                  <button
                    className={styles.secondaryButton}
                    onClick={() => setConfirmDelete(entry.id)}
                    type="button"
                  >
                    Delete
                  </button>
                )}
              </div>
            )}
          </section>
        ),
      )}
    </main>
  );
}
