"use client";

import { useEffect, useState } from "react";
import type { ServiceLine } from "@bjh/contracts";
import { listCustomers } from "../customers/customerApi";
import { fetchReportPdf, serviceLineLabels } from "../jobs/jobApi";
import styles from "../jobs/jobs.module.css";
import reportStyles from "./reports.module.css";

type Entry = {
  type: string;
  title: string;
  about: string;
  /** "period": follows the dates above. "today": always the position as of today. */
  basis: "period" | "today";
  /** Said under the card instead of the usual line about the dates. */
  note?: string;
};

/** The PDF reports, grouped by team. The API decides who may take each one. */
const groups: Array<{ title: string; finance?: boolean; entries: Entry[] }> = [
  {
    title: "Sales and customer service",
    entries: [
      {
        type: "sales-pipeline",
        title: "Sales pipeline and conversions",
        about:
          "New leads and where they came from, the pipeline, follow-ups due and the clients who accepted their first quote.",
        basis: "period",
      },
      {
        type: "quotes-requests",
        title: "Quote requests and quotes",
        about:
          "Requests by channel, quotes issued, accepted and rejected, win rate, time to first quote and requests still waiting.",
        basis: "period",
      },
    ],
  },
  {
    title: "Operations",
    entries: [
      {
        type: "shipment-status",
        title: "Shipment status update",
        about:
          "Every open job with its BL or AWB, goods, vessel, ETA, status and remarks, and the jobs completed in the dates above. Choose a customer to make the update you send them.",
        basis: "period",
        note: "Open jobs as of today; completed jobs use the dates above",
      },
      {
        type: "job-activity",
        title: "Jobs opened and closed",
        about:
          "Jobs opened and closed by service and by customer, how long jobs take to close, and the full list.",
        basis: "period",
      },
      {
        type: "delays-tasks",
        title: "Delays, exceptions and overdue tasks",
        about:
          "Open tasks by team, what is overdue, delays, damage and missing documents, and jobs on hold.",
        basis: "today",
      },
      {
        type: "deliveries",
        title: "Deliveries and transport",
        about:
          "Deliveries dispatched and completed, who received them, damage noted, and any still on the way.",
        basis: "period",
      },
      {
        type: "warehouse-inventory",
        title: "Warehouse inventory",
        about:
          "Stock on hand at the end of the period by customer and location, and the goods received and released.",
        basis: "period",
      },
    ],
  },
  {
    title: "Finance",
    finance: true,
    entries: [
      {
        type: "invoices-payments",
        title: "Invoices and payments",
        about:
          "Invoices issued and payments received, by currency and by customer, with every line listed.",
        basis: "period",
      },
      {
        type: "receivables-ageing",
        title: "Receivables ageing",
        about:
          "Money owed by customer, grouped by how long it is past its due date, and the overdue invoices.",
        basis: "today",
      },
      {
        type: "job-margin",
        title: "Job costs and margin",
        about:
          "Invoiced, received and costs recorded for the jobs opened in the period, with the margin where both exist.",
        basis: "period",
      },
    ],
  },
];

/** PDF reports for the dates chosen above, each opened in a new tab to read, print or save. */
export function ReportLibrary({
  from,
  to,
  showFinance,
}: {
  from: string;
  to: string;
  showFinance: boolean;
}) {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [serviceLine, setServiceLine] = useState<ServiceLine | "">("");
  const [companyId, setCompanyId] = useState("");
  const [customers, setCustomers] = useState<
    Array<{ id: string; companyName: string }>
  >([]);
  const validDates = Boolean(from && to && from <= to);

  // For the shipment update's customer choice; without it the update is for everyone.
  useEffect(() => {
    let active = true;
    listCustomers("")
      .then((list) => {
        if (active) setCustomers(list);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  async function open(entry: Entry) {
    // Opened first so the browser treats it as a click, not a pop-up.
    const tab = window.open("", "_blank");
    setBusy(entry.type);
    setError("");
    try {
      const url = URL.createObjectURL(
        await fetchReportPdf(
          entry.type,
          from,
          to,
          entry.type === "shipment-status"
            ? {
                serviceLine: serviceLine || undefined,
                companyId: companyId || undefined,
              }
            : undefined,
        ),
      );
      if (tab) tab.location.href = url;
      else window.location.href = url;
    } catch (cause) {
      tab?.close();
      setError(
        cause instanceof Error ? cause.message : "The report could not be made",
      );
    } finally {
      setBusy("");
    }
  }

  return (
    <div>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {groups
        .filter((group) => !group.finance || showFinance)
        .map((group) => (
          <section
            className={reportStyles.section}
            key={group.title}
            aria-label={group.title}
          >
            <div className={reportStyles.heading}>
              <h2>{group.title}</h2>
            </div>
            <ul className={reportStyles.library}>
              {group.entries.map((entry) => (
                <li className={reportStyles.libraryCard} key={entry.type}>
                  <h3>{entry.title}</h3>
                  <p>{entry.about}</p>
                  {entry.type === "shipment-status" && (
                    <label className={styles.field}>
                      Service
                      <select
                        value={serviceLine}
                        onChange={(event) =>
                          setServiceLine(event.target.value as ServiceLine | "")
                        }
                      >
                        <option value="">All services</option>
                        {(Object.keys(serviceLineLabels) as ServiceLine[]).map(
                          (line) => (
                            <option key={line} value={line}>
                              {serviceLineLabels[line]}
                            </option>
                          ),
                        )}
                      </select>
                    </label>
                  )}
                  {entry.type === "shipment-status" && customers.length > 0 && (
                    <label className={styles.field}>
                      Customer
                      <select
                        value={companyId}
                        onChange={(event) => setCompanyId(event.target.value)}
                      >
                        <option value="">All customers</option>
                        {customers.map((customer) => (
                          <option key={customer.id} value={customer.id}>
                            {customer.companyName}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  <div className={reportStyles.libraryFoot}>
                    <small>
                      {entry.note ??
                        (entry.basis === "today"
                          ? "Always as of today"
                          : "Uses the dates above")}
                    </small>
                    <button
                      type="button"
                      disabled={
                        busy !== "" || (entry.basis === "period" && !validDates)
                      }
                      onClick={() => open(entry)}
                    >
                      {busy === entry.type ? "Preparing…" : "Open PDF"}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}
    </div>
  );
}
