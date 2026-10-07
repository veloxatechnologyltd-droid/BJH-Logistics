"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AuthStatus } from "../../auth/AuthStatus";
import { authenticatedFetch } from "../../auth/authenticatedFetch";
import styles from "../../jobs/jobs.module.css";
import { ErrorPopup } from "../../ErrorPopup";

const apiBaseUrl = (
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:3001/api"
).replace(/\/$/, "");
const url = `${apiBaseUrl}/v1/admin/notifications`;

type Row = {
  id: string;
  channel: "email" | "sms";
  recipient: string | null;
  contactName: string | null;
  status: "pending" | "sent" | "failed" | "skipped";
  attempts: number;
  lastError: string | null;
  provider: string | null;
  createdAt: string;
  sentAt: string | null;
  event: string;
  subject: string;
  companyName: string;
  fileNumber: string | null;
};

type Overview = {
  channels: "email" | "sms" | "both";
  providers: { email: string; sms: string };
  deliveries: Row[];
};

const modeLabels = {
  both: "Email and SMS",
  email: "Email only",
  sms: "SMS only",
};

async function read<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      message?: string | string[];
    } | null;
    const message = Array.isArray(body?.message)
      ? body.message.join(", ")
      : body?.message;
    throw new Error(message ?? "The request could not be completed");
  }
  return (await response.json()) as T;
}

/** What was sent to customers, what failed and why, with a way to retry. */
export function NotificationLog() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    try {
      setOverview(
        await read<Overview>(
          await authenticatedFetch(status ? `${url}?status=${status}` : url),
        ),
      );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "The log could not be loaded",
      );
    }
  }, [status]);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(action: () => Promise<Response>, done: string) {
    setError("");
    setNotice("");
    try {
      await read(await action());
      setNotice(done);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The action failed");
    }
  }

  const stubbed =
    overview &&
    (overview.providers.email === "stub" || overview.providers.sms === "stub");

  return (
    <>
      <header className="topbar">
        <div className="breadcrumb">
          <Link href="/">Workspace</Link>
          <span aria-hidden="true">/</span>
          <strong>Customer messages</strong>
        </div>
        <AuthStatus />
      </header>
      <main className={styles.page}>
        <header className={styles.header}>
          <div>
            <h1 className={styles.title}>Customer messages</h1>
          </div>
        </header>
        <ErrorPopup message={error} />
        {notice && <p className={styles.notice}>{notice}</p>}
        {overview && (
          <section className={styles.card}>
            <p>
              Channel: <strong>{modeLabels[overview.channels]}</strong> · Email
              sender: <strong>{overview.providers.email}</strong> · SMS sender:{" "}
              <strong>{overview.providers.sms}</strong>
            </p>
            {stubbed && (
              <p className={styles.error} role="status">
                Not connected: nothing is really sent.
              </p>
            )}
            <div className={styles.actions}>
              <label className={styles.field}>
                Show
                <select
                  onChange={(event) => setStatus(event.target.value)}
                  value={status}
                >
                  <option value="">Everything</option>
                  <option value="pending">Waiting to send</option>
                  <option value="failed">Failed</option>
                  <option value="sent">Sent</option>
                  <option value="skipped">Not sent (no address)</option>
                </select>
              </label>
              <button
                className={styles.secondaryButton}
                onClick={() =>
                  void act(
                    () =>
                      authenticatedFetch(`${url}/dispatch`, { method: "POST" }),
                    "Sent everything that was due.",
                  )
                }
                type="button"
              >
                Send what is due now
              </button>
            </div>
          </section>
        )}
        <section className={styles.card} aria-labelledby="log-title">
          <h2 id="log-title">Deliveries</h2>
          {overview && overview.deliveries.length === 0 && (
            <p className={styles.muted}>Nothing here yet.</p>
          )}
          {overview && overview.deliveries.length > 0 && (
            <div className={styles.tableScroll}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Created</th>
                    <th>Customer</th>
                    <th>Message</th>
                    <th>To</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {overview.deliveries.map((row) => (
                    <tr key={row.id}>
                      <td>{new Date(row.createdAt).toLocaleString()}</td>
                      <td>
                        {row.companyName}
                        {row.fileNumber ? ` · ${row.fileNumber}` : ""}
                      </td>
                      <td>{row.subject}</td>
                      <td>
                        {row.channel === "sms" ? "SMS" : "Email"} ·{" "}
                        {row.contactName ?? "-"} · {row.recipient ?? "-"}
                      </td>
                      <td>
                        {row.status}
                        {row.attempts > 0 ? ` (${row.attempts} tries)` : ""}
                        {row.lastError ? ` · ${row.lastError}` : ""}
                        {row.provider ? ` · ${row.provider}` : ""}
                      </td>
                      <td>
                        {row.status === "failed" && (
                          <button
                            className={styles.secondaryButton}
                            onClick={() =>
                              void act(
                                () =>
                                  authenticatedFetch(
                                    `${url}/deliveries/${encodeURIComponent(row.id)}/retry`,
                                    { method: "POST" },
                                  ),
                                "Queued to try again.",
                              )
                            }
                            type="button"
                          >
                            Retry
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </>
  );
}
