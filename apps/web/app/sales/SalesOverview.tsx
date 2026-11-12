"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ErrorPopup } from "../ErrorPopup";
import { getSalesOverview } from "./salesApi";
import type {
  PipelinePerformance,
  SalesOverview as Overview,
} from "./salesApi";
import styles from "./sales.module.css";

const message = (cause: unknown, fallback: string) =>
  cause instanceof Error ? cause.message : fallback;

const shortDay = (value: string) =>
  new Date(`${value.slice(0, 10)}T00:00:00`).toLocaleDateString("en-GH", {
    day: "numeric",
    month: "short",
  });

const shortDateTime = (value: string) =>
  new Date(value).toLocaleString("en-GH", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

const stageLabels: Record<string, string> = {
  new: "New",
  contacted: "Contacted",
  quoted: "Quoted",
  won: "Won",
  lost: "Lost",
};

const activityLabels: Record<string, string> = {
  call: "Call",
  visit: "Visit",
  email: "Email",
  meeting: "Meeting",
  note: "Note",
};

/** Where the sales work stands: what waits for a person, how far found businesses got, what is due. */
export function SalesOverview() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    getSalesOverview()
      .then(setData)
      .catch((cause) =>
        setError(message(cause, "The overview could not be loaded")),
      );
  }, []);

  if (!data) {
    return (
      <>
        <ErrorPopup message={error} />
        {!error && <p className={styles.empty}>Loading…</p>}
      </>
    );
  }

  const { pool, funnel, leads, drafts } = data;
  const steps = [
    { name: "Found", value: funnel.found },
    { name: "Good fit", value: funnel.goodFit },
    { name: "Added to leads", value: funnel.addedToLeads },
    { name: "Contacted", value: funnel.contacted },
    { name: "Quoted", value: funnel.quoted },
    { name: "Won", value: funnel.won },
  ];
  const widest = Math.max(1, steps[0].value);
  const nothingYet = funnel.found === 0 && leads.open === 0;

  return (
    <>
      <ErrorPopup message={error} />

      <div className={styles.actions} style={{ marginBottom: 16 }}>
        <Link className={styles.btnPrimary} href="/campaigns/new">
          New campaign
        </Link>
        <Link className={styles.btn} href="/sales/pool">
          Review the lead pool
        </Link>
        <Link className={styles.btn} href="/sales/approvals">
          Approve emails
          {drafts.pending > 0 ? ` (${drafts.pending})` : ""}
        </Link>
      </div>

      <section className={styles.kpis} aria-label="What needs attention">
        <Link className={styles.kpi} href="/sales/pool">
          <span className={styles.kpiLabel}>Waiting in the pool</span>
          <span className={styles.kpiValue}>{pool.waiting}</span>
          <span className={styles.kpiNote}>
            {pool.goodFit} good fit · {pool.withEmail} with an email address
          </span>
        </Link>
        <Link className={styles.kpi} href="/sales/approvals">
          <span className={styles.kpiLabel}>Emails to approve</span>
          <span className={styles.kpiValue}>{drafts.pending}</span>
          <span className={styles.kpiNote}>
            {drafts.approved} approved · {drafts.rejected} rejected
          </span>
        </Link>
        <Link className={styles.kpi} href="/sales/pipeline">
          <span className={styles.kpiLabel}>Follow-ups due</span>
          <span className={styles.kpiValue}>{leads.followUpsDue}</span>
          <span className={styles.kpiNote}>
            Open leads to contact today or earlier
          </span>
        </Link>
        <Link className={styles.kpi} href="/sales/pipeline">
          <span className={styles.kpiLabel}>Open leads</span>
          <span className={styles.kpiValue}>{leads.open}</span>
          <span className={styles.kpiNote}>
            {leads.won} won · {leads.lost} lost
          </span>
        </Link>
      </section>

      {nothingYet && (
        <div className={styles.emptyState}>
          <h2>Start with a campaign</h2>
          <p>
            A campaign says what kind of business to look for and where. It
            finds them, scores how well each one fits, and puts them in the lead
            pool for you to review.
          </p>
          <Link className={styles.btnPrimary} href="/campaigns/new">
            Create the first campaign
          </Link>
        </div>
      )}

      <div className={styles.panelGrid}>
        <section className={styles.panel} aria-label="Funnel">
          <div className={styles.panelHead}>
            <h2>From found to won</h2>
          </div>
          {steps.map((step) => (
            <div className={styles.funnelRow} key={step.name}>
              <span className={styles.funnelName}>{step.name}</span>
              <span className={styles.funnelTrack} aria-hidden="true">
                <span
                  className={styles.funnelFill}
                  style={{
                    width: `${step.value === 0 ? 0 : Math.max(2, (step.value / widest) * 100)}%`,
                  }}
                />
              </span>
              <span className={styles.funnelCount}>
                {step.value}
                {funnel.found > 0 && step.name !== "Found" && (
                  <small>
                    {Math.round((step.value / funnel.found) * 100)}%
                  </small>
                )}
              </span>
            </div>
          ))}
          <p className={styles.panelNote}>
            Counts businesses found by campaigns. Contacted, Quoted and Won are
            the stage their lead has reached; Replied and Interested count as
            contacted.
          </p>
        </section>

        <section
          className={styles.panel}
          aria-label="Generated and manual leads"
        >
          <div className={styles.panelHead}>
            <h2>Generated and manual leads</h2>
          </div>
          <table className={styles.compare}>
            <thead>
              <tr>
                <th scope="col" />
                <th scope="col">Generated</th>
                <th scope="col">Manual</th>
              </tr>
            </thead>
            <tbody>
              {(
                [
                  ["Leads", (p) => String(p.total)],
                  ["Open", (p) => String(p.open)],
                  ["Won", (p) => String(p.won)],
                  ["Lost", (p) => String(p.lost)],
                  [
                    "Won of decided",
                    (p) =>
                      p.won + p.lost > 0
                        ? `${Math.round((p.won / (p.won + p.lost)) * 100)}%`
                        : "—",
                  ],
                  [
                    "Days to win",
                    (p) =>
                      p.avgDaysToWin === null ? "—" : String(p.avgDaysToWin),
                  ],
                ] as Array<[string, (p: PipelinePerformance) => string]>
              ).map(([label, value]) => (
                <tr key={label}>
                  <th scope="row">{label}</th>
                  <td>{value(data.pipelines.generated)}</td>
                  <td>{value(data.pipelines.manual)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className={styles.panelNote}>
            Two separate pipelines, shown side by side and never added together.
            Generated leads were found by a campaign; manual leads were added by
            staff. Manual leads are on Customers, Leads.
          </p>
        </section>

        <section className={styles.panel} aria-label="Follow-ups due">
          <div className={styles.panelHead}>
            <h2>Follow-ups due</h2>
            <Link href="/sales/pipeline">Open the pipeline</Link>
          </div>
          {data.followUps.length === 0 ? (
            <p className={styles.empty}>
              Nothing is due. A lead with a follow-up date shows here on that
              day.
            </p>
          ) : (
            <ul className={styles.rows}>
              {data.followUps.map((item) => (
                <li className={styles.row} key={item.leadId}>
                  <div className={styles.rowMain}>
                    <Link href="/sales/pipeline">{item.companyName}</Link>
                    <span className={styles.rowSub}>
                      {stageLabels[item.stage] ?? item.stage}
                      {item.ownerName ? ` · ${item.ownerName}` : " · No owner"}
                    </span>
                  </div>
                  <div className={styles.rowSide}>
                    <span
                      className={`${styles.pill}${item.overdue ? ` ${styles.pillStrong}` : ""}`}
                    >
                      {item.overdue ? "Overdue" : "Today"}
                    </span>
                    <span className={styles.rowSub}>
                      {shortDay(item.nextFollowUp)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className={styles.panelGrid}>
        <section className={styles.panel} aria-label="Campaigns">
          <div className={styles.panelHead}>
            <h2>Campaigns</h2>
            <Link href="/campaigns">All campaigns</Link>
          </div>
          {data.campaigns.length === 0 ? (
            <p className={styles.empty}>No campaigns yet.</p>
          ) : (
            <table className={styles.miniTable}>
              <thead>
                <tr>
                  <th scope="col">Campaign</th>
                  <th scope="col">Found</th>
                  <th scope="col">Good fit</th>
                  <th scope="col">Added</th>
                </tr>
              </thead>
              <tbody>
                {data.campaigns.map((campaign) => (
                  <tr key={campaign.id}>
                    <th scope="row">
                      <Link href={`/campaigns/${campaign.id}`}>
                        {campaign.name}
                      </Link>
                    </th>
                    <td>{campaign.found}</td>
                    <td>{campaign.goodFit}</td>
                    <td>{campaign.added}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className={styles.panel} aria-label="Recent activity">
          <div className={styles.panelHead}>
            <h2>Recent activity</h2>
          </div>
          {data.recentActivity.length === 0 ? (
            <p className={styles.empty}>
              Calls, emails and notes logged on leads show here.
            </p>
          ) : (
            <ul className={styles.rows}>
              {data.recentActivity.map((item, index) => (
                <li className={styles.row} key={`${item.leadId}-${index}`}>
                  <div className={styles.rowMain}>
                    <strong>{item.companyName}</strong>
                    <span className={styles.rowSub}>
                      {activityLabels[item.kind] ?? item.kind}: {item.note}
                    </span>
                  </div>
                  <div className={styles.rowSide}>
                    {shortDateTime(item.occurredAt)}
                    {item.byName && (
                      <span className={styles.rowSub}>{item.byName}</span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
