"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ErrorPopup } from "../ErrorPopup";
import { canWorkFinance } from "../auth/roleAccess";
import { useStaffAccess } from "../auth/useStaffAccess";
import { sourceLabels, stageLabels } from "../customers/leadApi";
import { getFinanceSummary, getReports, listTasks } from "../jobs/jobApi";
import type {
  FinanceSummary,
  Invoice,
  InvoicePayment,
  Job,
  JobTask,
  ReportsData,
} from "../jobs/jobApi";
import {
  serviceLineLabels,
  statusLabels,
  taskKindLabels,
} from "../jobs/jobApi";
import { formatMoney } from "../quotes/quoteApi";
import styles from "../jobs/jobs.module.css";
import cards from "../finance/finance.module.css";
import reportStyles from "./reports.module.css";

type Preset = "day" | "week" | "month" | "year" | "custom";
type Range = { from: string; to: string };
type ReportTab = "sales" | "service" | "operations" | "finance";

/** One tab per team, in the order work flows; Finance only for finance. */
const reportTabs: Array<{ key: ReportTab; label: string }> = [
  { key: "sales", label: "Sales" },
  { key: "service", label: "Customer service" },
  { key: "operations", label: "Operations" },
  { key: "finance", label: "Finance" },
];

const requestSourceLabels: Record<string, string> = {
  portal: "Client portal",
  staff: "Entered by staff",
  email: "Email",
  website: "Website form",
  earlier: "Earlier requests",
};

/** Horizontal bars in one blue, longest first, with the count beside each. */
function BarList({
  rows,
  empty,
}: {
  rows: Array<[string, number]>;
  empty: string;
}) {
  const shown = rows.filter(([, value]) => value > 0);
  if (shown.length === 0) return <p className={styles.muted}>{empty}</p>;
  const top = Math.max(...shown.map(([, value]) => value));
  return (
    <ul className={reportStyles.bars}>
      {shown
        .sort((a, b) => b[1] - a[1])
        .map(([label, value]) => (
          <li key={label}>
            <span className={reportStyles.barLabel}>{label}</span>
            <span className={reportStyles.barTrack}>
              <span
                className={reportStyles.barFill}
                style={{ width: `${Math.max(4, (value / top) * 100)}%` }}
              />
            </span>
            <strong>{value}</strong>
          </li>
        ))}
    </ul>
  );
}

const dateString = (date: Date) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Accra",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
};

function rangeFor(preset: Exclude<Preset, "custom">, now = new Date()): Range {
  const [year, month, day] = dateString(now).split("-").map(Number);
  const end = new Date(Date.UTC(year, month - 1, day));
  const start = new Date(end);
  if (preset === "week")
    start.setUTCDate(end.getUTCDate() - ((end.getUTCDay() + 6) % 7));
  else if (preset === "month") start.setUTCDate(1);
  else if (preset === "year") start.setUTCMonth(0, 1);
  return { from: dateString(start), to: dateString(end) };
}

const inRange = (value: string | null | undefined, range: Range) => {
  if (!value || !range.from || !range.to || range.from > range.to) return false;
  const day = value.slice(0, 10);
  return day >= range.from && day <= range.to;
};

