"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { ChargeOptions } from "../ChargeOptions";
import { evidenceTypes } from "../jobs/JobCharges";
import {
  addCharge,
  listCharges,
  listDocuments,
  recordActual,
  serviceLineLabels,
} from "../jobs/jobApi";
import type { Job, JobCharge, JobDocument } from "../jobs/jobApi";
import { toMinor } from "../quotes/quoteApi";
import styles from "../jobs/jobs.module.css";
import { ErrorPopup } from "../ErrorPopup";

/**
 * Record what BJH paid a supplier: choose the client, then one of their jobs
 * (a cost is always kept on a job), then either a new cost or one already
 * recorded on that job, to pay an extra amount under the same name. An extra
 * amount is its own line with its own supplier document, so the earlier
 * amount and its document stay as they were. Costs are paid in cedis and an
 * at-cost charge is billed at what was paid, as on the job's cost list.
 */
export function RecordCost({
  jobs,
  jobId,
  clientId,
  onSaved,
  onCancel,
}: {
  /** Jobs that can take costs (not closed or cancelled). */
  jobs: Job[];
  /** The job to start on, when it can take costs. */
  jobId: string;
  /** The client to start on, when the job is not known. */
  clientId: string;
  onSaved: (jobId: string) => void;
  onCancel: () => void;
}) {
  // A client with one job that can take costs has that job chosen for them.
  const onlyJob = (company: string) => {
    const ofClient = jobs.filter((job) => job.customerCompanyId === company);
    return ofClient.length === 1 ? ofClient[0].id : "";
  };
  const startJob = jobs.find((job) => job.id === jobId);
  const [client, setClient] = useState(
    startJob?.customerCompanyId ??
      (jobs.some((job) => job.customerCompanyId === clientId) ? clientId : ""),
  );
  const [chosen, setChosen] = useState(startJob?.id ?? onlyJob(clientId));
  // The description of the recorded cost an extra amount is for; empty for a new cost.
  const [existing, setExisting] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [evidence, setEvidence] = useState("");
  // Kept with its job, so a slow answer for a job chosen earlier is not shown.
  const [loaded, setLoaded] = useState<{
    jobId: string;
    charges: JobCharge[];
    documents: JobDocument[];
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!chosen) return;
    Promise.all([listCharges(chosen), listDocuments(chosen)])
      .then(([found, documents]) =>
        setLoaded({ jobId: chosen, charges: found.charges, documents }),
      )
      .catch((cause) =>
        setError(
          cause instanceof Error
            ? cause.message
            : "The job's costs could not be loaded",
        ),
      );
  }, [chosen]);

  const clients = [
    ...new Map(jobs.map((item) => [item.customerCompanyId, item])),
  ]
    .map(([id, item]) => ({ id, name: item.customerCompanyName }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const clientJobs = jobs.filter((item) => item.customerCompanyId === client);
  const job = loaded?.jobId === chosen ? loaded : null;
  const recorded = [
    ...new Set(
      (job?.charges ?? [])
        .filter((charge) => charge.currentActual !== null)
        .map((charge) => charge.description),
    ),
  ];
  const evidenceDocs = (job?.documents ?? []).filter((item) =>
    evidenceTypes.includes(item.documentType),
  );

  async function submit(event: FormEvent) {
    event.preventDefault();
    const minor = toMinor(amount);
    if (minor === undefined || Number.isNaN(minor)) {
      setError("Enter the amount as a number such as 250 or 250.50");
      return;
    }
    setError("");
    setSaving(true);
    try {
      const created = await addCharge(chosen, {
        kind: "disbursement",
        description: (existing || description).trim(),
        currency: "GHS",
      });
      await recordActual(chosen, created.id, {
        amountMinor: minor,
        currency: "GHS",
        supplierDocumentId: evidence || undefined,
      });
      onSaved(chosen);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The action failed");
      setSaving(false);
    }
  }

  return (
    <section className={styles.card} aria-labelledby="record-cost-title">
      <h2 id="record-cost-title">Record a cost</h2>
      <ErrorPopup message={error} />
      <form
        className={`${styles.form} ${styles.quickUpdateForm}`}
        onSubmit={(event) => void submit(event)}
      >
        <label className={styles.field}>
          Client
          <select
            autoFocus
            onChange={(event) => {
              setClient(event.target.value);
              setChosen(onlyJob(event.target.value));
              setExisting("");
              setEvidence("");
            }}
            required
            value={client}
          >
            <option value="">Choose a client</option>
            {clients.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          Job
          <select
            disabled={!client}
            onChange={(event) => {
              setChosen(event.target.value);
              setExisting("");
              setEvidence("");
            }}
            required
            value={chosen}
          >
            <option value="">Choose a job</option>
            {clientJobs.map((item) => (
              <option key={item.id} value={item.id}>
                {item.fileNumber} · {serviceLineLabels[item.serviceLine]}
              </option>
            ))}
          </select>
        </label>
        {recorded.length > 0 && (
          <label className={styles.field}>
            Cost
            <select
              onChange={(event) => setExisting(event.target.value)}
              value={existing}
            >
              <option value="">A new cost</option>
              {recorded.map((name) => (
                <option key={name} value={name}>
                  Add to {name}
                </option>
              ))}
            </select>
          </label>
        )}
        {!existing && (
          <label className={styles.field}>
            What was it for
            <input
              list="record-cost-options"
              maxLength={300}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Pick or type any cost"
              required
              value={description}
            />
            <ChargeOptions id="record-cost-options" />
          </label>
        )}
        <label className={styles.field}>
          {existing ? "Extra amount paid (GHS)" : "Amount paid (GHS)"}
          <input
            inputMode="decimal"
            onChange={(event) => setAmount(event.target.value)}
            required
            value={amount}
          />
        </label>
        <label className={styles.field}>
          Supplier document (optional)
          <select
            onChange={(event) => setEvidence(event.target.value)}
            value={evidence}
          >
            <option value="">None</option>
            {evidenceDocs.map((item) => (
              <option key={item.id} value={item.id}>
                {item.versions.at(-1)?.filename ?? item.id}
              </option>
            ))}
          </select>
        </label>
        <div className={styles.formActions}>
          <button className={styles.button} disabled={saving} type="submit">
            Save
          </button>
          <button
            className={styles.secondaryButton}
            onClick={onCancel}
            type="button"
          >
            Cancel
          </button>
        </div>
      </form>
    </section>
  );
}
