"use client";

import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { ChargeOptions } from "../ChargeOptions";
import { formatMoney, toMinor } from "../quotes/quoteApi";
import { addCharge, listCharges, recordActual, removeCharge } from "./jobApi";
import type { JobCharge, JobDocument } from "./jobApi";
import styles from "./jobs.module.css";
import { ErrorPopup } from "../ErrorPopup";

export const evidenceTypes = ["supplier_invoice", "disbursement_evidence"];

/**
 * What BJH paid suppliers on a job (third-party, "at cost" charges), with the
 * supplier's document. These amounts are billed on the invoice and give the
 * profit figures. BJH's own priced charges are invoice lines and are not
 * listed here (Evans, 2026-11-04: keep Finance simple).
 */
export function JobCharges({
  jobId,
  documents,
  canEdit,
}: {
  jobId: string;
  documents: JobDocument[];
  canEdit: boolean;
}) {
  const [charges, setCharges] = useState<JobCharge[] | null>(null);
  const [error, setError] = useState("");
  // The cost being recorded or corrected; "new" adds one.
  const [editing, setEditing] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [evidence, setEvidence] = useState("");

  const load = useCallback(async () => {
    try {
      setCharges((await listCharges(jobId)).charges);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Costs could not be loaded",
      );
    }
  }, [jobId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(action: () => Promise<unknown>) {
    setError("");
    try {
      await action();
      setEditing(null);
      setDescription("");
      setAmount("");
      setEvidence("");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The action failed");
    }
  }

  function begin(charge: JobCharge | null) {
    setEditing(charge ? charge.id : "new");
    setDescription("");
    setAmount(
      charge?.currentActual
        ? (charge.currentActual.amountMinor / 100).toFixed(2)
        : "",
    );
    setEvidence(charge?.currentActual?.supplierDocumentId ?? "");
  }

  function submit(event: FormEvent, charge: JobCharge | null) {
    event.preventDefault();
    const minor = toMinor(amount);
    if (minor === undefined || Number.isNaN(minor)) {
      setError("Enter the amount as a number such as 250 or 250.50");
      return;
    }
    // Costs are paid in cedis; an at-cost charge is billed at what was paid.
    const paid = (chargeId: string, correctionOf?: string) =>
      recordActual(jobId, chargeId, {
        amountMinor: minor,
        currency: "GHS",
        supplierDocumentId: evidence || undefined,
        correctionOf,
      });
    void run(async () => {
      if (charge) return paid(charge.id, charge.currentActual?.id);
      const created = await addCharge(jobId, {
        kind: "disbursement",
        description: description.trim(),
        currency: "GHS",
      });
      return paid(created.id);
    });
  }

  // A priced service charge that already has an amount stays listed so it
  // can be corrected.
  const costs = (charges ?? []).filter(
    (charge) => charge.kind !== "service" || charge.currentActual !== null,
  );
  const evidenceDocs = documents.filter((item) =>
    evidenceTypes.includes(item.documentType),
  );
  const documentName = (id: string | null) =>
    id
      ? (documents.find((item) => item.id === id)?.versions.at(-1)?.filename ??
        "document")
      : null;
  const paidTotals = new Map<string, number>();
  for (const charge of costs) {
    const actual = charge.currentActual;
    if (actual) {
      paidTotals.set(
        actual.currency,
        (paidTotals.get(actual.currency) ?? 0) + actual.amountMinor,
      );
    }
  }

  const form = (charge: JobCharge | null) => (
    <form
      className={`${styles.form} ${styles.quickUpdateForm}`}
      onSubmit={(event) => submit(event, charge)}
    >
      {charge ? (
        <h2 className={styles.wide}>What BJH paid for {charge.description}</h2>
      ) : (
        <label className={styles.field}>
          What was it for
          <input
            autoFocus
            list="job-cost-options"
            maxLength={300}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Pick or type any cost"
            required
            value={description}
          />
          <ChargeOptions id="job-cost-options" />
        </label>
      )}
      <label className={styles.field}>
        Amount paid (GHS)
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
        <button className={styles.button} type="submit">
          Save
        </button>
        <button
          className={styles.secondaryButton}
          onClick={() => setEditing(null)}
          type="button"
        >
          Cancel
        </button>
      </div>
    </form>
  );

  return (
    <section className={styles.card} aria-labelledby="costs-title">
      <div className={styles.stepsHeading}>
        <h2 id="costs-title">What BJH paid suppliers</h2>
        {canEdit && editing !== "new" && (
          <button
            className={styles.secondaryButton}
            onClick={() => begin(null)}
            type="button"
          >
            Add a cost
          </button>
        )}
      </div>
      <ErrorPopup message={error} />
      {[...paidTotals].map(([code, minor]) => (
        <p key={code}>
          Total paid <strong>{formatMoney(minor, code)}</strong>
        </p>
      ))}
      {charges && costs.length === 0 && (
        <p className={styles.muted}>No costs recorded.</p>
      )}
      {costs.length > 0 && (
        <div className={styles.tableScroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Cost</th>
                <th scope="col">BJH paid</th>
                <th scope="col">Supplier document</th>
                {canEdit && <th aria-label="Actions" scope="col" />}
              </tr>
            </thead>
            <tbody>
              {costs.map((charge) => (
                <tr key={charge.id}>
                  <th scope="row">{charge.description}</th>
                  <td>
                    {charge.currentActual
                      ? formatMoney(
                          charge.currentActual.amountMinor,
                          charge.currentActual.currency,
                        )
                      : "Not recorded"}
                  </td>
                  <td>
                    {charge.currentActual
                      ? (documentName(
                          charge.currentActual.supplierDocumentId,
                        ) ?? "Not attached")
                      : "-"}
                  </td>
                  {canEdit && (
                    <td>
                      <div className={styles.actions}>
                        <button
                          className={styles.textButton}
                          onClick={() => begin(charge)}
                          type="button"
                        >
                          {charge.currentActual ? "Change" : "Enter amount"}
                        </button>
                        {charge.actuals.length === 0 && (
                          <button
                            className={styles.textButton}
                            onClick={() =>
                              void run(() => removeCharge(jobId, charge.id))
                            }
                            type="button"
                          >
                            Remove
                          </button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {canEdit && editing === "new" && form(null)}
      {canEdit &&
        costs
          .filter((charge) => charge.id === editing)
          .map((charge) => <div key={charge.id}>{form(charge)}</div>)}
    </section>
  );
}