function csvDownload(name: string, rows: Array<Array<string | number>>) {
  const quote = (value: string | number) =>
    `"${String(value).replaceAll('"', '""')}"`;
  const content = rows.map((row) => row.map(quote).join(",")).join("\r\n");
  const url = URL.createObjectURL(
    new Blob([content], { type: "text/csv;charset=utf-8" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

type JobRef = Pick<Job, "id" | "fileNumber" | "customerCompanyName">;
type InvoiceRow = { job: JobRef; invoice: Invoice };
type PaymentRow = {
  job: JobRef;
  currency: string;
  invoiceNumber: string;
  payment: InvoicePayment;
};

export function ReportsHome() {
  const { roles } = useStaffAccess();
  const isStaff = roles.length > 0;
  const [preset, setPreset] = useState<Preset>("month");
  const [tab, setTab] = useState<ReportTab>("sales");
  const [sales, setSales] = useState<ReportsData["sales"] | null>(null);
  const [service, setService] = useState<ReportsData["service"] | null>(null);
  const showFinance = canWorkFinance(roles);
  const [range, setRange] = useState<Range>({ from: "", to: "" });
  const [jobs, setJobs] = useState<Job[]>([]);
  const [tasks, setTasks] = useState<JobTask[]>([]);
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [finance, setFinance] = useState<FinanceSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => setRange(rangeFor("month")), []);

  useEffect(() => {
    if (!isStaff || !range.from || !range.to || range.from > range.to) return;
    let active = true;
    setLoading(true);
    Promise.all([
      getReports(range.from, range.to),
      showFinance ? getFinanceSummary() : Promise.resolve(null),
      listTasks("", "open"),
    ])
      .then(([report, summary, openTasks]) => {
        if (!active) return;
        setJobs(report.jobs);
        setSales(report.sales);
        setService(report.service);
        setTasks(openTasks);
        setFinance(summary);
        setInvoices(
          report.invoices.map(
            ({ jobId, fileNumber, customerCompanyName, invoice }) => ({
              job: { id: jobId, fileNumber, customerCompanyName },
              invoice,
            }),
          ),
        );
        setPayments(
          report.payments.map(
            ({
              jobId,
              fileNumber,
              customerCompanyName,
              currency,
              invoiceNumber,
              payment,
            }) => ({
              job: { id: jobId, fileNumber, customerCompanyName },
              currency,
              invoiceNumber,
              payment,
            }),
          ),
        );
      })
      .catch((cause) => {
        if (active)
          setError(
            cause instanceof Error
              ? cause.message
              : "Reports could not be loaded",
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [isStaff, range.from, range.to, showFinance]);

  const setPeriod = (value: Exclude<Preset, "custom">) => {
    setPreset(value);
    setRange(rangeFor(value));
  };
  const opened = useMemo(
    () => jobs.filter((job) => inRange(job.openedAt, range)),
    [jobs, range],
  );
  const closed = useMemo(
    () => jobs.filter((job) => inRange(job.closedAt, range)),
    [jobs, range],
  );
  const activityRows = [
    ...opened.map((job) => ({
      job,
      activity: "Opened",
      date: job.openedAt.slice(0, 10),
    })),
    ...closed.map((job) => ({
      job,
      activity: "Closed",
      date: job.closedAt!.slice(0, 10),
    })),
  ].sort((a, b) => a.date.localeCompare(b.date));
  const periodInvoices = useMemo(
    () =>
      invoices.filter(
        ({ invoice }) =>
          invoice.status === "issued" && inRange(invoice.issuedAt, range),
      ),
    [invoices, range],
  );
  const periodPayments = useMemo(
    () =>
      payments.filter(
        ({ payment }) =>
          !payment.reversal && inRange(payment.receivedOn, range),
      ),
    [payments, range],
  );
  const issuedAmounts = new Map<string, number>();
  for (const { invoice } of periodInvoices) {
    issuedAmounts.set(
      invoice.currency,
      (issuedAmounts.get(invoice.currency) ?? 0) + invoice.totalMinor,
    );
  }
  const receivedAmounts = new Map<string, number>();
  for (const { currency, payment } of periodPayments) {
    receivedAmounts.set(
      currency,
      (receivedAmounts.get(currency) ?? 0) + payment.amountMinor,
    );
  }
  const overdueTasks = tasks.filter(
    (task) => task.dueDate !== null && task.dueDate < dateString(new Date()),
  );
  const exceptionTasks = tasks.filter((task) =>
    ["delay", "damage", "missing_documents"].includes(task.kind),
  );

  const invoiceRows = periodInvoices.map(({ job, invoice }) => [
    invoice.invoiceNumber ?? "",
    job.fileNumber,
    job.customerCompanyName,
    invoice.issuedAt?.slice(0, 10) ?? "",
    invoice.currency,
    (invoice.totalMinor / 100).toFixed(2),
  ]);
  const paymentRows = periodPayments.map(
    ({ job, invoiceNumber, currency, payment }) => [
      payment.receiptNumber ?? "",
      invoiceNumber,
      job.fileNumber,
      job.customerCompanyName,
      payment.receivedOn,
      currency,
      (payment.amountMinor / 100).toFixed(2),
      payment.method,
    ],
  );

  if (!isStaff)
    return (
      <main className={styles.page}>
        <h1 className={styles.title}>Reports are for staff</h1>
      </main>
    );

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Reports</h1>
          <p className={styles.muted}>
            Sales, customer service, operations
            {showFinance ? " and finance" : ""}
          </p>
        </div>
      </header>
      <ErrorPopup message={error} />
      <section className={styles.card} aria-label="Report date range">
        <div className={reportStyles.controls}>
          <div
            className={reportStyles.presets}
            aria-label="Date period"
            role="group"
          >
            {(["day", "week", "month", "year"] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={preset === value}
                className={preset === value ? reportStyles.activePreset : ""}
                onClick={() => setPeriod(value)}
              >
                {value === "day"
                  ? "Today"
                  : value === "week"
                    ? "This week"
                    : value === "month"
                      ? "This month"
                      : "This year"}
              </button>
            ))}
          </div>
          <label className={styles.field}>
            From
            <input
              type="date"
              value={range.from}
              onChange={(event) => {
                setPreset("custom");
                setRange((current) => ({
                  ...current,
                  from: event.target.value,
                }));
              }}
            />
          </label>
          <label className={styles.field}>
            To
            <input
              type="date"
              value={range.to}
              onChange={(event) => {
                setPreset("custom");
                setRange((current) => ({ ...current, to: event.target.value }));
              }}
            />
          </label>
        </div>
        {range.from > range.to && (
          <p className={styles.error}>
            The start date must be on or before the end date.
          </p>
        )}
      </section>
      <div className={reportStyles.tabs} role="tablist" aria-label="Reports">
        {reportTabs
          .filter((entry) => entry.key !== "finance" || showFinance)
          .map((entry) => (
            <button
              aria-selected={tab === entry.key}
              className={`${reportStyles.tab}${tab === entry.key ? ` ${reportStyles.tabActive}` : ""}`}
              key={entry.key}
              onClick={() => setTab(entry.key)}
              role="tab"
              type="button"
            >
              {entry.label}
            </button>
          ))}
      </div>
      {loading && <p className={styles.muted}>Loading reports…</p>}

      <section
        className={reportStyles.section}
        aria-labelledby="sales-title"
        hidden={tab !== "sales"}
      >
        <div className={reportStyles.heading}>
          <div>
            <h2 id="sales-title">Leads and conversions</h2>
            <p>
              New leads logged, and clients who accepted their first quote,
              within the selected dates.
            </p>
          </div>
        </div>
        {sales && (
          <>
            <div className={cards.kpis}>
              <div className={cards.kpi}>
                <span>New leads</span>
                <strong>{sales.newLeads}</strong>
              </div>
              <div className={cards.kpi}>
                <span>Converted clients</span>
                <strong>{sales.converted}</strong>
                {sales.convertedCompanies.length > 0 && (
                  <small>{sales.convertedCompanies.join(", ")}</small>
                )}
              </div>
              <div className={cards.kpi}>
                <span>Conversion</span>
                <strong>
                  {sales.newLeads > 0
                    ? `${Math.round((sales.converted / sales.newLeads) * 100)}%`
                    : "—"}
                </strong>
                <small>Converted clients per new lead</small>
              </div>
            </div>
            <div className={reportStyles.split}>
              <div className={reportStyles.chart}>
                <h3>Where leads came from</h3>
                <BarList
                  empty="No leads in these dates."
                  rows={Object.entries(sales.leadsBySource).map(
                    ([key, value]) => [
                      sourceLabels[key as keyof typeof sourceLabels] ?? key,
                      value,
                    ],
                  )}
                />
              </div>
              <div className={reportStyles.chart}>
                <h3>Pipeline today</h3>
                <BarList
                  empty="No leads yet."
                  rows={Object.entries(sales.pipeline).map(([key, value]) => [
                    stageLabels[key as keyof typeof stageLabels] ?? key,
                    value,
                  ])}
                />
              </div>
            </div>
            <Link className={styles.link} href="/customers/leads">
              Open the leads board →
            </Link>
          </>
        )}
      </section>

      <section
        className={reportStyles.section}
        aria-labelledby="service-title"
        hidden={tab !== "service"}
      >
        <div className={reportStyles.heading}>
          <div>
            <h2 id="service-title">Requests, quotes and replies</h2>
            <p>How client requests were handled within the selected dates.</p>
          </div>
        </div>
        {service && (
          <>
            <div className={cards.kpis}>
              <div className={cards.kpi}>
                <span>Quotes issued</span>
                <strong>{service.quotesIssued}</strong>
              </div>
              <div className={cards.kpi}>
                <span>Accepted · rejected</span>
                <strong>
                  {service.quotesAccepted} · {service.quotesRejected}
                </strong>
                <small>
                  {service.quotesAccepted + service.quotesRejected > 0
                    ? `Win rate ${Math.round(
                        (service.quotesAccepted /
                          (service.quotesAccepted + service.quotesRejected)) *
                          100,
                      )}%`
                    : "No decisions yet"}
                </small>
              </div>
              <div className={cards.kpi}>
                <span>Time to quote</span>
                <strong>
                  {service.medianHoursToQuote === null
                    ? "—"
                    : service.medianHoursToQuote < 48
                      ? `${service.medianHoursToQuote} h`
                      : `${Math.round(service.medianHoursToQuote / 24)} days`}
                </strong>
                <small>Typical time from request to first quote</small>
              </div>
              <div className={cards.kpi}>
                <span>Still waiting for a quote</span>
                <strong>{service.waitingForQuote}</strong>
              </div>
              <div className={cards.kpi}>
                <span>Inquiries answered</span>
                <strong>
                  {service.inquiriesAnswered} of {service.inquiries}
                </strong>
              </div>
            </div>
            <div className={reportStyles.chart}>
              <h3>Quote requests by channel</h3>
              <BarList
                empty="No quote requests in these dates."
                rows={Object.entries(service.requestsBySource).map(
                  ([key, value]) => [requestSourceLabels[key] ?? key, value],
                )}
              />
            </div>
          </>
        )}
      </section>

      <section
        className={reportStyles.section}
        aria-labelledby="activity-title"
        hidden={tab !== "operations"}
      >
        <div className={reportStyles.heading}>
          <div>
            <h2 id="activity-title">Job activity</h2>
            <p>Jobs opened and closed within the selected dates.</p>
          </div>
          <button
            type="button"
            disabled={!activityRows.length}
            onClick={() =>
              csvDownload(`job-activity-${range.from}-${range.to}.csv`, [
                [
                  "Job file",
                  "Activity",
                  "Customer",
                  "Service",
                  "Current status",
                  "Date",
                ],
                ...activityRows.map(({ job, activity, date }) => [
                  job.fileNumber,
                  activity,
                  job.customerCompanyName,
                  serviceLineLabels[job.serviceLine],
                  statusLabels[job.status],
                  date,
                ]),
              ])
            }
          >
            Download CSV
          </button>
        </div>
        <div className={cards.kpis}>
          <div className={cards.kpi}>
            <span>Jobs opened</span>
            <strong>{opened.length}</strong>
          </div>
          <div className={cards.kpi}>
            <span>Jobs closed</span>
            <strong>{closed.length}</strong>
          </div>
          <div className={cards.kpi}>
            <span>Still open</span>
            <strong>
              {
                jobs.filter(
                  (job) =>
                    job.status !== "closed" && job.status !== "cancelled",
                ).length
              }
            </strong>
            <small>Current total</small>
          </div>
        </div>
        {activityRows.length > 0 && (
          <div className={cards.tableWrap}>
            <table className={cards.cardTable}>
              <thead>
                <tr>
                  <th>Job</th>
                  <th>Activity</th>
                  <th>Customer</th>
                  <th>Service</th>
                  <th>Status</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {activityRows.map(({ job, activity, date }, index) => (
                  <tr key={`${job.id}-${activity}-${index}`}>
                    <td>
                      <Link href={`/jobs/${job.id}`}>{job.fileNumber}</Link>
                    </td>
                    <td>{activity}</td>
                    <td>{job.customerCompanyName}</td>
                    <td>{serviceLineLabels[job.serviceLine]}</td>
                    <td>{statusLabels[job.status]}</td>
                    <td>{date}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!activityRows.length && !loading && (
          <p className={styles.muted}>No jobs opened in this period.</p>
        )}
      </section>

      <section
        className={reportStyles.section}
        aria-labelledby="blockers-title"
        hidden={tab !== "operations"}
      >
        <div className={reportStyles.heading}>
          <div>
            <h2 id="blockers-title">Open delays and exceptions</h2>
            <p>
              Current open tasks, including overdue work, delays and missing
              documents.
            </p>
          </div>
        </div>
        <div className={cards.kpis}>
          <div className={cards.kpi}>
            <span>Open tasks</span>
            <strong>{tasks.length}</strong>
          </div>
          <div className={cards.kpi}>
            <span>Overdue tasks</span>
            <strong>{overdueTasks.length}</strong>
          </div>
          <div className={cards.kpi}>
            <span>Delay / exception tasks</span>
            <strong>{exceptionTasks.length}</strong>
          </div>
        </div>
        {exceptionTasks.length > 0 && (
          <div className={cards.tableWrap}>
            <table className={cards.cardTable}>
              <thead>
                <tr>
                  <th>Job</th>
                  <th>Customer</th>
                  <th>Issue</th>
                  <th>Due</th>
                  <th>Assigned to</th>
                </tr>
              </thead>
              <tbody>
                {exceptionTasks.map((task) => (
                  <tr key={task.id}>
                    <td>
                      <Link href={`/jobs/${task.jobId}`}>
                        {task.fileNumber}
                      </Link>
                    </td>
                    <td>{task.customerCompanyName}</td>
                    <td>
                      {task.title}
                      <br />
                      {taskKindLabels[task.kind]}
                    </td>
                    <td>{task.dueDate ?? "—"}</td>
                    <td>{task.assignedRole.replaceAll("_", " ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section
        className={reportStyles.section}
        aria-labelledby="finance-title"
        hidden={tab !== "finance"}
      >
        <div className={reportStyles.heading}>
          <div>
            <h2 id="finance-title">Invoices and payments</h2>
            <p>
              Invoices use issue date; receipts use payment date. Balances below
              are current.
            </p>
          </div>
        </div>
        <div className={cards.kpis}>
          <div className={cards.kpi}>
            <span>Invoices issued</span>
            <strong>{periodInvoices.length}</strong>
            <small>
              {[...issuedAmounts]
                .map(([currency, amount]) => formatMoney(amount, currency))
                .join(" · ") || "No invoice value"}
            </small>
          </div>
          <div className={cards.kpi}>
            <span>Payments received</span>
            <strong>{periodPayments.length}</strong>
            <small>
              {[...receivedAmounts]
                .map(([currency, amount]) => formatMoney(amount, currency))
                .join(" · ") || "No payment value"}
            </small>
          </div>
          <div className={cards.kpi}>
            <span>Current receivables</span>
            <strong>
              {finance?.totals
                .map((row) => formatMoney(row.owingMinor, row.currency))
                .join(" · ") || "—"}
            </strong>
            <small>Across all dates, by currency</small>
          </div>
        </div>
        <div className={reportStyles.split}>
          <div>
            <div className={reportStyles.heading}>
              <h3>Invoices issued</h3>
              <button
                type="button"
                disabled={!invoiceRows.length}
                onClick={() =>
                  csvDownload(`invoices-${range.from}-${range.to}.csv`, [
                    [
                      "Invoice",
                      "Job",
                      "Customer",
                      "Issued",
                      "Currency",
                      "Amount",
                    ],
                    ...invoiceRows,
                  ])
                }
              >
                Download CSV
              </button>
            </div>
            {periodInvoices.length ? (
              <div className={cards.tableWrap}>
                <table className={cards.cardTable}>
                  <thead>
                    <tr>
                      <th>Invoice</th>
                      <th>Job / customer</th>
                      <th>Issued</th>
                      <th>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {periodInvoices.map(({ job, invoice }) => (
                      <tr key={invoice.id}>
                        <td>{invoice.invoiceNumber}</td>
                        <td>
                          {job.fileNumber}
                          <br />
                          {job.customerCompanyName}
                        </td>
                        <td>{invoice.issuedAt?.slice(0, 10)}</td>
                        <td>
                          {formatMoney(invoice.totalMinor, invoice.currency)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className={styles.muted}>No invoices issued in this period.</p>
            )}
          </div>
          <div>
            <div className={reportStyles.heading}>
              <h3>Payments received</h3>
              <button
                type="button"
                disabled={!paymentRows.length}
                onClick={() =>
                  csvDownload(`payments-${range.from}-${range.to}.csv`, [
                    [
                      "Receipt",
                      "Invoice",
                      "Job",
                      "Customer",
                      "Received",
                      "Currency",
                      "Amount",
                      "Method",
                    ],
                    ...paymentRows,
                  ])
                }
              >
                Download CSV
              </button>
            </div>
            {periodPayments.length ? (
              <div className={cards.tableWrap}>
                <table className={cards.cardTable}>
                  <thead>
                    <tr>
                      <th>Receipt / invoice</th>
                      <th>Job / customer</th>
                      <th>Received</th>
                      <th>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {periodPayments.map(
                      ({ job, invoiceNumber, currency, payment }) => (
                        <tr key={payment.id}>
                          <td>
                            {payment.receiptNumber ?? "—"}
                            <br />
                            {invoiceNumber}
                          </td>
                          <td>
                            {job.fileNumber}
                            <br />
                            {job.customerCompanyName}
                          </td>
                          <td>{payment.receivedOn}</td>
                          <td>{formatMoney(payment.amountMinor, currency)}</td>
                        </tr>
                      ),
                    )}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className={styles.muted}>
                No payments received in this period.
              </p>
            )}
          </div>
        </div>
        <p>
          <Link href="/invoices">View unpaid and overdue invoices</Link> ·{" "}
          <Link href="/finance">View job costs and margins</Link>
        </p>
      </section>
      <section
        className={reportStyles.section}
        aria-labelledby="margin-title"
        hidden={tab !== "finance"}
      >
        <div className={reportStyles.heading}>
          <div>
            <h2 id="margin-title">Job costs and margin</h2>
            <p>
              Current all-time job totals, not restricted to the selected date
              range.
            </p>
          </div>
          <Link href="/finance">Open Finance</Link>
        </div>
        {finance?.totals.length ? (
          <div className={cards.kpis}>
            {finance.totals.map((row) => {
              const comparable = finance.jobs.filter(
                (job) =>
                  job.currency === row.currency && job.marginMinor !== null,
              );
              const margin = comparable.reduce(
                (total, job) => total + (job.marginMinor ?? 0),
                0,
              );
              return (
                <div className={cards.kpi} key={row.currency}>
                  <span>{row.currency} invoiced</span>
                  <strong>
                    {formatMoney(row.invoicedMinor, row.currency)}
                  </strong>
                  <small>
                    Costs recorded: {formatMoney(row.costMinor, row.currency)}
                  </small>
                  <small>
                    Comparable job margin: {formatMoney(margin, row.currency)}
                  </small>
                </div>
              );
            })}
          </div>
        ) : (
          <p className={styles.muted}>No finance records yet.</p>
        )}
      </section>
    </main>
  );
}
