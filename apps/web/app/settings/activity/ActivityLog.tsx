"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { AuthStatus } from "../../auth/AuthStatus";
import { authenticatedFetch } from "../../auth/authenticatedFetch";
import adminStyles from "../../admin/users/adminUsers.module.css";
import styles from "./activityLog.module.css";
import { ErrorPopup } from "../../ErrorPopup";

const apiBaseUrl =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:3001/api";
const activityUrl = `${apiBaseUrl.replace(/\/$/, "")}/v1/admin/activity`;

type ActivityEntry = {
  id: string;
  occurredAt: string;
  actorUserId: string;
  actorEmail: string | null;
  method: string;
  route: string;
  entityId: string | null;
  statusCode: number;
  clientIp: string | null;
};

type ActivityPage = {
  page: number;
  pageSize: number;
  entries: ActivityEntry[];
};

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(new Date(value));
}

export function ActivityLog() {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [actor, setActor] = useState("");
  const [entity, setEntity] = useState("");
  const [applied, setApplied] = useState({ actor: "", entity: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(
    async (nextPage: number, filters: { actor: string; entity: string }) => {
      setLoading(true);
      setError("");
      try {
        const query = new URLSearchParams({ page: String(nextPage) });
        if (filters.actor.trim()) query.set("actor", filters.actor.trim());
        if (filters.entity.trim()) query.set("entity", filters.entity.trim());
        const response = await authenticatedFetch(`${activityUrl}?${query}`);
        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as {
            message?: string | string[];
          } | null;
          throw new Error(
            (Array.isArray(body?.message)
              ? body.message.join(", ")
              : body?.message) ?? "The activity log could not be loaded",
          );
        }
        const result = (await response.json()) as ActivityPage;
        setEntries(result.entries);
        setPage(result.page);
        setPageSize(result.pageSize);
      } catch (cause) {
        setError(
          cause instanceof Error ? cause.message : "The activity log failed",
        );
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    void load(1, { actor: "", entity: "" });
  }, [load]);

  function applyFilters(event: FormEvent) {
    event.preventDefault();
    const filters = { actor, entity };
    setApplied(filters);
    void load(1, filters);
  }

  return (
    <>
      <header className="topbar">
        <div className="breadcrumb">
          <Link href="/">Workspace</Link>
          <span aria-hidden="true">/</span>
          <Link href="/settings">Settings</Link>
          <span aria-hidden="true">/</span>
          <strong>Activity log</strong>
        </div>
        <AuthStatus />
      </header>
      <main className={adminStyles.page}>
        <section className={adminStyles.heading}>
          <div>
            <h1>Activity log</h1>
          </div>
        </section>

        <form className={styles.filters} onSubmit={applyFilters}>
          <label>
            User ID
            <input
              onChange={(event) => setActor(event.target.value)}
              placeholder="Filter by user ID"
              value={actor}
            />
          </label>
          <label>
            Record ID (job, customer, request…)
            <input
              onChange={(event) => setEntity(event.target.value)}
              placeholder="Filter by record ID"
              value={entity}
            />
          </label>
          <button type="submit">Apply filters</button>
        </form>

        <ErrorPopup message={error} />
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>When</th>
                <th>User</th>
                <th>Action</th>
                <th>Record</th>
                <th>Result</th>
                <th>IP</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <td>{formatDate(entry.occurredAt)}</td>
                  <td title={entry.actorUserId}>
                    {entry.actorEmail ?? entry.actorUserId}
                  </td>
                  <td>
                    {entry.method} {entry.route}
                  </td>
                  <td>{entry.entityId ?? "—"}</td>
                  <td className={entry.statusCode >= 400 ? styles.denied : ""}>
                    {entry.statusCode}
                  </td>
                  <td>{entry.clientIp ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && entries.length === 0 && !error && (
            <p>No activity matches these filters.</p>
          )}
        </div>
        <div className={adminStyles.pagination}>
          <button
            disabled={loading || page <= 1}
            onClick={() => void load(page - 1, applied)}
            type="button"
          >
            Previous
          </button>
          <span>Page {page}</span>
          <button
            disabled={loading || entries.length < pageSize}
            onClick={() => void load(page + 1, applied)}
            type="button"
          >
            Next
          </button>
        </div>
      </main>
    </>
  );
}
