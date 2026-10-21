"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { transportDocumentKindsFor } from "@bjh/contracts";
import { ErrorPopup, plainMessage } from "../ErrorPopup";
import cards from "../finance/finance.module.css";
import {
  fetchTransportDocumentPdf,
  listJobs,
  listShippingDocuments,
} from "../jobs/jobApi";
import type { Job, ShippingDocument } from "../jobs/jobApi";
import styles from "../jobs/jobs.module.css";
import { fetchWaybillPdf } from "../transport/transportApi";

type Kind = ShippingDocument["kind"];

const kindLabels: Record<Kind, string> = {
  house_bl: "Bill of lading",
  house_awb: "Air waybill",
  air_manifest: "Air manifest",
  waybill: "Waybill",
};
const kinds = Object.keys(kindLabels) as Kind[];

const statusLabels: Record<ShippingDocument["status"], string> = {
  draft: "Draft",
  issued: "Issued",
  void: "Void",
  dispatched: "Dispatched",
  delivered: "Delivered",
};

const formatDate = (value: string) =>
  new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(
    new Date(value),
  );

/** The job page where each kind is prepared: house documents under Documents, waybills under Delivery. */
const prepareTab = (kind: Kind) =>
  kind === "waybill" ? "delivery" : "documents";

/**
 * Every bill of lading, air waybill, air manifest and road waybill across
 * jobs, in one place. They are still prepared on the job (it holds the
 * parties, references and cargo they start from); "Prepare" picks the job and
 * opens the right tab.
 */
