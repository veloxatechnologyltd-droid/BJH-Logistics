"use client";

import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { authenticatedFetch } from "../../auth/authenticatedFetch";
import adminStyles from "../../admin/users/adminUsers.module.css";
import styles from "./activityLog.module.css";
import { ErrorPopup } from "../../ErrorPopup";
import { describeAction, describeResult } from "./activityLabels";

const apiBaseUrl =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:3001/api";
const activityUrl = `${apiBaseUrl.replace(/\/$/, "")}/v1/admin/activity`;

type ActivityEntry = {
  id: string;
  occurredAt: string;
  actorUserId: string;
  actorName: string | null;
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

type Filters = { actor: string; entity: string; from: string; to: string };

const noFilters: Filters = { actor: "", entity: "", from: "", to: "" };

/** A date-time box value (local time, minute precision) as an ISO instant. */
function toIso(value: string, endOfMinute: boolean): string {
  const date = new Date(value);
  if (endOfMinute) date.setSeconds(59, 999);
  return date.toISOString();
}

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
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [applied, setApplied] = useState<Filters>(noFilters);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (nextPage: number, filters: Filters) => {
    setLoading(true);
    setError("");
    try {
      const query = new URLSearchParams({ page: String(nextPage) });
      if (filters.actor.trim()) query.set("actor", filters.actor.trim());
      if (filters.entity.trim()) query.set("entity", filters.entity.trim());
      if (filters.from) query.set("from", toIso(filters.from, false));
      if (filters.to) query.set("to", toIso(filters.to, true));
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
  }, []);

  useEffect(() => {
    void load(1, noFilters);
  }, [load]);

  function applyFilters(event: FormEvent) {
    event.preventDefault();
    if (from && to && new Date(from) > new Date(to)) {
      setError(
        "The “From” date and time must be before the “To” date and time",
      );
      return;
    }
    const filters = { actor, entity, from, to };
    setApplied(filters);
    void load(1, filters);
  }

  function clearFilters() {
    setActor("");
    setEntity("");
    setFrom("");
    setTo("");
    setApplied(noFilters);
    void load(1, noFilters);
  }

  return (
    <>
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
          <label>
            From (date and time)
            <input
              onChange={(event) => setFrom(event.target.value)}
              type="datetime-local"
              value={from}
            />
          </label>
          <label>
            To (date and time)
            <input
              onChange={(event) => setTo(event.target.value)}
              type="datetime-local"
              value={to}
            />
          </label>
          <button type="submit">Apply filters</button>
          <button onClick={clearFilters} type="button">
            Clear
          </button>
        </form>

        <ErrorPopup message={error} />
        <div className={styles.tableWrap}>
          <table className={styles.table} data-cards>
            <thead>
              <tr>
                <th>When</th>
                <th>User</th>
                <th>Action</th>
                <th>Record</th>
                <th>Result</th>
                <th>IP address</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <td data-label="When">{formatDate(entry.occurredAt)}</td>
                  <td data-label="User" title={entry.actorUserId}>
                    {entry.actorName ?? entry.actorUserId}
                  </td>
                  <td data-label="Action" data-wide>
                    {describeAction(entry.method, entry.route)}
                  </td>
                  <td data-label="Record" data-wide>
                    {entry.entityId ?? "—"}
                  </td>
                  <td
                    className={
                      describeResult(entry.statusCode).failed
                        ? styles.denied
                        : ""
                    }
                    data-label="Result"
                    title={`Status ${entry.statusCode}`}
                  >
                    {describeResult(entry.statusCode).text}
                  </td>
                  <td data-label="IP">{entry.clientIp ?? "—"}</td>
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
