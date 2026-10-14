"use client";

import { useEffect, useState } from "react";

const apiBaseUrl =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:3001/api";

type Health = {
  status?: string;
  database?: { status?: string; provider?: string };
};

export default function SystemStatusPage() {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    fetch(`${apiBaseUrl.replace(/\/$/, "")}/health`)
      .then(async (response) => {
        if (!response.ok) throw new Error("Health check failed");
        return (await response.json()) as Health;
      })
      .then((result) => {
        if (active) setHealth(result);
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <>
      <main className="dashboard">
        <section className="welcome-row" aria-labelledby="status-title">
          <div>
            <h1 id="status-title">System status</h1>
          </div>
        </section>
        <section className="work-panel" aria-live="polite">
          {health ? (
            <>
              <h2>API: {health.status ?? "Unknown"}</h2>
              <p className="welcome-copy">
                Database: {health.database?.status ?? "Unknown"}
                {health.database?.provider
                  ? ` (${health.database.provider})`
                  : ""}
              </p>
            </>
          ) : error ? (
            <p role="status">
              System status is unavailable. The API did not respond.
            </p>
          ) : (
            <p role="status">Checking system status…</p>
          )}
        </section>
      </main>
    </>
  );
}