export function ShippingDocuments() {
  const router = useRouter();
  const [items, setItems] = useState<ShippingDocument[] | null>(null);
  const [error, setError] = useState("");
  const [kind, setKind] = useState<Kind | "">("");
  const [query, setQuery] = useState("");

  const [preparing, setPreparing] = useState(false);
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [prepareKind, setPrepareKind] = useState<Kind>("house_bl");
  const [jobId, setJobId] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    listShippingDocuments()
      .then(setItems)
      .catch((cause) =>
        setError(
          plainMessage(
            cause instanceof Error
              ? cause.message
              : "Shipping documents could not be loaded",
          ),
        ),
      );
  }, []);

  useEffect(() => {
    if (preparing) dialog.current?.showModal();
    else dialog.current?.close();
  }, [preparing]);

  const counts = useMemo(() => {
    const total = new Map<Kind, number>();
    for (const item of items ?? []) {
      total.set(item.kind, (total.get(item.kind) ?? 0) + 1);
    }
    return total;
  }, [items]);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (items ?? []).filter(
      (item) =>
        (!kind || item.kind === kind) &&
        (!needle ||
          (item.number ?? "").toLowerCase().includes(needle) ||
          item.fileNumber.toLowerCase().includes(needle) ||
          item.customerCompanyName.toLowerCase().includes(needle)),
    );
  }, [items, kind, query]);

  // Jobs the chosen document can be prepared on: open jobs of a service line that issues it.
  const eligibleJobs = useMemo(
    () =>
      (jobs ?? []).filter(
        (job) =>
          job.status !== "closed" &&
          job.status !== "cancelled" &&
          (prepareKind === "waybill" ||
            transportDocumentKindsFor(job.serviceLine).includes(prepareKind)),
      ),
    [jobs, prepareKind],
  );

  function startPrepare() {
    setPreparing(true);
    setJobId("");
    if (jobs) return;
    listJobs("")
      .then(setJobs)
      .catch((cause) =>
        setError(
          plainMessage(
            cause instanceof Error ? cause.message : "Jobs could not be loaded",
          ),
        ),
      );
  }

  function continuePrepare(event: FormEvent) {
    event.preventDefault();
    if (jobId) router.push(`/jobs/${jobId}/${prepareTab(prepareKind)}`);
  }

  async function openPdf(item: ShippingDocument) {
    // Opened first so the browser treats it as a click, not a pop-up.
    const tab = window.open("", "_blank");
    setError("");
    try {
      const blob =
        item.kind === "waybill"
          ? await fetchWaybillPdf(item.jobId, item.id)
          : await fetchTransportDocumentPdf(item.jobId, item.id);
      const url = URL.createObjectURL(blob);
      if (tab) tab.location.href = url;
      else window.location.href = url;
    } catch (cause) {
      tab?.close();
      setError(cause instanceof Error ? cause.message : "The PDF failed");
    }
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Shipping documents</h1>
        </div>
        <button className={styles.button} onClick={startPrepare} type="button">
          Prepare a document
        </button>
      </header>
      <ErrorPopup message={error} />
      <section className={styles.card} aria-label="Find a document">
        <div className={cards.statementFilters}>
          <label className={styles.field}>
            Type
            <select
              onChange={(event) => setKind(event.target.value as Kind | "")}
              value={kind}
            >
              <option value="">All ({items?.length ?? 0})</option>
              {kinds.map((key) => (
                <option key={key} value={key}>
                  {kindLabels[key]} ({counts.get(key) ?? 0})
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            Search
            <input
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Number, job or customer"
              type="search"
              value={query}
            />
          </label>
        </div>
      </section>
      {items && rows.length === 0 && (
        <p className={styles.muted}>
          {items.length === 0
            ? "No shipping documents yet."
            : "Nothing matches."}
        </p>
      )}
      {rows.length > 0 && (
        <section className={styles.card} aria-label="Shipping documents">
          <div className={cards.board}>
            <div className={cards.tableWrap}>
              <table className={cards.cardTable}>
                <thead>
                  <tr>
                    <th scope="col">Document</th>
                    <th scope="col">Job and customer</th>
                    <th scope="col">Status</th>
                    <th scope="col">Date</th>
                    <th aria-label="Actions" scope="col" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((item) => (
                    <tr key={`${item.kind}-${item.id}`}>
                      <td className={cards.jobCell}>
                        {item.number ?? "No number yet"}
                        <span className={cards.customerName}>
                          {kindLabels[item.kind]}
                        </span>
                      </td>
                      <td data-label="Job">
                        <Link
                          className={styles.link}
                          href={`/jobs/${item.jobId}/${prepareTab(item.kind)}`}
                        >
                          {item.fileNumber}
                        </Link>
                        <span className={cards.customerName}>
                          {item.customerCompanyName}
                        </span>
                      </td>
                      <td data-label="Status">{statusLabels[item.status]}</td>
                      <td data-label="Date">{formatDate(item.date)}</td>
                      <td>
                        <button
                          className={styles.secondaryButton}
                          onClick={() => void openPdf(item)}
                          type="button"
                        >
                          PDF
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}
      <dialog
        aria-labelledby="prepare-title"
        className={styles.dialog}
        onCancel={() => setPreparing(false)}
        ref={dialog}
      >
        <form className={styles.form} onSubmit={continuePrepare}>
          <h2 id="prepare-title">Prepare a document</h2>
          <label className={styles.field}>
            Document
            <select
              onChange={(event) => {
                setPrepareKind(event.target.value as Kind);
                setJobId("");
              }}
              value={prepareKind}
            >
              {kinds.map((key) => (
                <option key={key} value={key}>
                  {kindLabels[key]}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            Job
            <select
              onChange={(event) => setJobId(event.target.value)}
              required
              value={jobId}
            >
              <option value="">
                {jobs ? "Choose a job" : "Loading jobs…"}
              </option>
              {eligibleJobs.map((job) => (
                <option key={job.id} value={job.id}>
                  {job.fileNumber} · {job.customerCompanyName}
                </option>
              ))}
            </select>
          </label>
          {jobs && eligibleJobs.length === 0 && (
            <p className={styles.muted}>
              No open job can have a {kindLabels[prepareKind].toLowerCase()}.
            </p>
          )}
          <div className={styles.formActions}>
            <button className={styles.button} disabled={!jobId} type="submit">
              Continue
            </button>
            <button
              className={styles.secondaryButton}
              onClick={() => setPreparing(false)}
              type="button"
            >
              Cancel
            </button>
          </div>
        </form>
      </dialog>
    </main>
  );
}
