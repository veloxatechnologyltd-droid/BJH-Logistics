"use client";

import { Fragment, useEffect, useState } from "react";
import { canWorkFinance } from "../auth/roleAccess";
import { useStaffAccess } from "../auth/useStaffAccess";
import { FinanceTabs } from "../invoices/FinanceTabs";
import { JobCharges } from "../jobs/JobCharges";
import {
  getFinanceSummary,
  listDocuments,
  listJobs,
  serviceLineLabels,
} from "../jobs/jobApi";
import type { FinanceSummary, Job, JobDocument } from "../jobs/jobApi";
import { formatMoney } from "../quotes/quoteApi";
import styles from "../jobs/jobs.module.css";
import chart from "./finance.module.css";
import { ErrorPopup } from "../ErrorPopup";
import { RecordCost } from "./RecordCost";

type SummaryRow = FinanceSummary["jobs"][number];

const isClosed = (item: Job) =>
  item.status === "closed" || item.status === "cancelled";

/** Sums by currency, as "GHS 1,200.00 · USD 300.00"; "-" when there is nothing. */
function perCurrency(rows: SummaryRow[], amount: (row: SummaryRow) => number) {
  const totals = new Map<string, number>();
  for (const row of rows) {
    totals.set(row.currency, (totals.get(row.currency) ?? 0) + amount(row));
  }
  const parts = [...totals]
    .filter(([, minor]) => minor > 0)
    .map(([currency, minor]) => formatMoney(minor, currency));
  return parts.length > 0 ? parts.join(" · ") : "-";
}

/**
 * Finance → Costs: the one place BJH's costs (what it paid suppliers) are
 * recorded and corrected. Clients are listed with their jobs under them, as on
 * the Invoices page; a cost is recorded for a client (then one of their jobs is
 * chosen) or straight on a job, and is always kept on a job. "Record a cost"
 * opens one form (client, job, what it was for or an extra amount on a cost
 * already recorded, amount, supplier document). Opening a job shows and
 * corrects its costs. Finance job pages link here with ?job=<job id>, plus
 * &record=1 to open the form on that job.
 */
