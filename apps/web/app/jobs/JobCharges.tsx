"use client";

import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { chargeKindLabels } from "@bjh/contracts";
import type { ChargeKind } from "@bjh/contracts";
import { formatMoney, getQuote, toMinor } from "../quotes/quoteApi";
import { getSettings } from "../settings/business/settingsApi";
import {
  addCharge,
  importCharges,
  listCharges,
  recordActual,
  removeCharge,
} from "./jobApi";
import type { ChargeTotals, JobCharge, JobDocument } from "./jobApi";
import styles from "./jobs.module.css";
import { ErrorPopup } from "../ErrorPopup";

const evidenceTypes = ["supplier_invoice", "disbursement_evidence"];
const popularCurrencies = [
  "GHS",
  "USD",
  "EUR",
  "GBP",
  "CNY",
  "AED",
  "NGN",
  "ZAR",
];

/** Job costing: what was quoted vs what it cost, with supplier evidence. */
export function JobCharges({
  jobId,
  quoteId,
  documents,
  canEdit,
}: {
  jobId: string;
  quoteId: string | null;
  documents: JobDocument[];
  canEdit: boolean;
}) {
  const [charges, setCharges] = useState<JobCharge[] | null>(null);
  const [totals, setTotals] = useState<ChargeTotals[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [kind, setKind] = useState<ChargeKind>("service");
  const [description, setDescription] = useState("");
  const [currency, setCurrency] = useState("");
  const [configuredCurrencies, setConfiguredCurrencies] = useState<string[]>(
    [],
  );
  const [quantity, setQuantity] = useState("1");
  const [quoted, setQuoted] = useState("");
  const [size, setSize] = useState("");
  const [containerCount, setContainerCount] = useState("1");
  const [quoteSizes, setQuoteSizes] = useState<string[]>([]);
  const [recording, setRecording] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [evidence, setEvidence] = useState("");
  const [note, setNote] = useState("");
  const [adding, setAdding] = useState<"" | "charge" | "copy">("");

  const load = useCallback(async () => {
    try {
      const result = await listCharges(jobId);
      setCharges(result.charges);
      setTotals(result.totals);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Charges could not be loaded",
      );
    }
  }, [jobId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    getSettings()
      .then(({ current }) => {
        if (!current) return;
        setConfiguredCurrencies(current.settings.currencies);
      })
      .catch(() => setError("Currencies could not be loaded"));
  }, []);

  useEffect(() => {
    if (!quoteId) {
      setQuoteSizes([]);
      return;
    }
    getQuote(quoteId)
      .then((quote) => setQuoteSizes(quote.versions.at(-1)?.sizeLabels ?? []))
      .catch(() => setQuoteSizes([]));
  }, [quoteId]);

  async function run(action: () => Promise<unknown>, after?: () => void) {
    setError("");
    setNotice("");
    try {
      await action();
      after?.();
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The action failed");
    }
  }

  function submitCharge(event: FormEvent) {
    event.preventDefault();
    const unit = toMinor(quoted);
    if (Number.isNaN(unit)) {
      setError("Amounts must be numbers such as 250 or 250.50");
      return;
    }
    void run(
      () =>
        addCharge(jobId, {
          kind,
          description: description.trim(),
          currency: currency.trim(),
          quantity: Number(quantity) || 1,
          unitQuotedMinor: unit,
        }),
      () => {
        setDescription("");
        setQuoted("");
        setQuantity("1");
        setAdding("");
      },
    );
  }

  function submitActual(event: FormEvent, charge: JobCharge) {
    event.preventDefault();
    const minor = toMinor(amount);
    if (minor === undefined || Number.isNaN(minor)) {
      setError("Enter the amount as a number such as 250 or 250.50");
      return;
    }
    void run(
      () =>
        recordActual(jobId, charge.id, {
          amountMinor: minor,
          currency: "GHS",
          supplierDocumentId: evidence || undefined,
          note: note.trim() || undefined,
          correctionOf: charge.currentActual?.id,
        }),
      () => {
        setRecording(null);
        setAmount("");
        setEvidence("");
        setNote("");
      },
    );
  }

  const evidenceDocs = documents.filter((item) =>
    evidenceTypes.includes(item.documentType),
  );
  const evidenceName = (id: string | null) =>
    id
      ? (documents.find((item) => item.id === id)?.versions.at(-1)?.filename ??
        "document")
      : null;
  const actualTotals = new Map<string, number>();
  for (const charge of charges ?? []) {
    const actual = charge.currentActual;
    if (actual) {
      actualTotals.set(
        actual.currency,
        (actualTotals.get(actual.currency) ?? 0) + actual.amountMinor,
      );
    }
  }

  return (
    <section className={styles.card} aria-labelledby="charges-title">
      <div className={styles.stepsHeading}>
        <h2 id="charges-title">Charges and costs</h2>
        {canEdit && (
          <div className={styles.actions}>
            {quoteId && adding !== "copy" && (
              <button
                className={styles.secondaryButton}
                onClick={() => setAdding("copy")}
                type="button"
              >
                Copy from quote
              </button>
            )}
            {adding !== "charge" && (
              <button
                className={styles.secondaryButton}
                onClick={() => setAdding("charge")}
                type="button"
              >
                Add charge
              </button>
            )}
          </div>
        )}
      </div>
      <ErrorPopup message={error} />
      {notice && <p className={styles.notice}>{notice}</p>}

      {totals.map((item) => (
        <p key={item.currency}>
          Quoted <strong>{formatMoney(item.quotedMinor, item.currency)}</strong>
          {item.chargesWithoutActual > 0 &&
            ` · ${item.chargesWithoutActual} without an actual amount`}
          {item.disbursementsWithoutEvidence > 0 &&
            ` · ${item.disbursementsWithoutEvidence} disbursement(s) without a supplier document`}
        </p>
      ))}
      {[...actualTotals].map(([code, minor]) => (
        <p key={code}>
          Actual paid <strong>{formatMoney(minor, code)}</strong>
        </p>
      ))}

      {charges && charges.length === 0 && (
        <p className={styles.muted}>No charges yet.</p>
      )}
      {charges && charges.length > 0 && (
        <div className={styles.tableScroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Charge</th>
                <th scope="col">Quoted</th>
                <th scope="col">Actual</th>
                <th scope="col">Evidence</th>
                {canEdit && <th scope="col">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {charges.map((charge) => (
                <tr key={charge.id}>
                  <th scope="row">
                    {charge.description}
                    <br />
                    <span className={styles.muted}>
                      {chargeKindLabels[charge.kind]}
                      {charge.quantity > 1 ? ` · × ${charge.quantity}` : ""}
                      {charge.quoteContainerSize
                        ? ` · ${charge.quoteContainerSize}`
                        : ""}
                    </span>
                  </th>
                  <td>
                    {charge.quotedTotalMinor === null
                      ? "At cost"
                      : formatMoney(charge.quotedTotalMinor, charge.currency)}
                  </td>
                  <td>
                    {charge.currentActual ? (
                      <>
                        {formatMoney(
                          charge.currentActual.amountMinor,
                          charge.currentActual.currency,
                        )}
                        {charge.actuals.length > 1 && (
                          <>
                            <br />
                            <span className={styles.muted}>
                              {charge.actuals.length} entries
                            </span>
                          </>
                        )}
                      </>
                    ) : (
                      "Not recorded"
                    )}
                  </td>
                  <td>
                    {charge.kind === "service"
                      ? "-"
                      : charge.currentActual === null
                        ? "Awaiting amount"
                        : (evidenceName(
                            charge.currentActual.supplierDocumentId,
                          ) ?? "Missing")}
                  </td>
                  {canEdit && (
                    <td>
                      <button
                        className={styles.secondaryButton}
                        onClick={() =>
                          setRecording(
                            recording === charge.id ? null : charge.id,
                          )
                        }
                        type="button"
                      >
                        {charge.currentActual
                          ? "Correct amount"
                          : "Record amount"}
                      </button>{" "}
                      {charge.actuals.length === 0 && (
                        <button
                          className={styles.secondaryButton}
                          onClick={() =>
                            void run(() => removeCharge(jobId, charge.id))
                          }
                          type="button"
                        >
                          Remove
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {canEdit &&
        charges
          ?.filter((charge) => charge.id === recording)
          .map((charge) => (
            <form
              className={`${styles.form} ${styles.quickUpdateForm}`}
              key={charge.id}
              onSubmit={(event) => submitActual(event, charge)}
            >
              <h2 className={styles.wide}>
                {charge.currentActual ? "Correct" : "Record"} the amount for{" "}
                {charge.description}
              </h2>
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
              <label className={styles.field}>
                Note (optional)
                <input
                  onChange={(event) => setNote(event.target.value)}
                  value={note}
                />
              </label>
              <div className={styles.formActions}>
                <button className={styles.button} type="submit">
                  Save amount
                </button>
                <button
                  className={styles.secondaryButton}
                  onClick={() => setRecording(null)}
                  type="button"
                >
                  Cancel
                </button>
              </div>
            </form>
          ))}

      {canEdit && (
        <>
          {adding === "charge" && (
            <form
              className={`${styles.form} ${styles.quickUpdateForm}`}
              onSubmit={submitCharge}
            >
              <label className={styles.field}>
                Type
                <select
                  onChange={(event) =>
                    setKind(event.target.value as ChargeKind)
                  }
                  value={kind}
                >
                  {(Object.keys(chargeKindLabels) as ChargeKind[]).map(
                    (item) => (
                      <option key={item} value={item}>
                        {chargeKindLabels[item]}
                      </option>
                    ),
                  )}
                </select>
              </label>
              <label className={styles.field}>
                Description
                <input
                  autoFocus
                  onChange={(event) => setDescription(event.target.value)}
                  required
                  value={description}
                />
              </label>
              <label className={styles.field}>
                Quoted currency
                <select
                  onChange={(event) => setCurrency(event.target.value)}
                  required
                  value={currency}
                >
                  <option value="">Choose currency</option>
                  {[
                    ...new Set(
                      [
                        ...(configuredCurrencies.length
                          ? configuredCurrencies
                          : popularCurrencies),
                        currency,
                      ].filter(Boolean),
                    ),
                  ].map((code) => (
                    <option key={code} value={code}>
                      {code}
                    </option>
                  ))}
                </select>
              </label>
              <label className={styles.field}>
                Quantity
                <input
                  inputMode="numeric"
                  onChange={(event) => setQuantity(event.target.value)}
                  value={quantity}
                />
              </label>
              <label className={styles.field}>
                Quoted amount each (leave empty for at cost)
                <input
                  inputMode="decimal"
                  onChange={(event) => setQuoted(event.target.value)}
                  value={quoted}
                />
              </label>
              <div className={styles.formActions}>
                <button className={styles.button} type="submit">
                  Save
                </button>
                <button
                  className={styles.secondaryButton}
                  onClick={() => setAdding("")}
                  type="button"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}

          {quoteId && adding === "copy" && (
            <div className={`${styles.form} ${styles.quickUpdateForm}`}>
              <label className={styles.field}>
                Container size (needed when the quote prices by size)
                <select
                  onChange={(event) => setSize(event.target.value)}
                  value={size}
                >
                  <option value="">Not applicable</option>
                  {quoteSizes.map((label) => (
                    <option key={label} value={label}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className={styles.field}>
                Number of containers of this size
                <input
                  inputMode="numeric"
                  min="1"
                  onChange={(event) => setContainerCount(event.target.value)}
                  type="number"
                  value={containerCount}
                />
              </label>
              <div className={styles.formActions}>
                <button
                  className={styles.button}
                  onClick={() =>
                    void run(async () => {
                      const result = await importCharges(
                        jobId,
                        size || undefined,
                        Number(containerCount) || 1,
                      );
                      setNotice(
                        `${result.created.length} charge(s) copied, ${result.skipped} already on the job.`,
                      );
                      setAdding("");
                    })
                  }
                  type="button"
                >
                  Copy charges
                </button>
                <button
                  className={styles.secondaryButton}
                  onClick={() => setAdding("")}
                  type="button"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