export function Costs() {
  const { status, roles } = useStaffAccess();
  const allowed = canWorkFinance(roles);
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [summary, setSummary] = useState<FinanceSummary | null>(null);
  const [jobId, setJobId] = useState("");
  // The documents are kept with the job they were loaded for, so a slow answer
  // for the previously chosen job is never shown against the new one.
  const [documents, setDocuments] = useState<{
    jobId: string;
    items: JobDocument[];
  } | null>(null);
  const [error, setError] = useState("");
  // The form, with the client and job it starts on (either may be empty).
  const [recording, setRecording] = useState<{
    clientId: string;
    jobId: string;
  } | null>(null);
  // Changed after a cost is saved, so the job's cost list is loaded again.
  const [savedCount, setSavedCount] = useState(0);
  // Filters for the clients and jobs, and which clients are opened.
  const [query, setQuery] = useState("");
  const [customer, setCustomer] = useState("");
  const [serviceLine, setServiceLine] = useState("");
  const [jobState, setJobState] = useState<"" | "open" | "closed">("");
  const [opened, setOpened] = useState<Set<string>>(new Set());

  const job = jobs?.find((item) => item.id === jobId) ?? null;
  const chosenId = job?.id ?? "";

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    setJobId(query.get("job") ?? "");
    setRecording(
      query.get("record") === "1" ? { clientId: "", jobId: "" } : null,
    );
  }, []);

  useEffect(() => {
    if (!allowed) return;
    listJobs("")
      .then(setJobs)
      .catch((cause) =>
        setError(
          cause instanceof Error ? cause.message : "Jobs could not be loaded",
        ),
      );
  }, [allowed]);

  // Costs and invoices by job, read again whenever the page goes back to the
  // list so it shows what was just recorded.
  useEffect(() => {
    if (!allowed || chosenId) return;
    getFinanceSummary()
      .then(setSummary)
      .catch((cause) =>
        setError(
          cause instanceof Error ? cause.message : "Costs could not be loaded",
        ),
      );
  }, [allowed, chosenId]);

  useEffect(() => {
    if (!allowed || !chosenId) return;
    listDocuments(chosenId)
      .then((items) => setDocuments({ jobId: chosenId, items }))
      .catch((cause) => {
        setError(
          cause instanceof Error
            ? cause.message
            : "The job's documents could not be loaded",
        );
        setDocuments({ jobId: chosenId, items: [] });
      });
  }, [allowed, chosenId]);

  if (status === "loading" && roles.length === 0) {
    return <p role="status">Checking staff access…</p>;
  }
  if (!allowed) {
    return (
      <main className={styles.page}>
        <p role="status">Costs are for Finance.</p>
      </main>
    );
  }

  const closedJob = job !== null && isClosed(job);
  // The summary has a row per job and currency; a job with neither an invoice
  // nor a cost has none.
  const rowsByJob = new Map<string, SummaryRow[]>();
  for (const row of summary?.jobs ?? []) {
    rowsByJob.set(row.jobId, [...(rowsByJob.get(row.jobId) ?? []), row]);
  }
  const rowsOf = (list: Job[]) =>
    list.flatMap((item) => rowsByJob.get(item.id) ?? []);
  const customers = [
    ...new Set((jobs ?? []).map((item) => item.customerCompanyName)),
  ].sort();
  const serviceLines = [
    ...new Set((jobs ?? []).map((item) => item.serviceLine)),
  ].sort((a, b) => serviceLineLabels[a].localeCompare(serviceLineLabels[b]));
  const needle = query.trim().toLowerCase();
  const shown = (jobs ?? []).filter(
    (item) =>
      (!customer || item.customerCompanyName === customer) &&
      (!serviceLine || item.serviceLine === serviceLine) &&
      (!jobState || isClosed(item) === (jobState === "closed")) &&
      (!needle ||
        item.fileNumber.toLowerCase().includes(needle) ||
        item.customerCompanyName.toLowerCase().includes(needle)),
  );
  // One row per client, alphabetical; their jobs show when the row is opened.
  const byClient = new Map<string, Job[]>();
  for (const item of shown) {
    byClient.set(item.customerCompanyId, [
      ...(byClient.get(item.customerCompanyId) ?? []),
      item,
    ]);
  }
  const groups = [...byClient.values()].sort((a, b) =>
    a[0].customerCompanyName.localeCompare(b[0].customerCompanyName),
  );
  // Searching, or one client, shows the jobs straight away.
  const openAll = groups.length === 1 || needle !== "";
  const toggleClient = (id: string) =>
    setOpened((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Costs</h1>
        {jobs && !recording && (
          <button
            className={styles.button}
            onClick={() => setRecording({ clientId: "", jobId: chosenId })}
            type="button"
          >
            Record a cost
          </button>
        )}
      </header>
      <FinanceTabs active="/finance/costs" />
      <ErrorPopup message={error} />
      {!jobs && !error && <p className={styles.muted}>Loading…</p>}
      {jobs && recording && (
        <RecordCost
          clientId={recording.clientId}
          jobId={recording.jobId || chosenId}
          jobs={jobs.filter((item) => !isClosed(item))}
          onCancel={() => setRecording(null)}
          onSaved={(savedJobId) => {
            setRecording(null);
            setJobId(savedJobId);
            setSavedCount((count) => count + 1);
          }}
        />
      )}
      {jobs && !recording && (
        <section className={styles.card} aria-labelledby="cost-job-title">
          <label className={styles.field} id="cost-job-title">
            Job
            <select
              onChange={(event) => setJobId(event.target.value)}
              value={chosenId}
            >
              <option value="">Choose a job to record a cost</option>
              {jobs.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.fileNumber} · {item.customerCompanyName}
                  {isClosed(item) ? ` (${item.status})` : ""}
                </option>
              ))}
            </select>
          </label>
        </section>
      )}
      {!recording && job && documents?.jobId === job.id && (
        <JobCharges
          canEdit={!closedJob}
          documents={documents.items}
          jobId={job.id}
          key={`${job.id}-${savedCount}`}
        />
      )}
      {!recording && jobs && !job && summary && (
        <section
          className={styles.card}
          aria-labelledby="costs-by-client-title"
        >
          <h2 id="costs-by-client-title">Costs by client</h2>
          {jobs.length === 0 ? (
            <p className={styles.muted}>No jobs yet.</p>
          ) : (
            <>
              <div className={chart.filters}>
                <label className={styles.field}>
                  Search
                  <input
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Job file or client"
                    type="search"
                    value={query}
                  />
                </label>
                <label className={styles.field}>
                  Client
                  <select
                    onChange={(event) => setCustomer(event.target.value)}
                    value={customer}
                  >
                    <option value="">All clients</option>
                    {customers.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={styles.field}>
                  Service
                  <select
                    onChange={(event) => setServiceLine(event.target.value)}
                    value={serviceLine}
                  >
                    <option value="">All services</option>
                    {serviceLines.map((line) => (
                      <option key={line} value={line}>
                        {serviceLineLabels[line]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={styles.field}>
                  Job status
                  <select
                    onChange={(event) =>
                      setJobState(event.target.value as typeof jobState)
                    }
                    value={jobState}
                  >
                    <option value="">Open and closed</option>
                    <option value="open">Open jobs</option>
                    <option value="closed">Closed jobs</option>
                  </select>
                </label>
              </div>
              {shown.length === 0 && (
                <p className={styles.muted}>Nothing matches these filters.</p>
              )}
            </>
          )}
          {shown.length > 0 && (
            <div className={chart.board}>
              <div className={`${chart.tableWrap} ${chart.scrollBox}`}>
                <table className={chart.cardTable}>
                  <thead>
                    <tr>
                      <th scope="col">Client and jobs</th>
                      <th scope="col">Status</th>
                      <th className={chart.num} scope="col">
                        Invoiced
                      </th>
                      <th className={chart.num} scope="col">
                        BJH paid
                      </th>
                      <th scope="col">
                        <span className={chart.srOnly}>Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {groups.map((list) => {
                      const id = list[0].customerCompanyId;
                      const open = openAll || opened.has(id);
                      const openJobs = list.filter((item) => !isClosed(item));
                      return (
                        <Fragment key={id}>
                          <tr className={chart.clientRow}>
                            <td className={chart.jobCell}>
                              <button
                                aria-expanded={open}
                                className={chart.clientToggle}
                                onClick={() => toggleClient(id)}
                                type="button"
                              >
                                <span aria-hidden="true">
                                  {open ? "▾" : "▸"}
                                </span>{" "}
                                {list[0].customerCompanyName}
                              </button>
                              <span className={chart.customerName}>
                                {list.length}{" "}
                                {list.length === 1 ? "job" : "jobs"}
                              </span>
                            </td>
                            <td data-label="Status">
                              {openJobs.length > 0 ? (
                                <span className={styles.badge}>
                                  {openJobs.length} open
                                </span>
                              ) : (
                                "-"
                              )}
                            </td>
                            <td className={chart.num} data-label="Invoiced">
                              {perCurrency(
                                rowsOf(list),
                                (row) => row.invoicedMinor,
                              )}
                            </td>
                            <td className={chart.num} data-label="BJH paid">
                              {perCurrency(
                                rowsOf(list),
                                (row) => row.costMinor,
                              )}
                            </td>
                            <td className={chart.rowActions}>
                              {openJobs.length > 0 && (
                                <button
                                  className={styles.textButton}
                                  onClick={() =>
                                    setRecording({ clientId: id, jobId: "" })
                                  }
                                  type="button"
                                >
                                  Record a cost
                                </button>
                              )}
                            </td>
                          </tr>
                          {open &&
                            list.map((item) => (
                              <tr className={chart.jobRow} key={item.id}>
                                <td className={chart.jobCell}>
                                  <button
                                    className={styles.textButton}
                                    onClick={() => setJobId(item.id)}
                                    type="button"
                                  >
                                    {item.fileNumber}
                                  </button>
                                  <span className={chart.customerName}>
                                    {serviceLineLabels[item.serviceLine]}
                                  </span>
                                </td>
                                <td data-label="Status">
                                  <span className={styles.badge}>
                                    {item.status === "closed"
                                      ? "Closed"
                                      : item.status === "cancelled"
                                        ? "Cancelled"
                                        : "Open"}
                                  </span>
                                </td>
                                <td className={chart.num} data-label="Invoiced">
                                  {perCurrency(
                                    rowsOf([item]),
                                    (row) => row.invoicedMinor,
                                  )}
                                </td>
                                <td className={chart.num} data-label="BJH paid">
                                  {perCurrency(
                                    rowsOf([item]),
                                    (row) => row.costMinor,
                                  )}
                                </td>
                                <td className={chart.rowActions}>
                                  {!isClosed(item) && (
                                    <button
                                      className={styles.textButton}
                                      onClick={() =>
                                        setRecording({
                                          clientId: item.customerCompanyId,
                                          jobId: item.id,
                                        })
                                      }
                                      type="button"
                                    >
                                      Record a cost
                                    </button>
                                  )}
                                </td>
                              </tr>
                            ))}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      )}
    </main>
  );
}
