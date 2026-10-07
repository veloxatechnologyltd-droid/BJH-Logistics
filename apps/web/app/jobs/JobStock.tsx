"use client";

import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { addStockMovement, getJobStock, listLocations } from "./jobApi";
import type { StockBalance, StockMovement, WarehouseLocation } from "./jobApi";
import styles from "./jobs.module.css";
import { ErrorPopup } from "../ErrorPopup";

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

/**
 * Goods held for the customer on a warehousing job: what came in, what went
 * out, and what is left. Staff record movements; customers read.
 */
export function JobStock({
  jobId,
  canEdit,
}: {
  jobId: string;
  canEdit: boolean;
}) {
  const [movements, setMovements] = useState<StockMovement[] | null>(null);
  const [balances, setBalances] = useState<StockBalance[]>([]);
  const [locations, setLocations] = useState<WarehouseLocation[]>([]);
  const [error, setError] = useState("");
  const [locationId, setLocationId] = useState("");
  const [kind, setKind] = useState<"receipt" | "release">("receipt");
  const [item, setItem] = useState("");
  const [unit, setUnit] = useState("");
  const [quantity, setQuantity] = useState("");
  const [conditionNotes, setConditionNotes] = useState("");
  const [reference, setReference] = useState("");
  const [occurredAt, setOccurredAt] = useState("");
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    try {
      const stock = await getJobStock(jobId);
      setMovements(stock.movements);
      setBalances(stock.balances);
      if (canEdit) {
        const list = (await listLocations()).filter(
          (location) => location.deactivatedAt === null,
        );
        setLocations(list);
        setLocationId((current) => current || list[0]?.id || "");
      }
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Stock could not be loaded",
      );
    }
  }, [jobId, canEdit]);

  useEffect(() => {
    void load();
  }, [load]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      await addStockMovement(jobId, {
        locationId,
        kind,
        item: item.trim(),
        unit: unit.trim() || undefined,
        quantity: Number(quantity),
        conditionNotes: conditionNotes.trim() || undefined,
        reference: reference.trim() || undefined,
        occurredAt: occurredAt ? new Date(occurredAt).toISOString() : undefined,
      });
      setItem("");
      setQuantity("");
      setConditionNotes("");
      setReference("");
      setOccurredAt("");
      setAdding(false);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The movement failed");
    }
  }

  return (
    <section className={styles.card} aria-labelledby="stock-title">
      <div className={styles.stepsHeading}>
        <h2 id="stock-title">Stock held</h2>
        {canEdit && !adding && (
          <button
            className={styles.secondaryButton}
            onClick={() => setAdding(true)}
            type="button"
          >
            Record goods in or out
          </button>
        )}
      </div>
      <ErrorPopup message={error} />
      {balances.length === 0 ? (
        <p className={styles.muted}>Nothing in stock.</p>
      ) : (
        <ul className={styles.itemList}>
          {balances.map((row) => (
            <li key={`${row.locationId}-${row.item}-${row.unit}`}>
              <div>
                <span>{row.locationName}</span>
                <strong>
                  {row.balance} {row.unit} · {row.item}
                </strong>
              </div>
            </li>
          ))}
        </ul>
      )}
      {movements && movements.length > 0 && (
        <details>
          <summary className={styles.disclosureSummary}>
            Goods in and out ({movements.length})
          </summary>
          <ul className={styles.list}>
            {movements.map((movement) => (
              <li key={movement.id}>
                {movement.kind === "receipt" ? "Received" : "Released"}{" "}
                {movement.quantity} {movement.unit} · {movement.item} ·{" "}
                {movement.locationName} · {formatDate(movement.occurredAt)}
                {movement.reference ? ` · ${movement.reference}` : ""}
                {movement.conditionNotes ? (
                  <>
                    <br />
                    <span className={styles.muted}>
                      Condition: {movement.conditionNotes}
                    </span>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        </details>
      )}
      {canEdit && adding && (
        <form
          className={`${styles.form} ${styles.quickUpdateForm}`}
          onSubmit={submit}
        >
          {locations.length === 0 && (
            <p className={styles.muted}>
              Add a location on the Warehouse page first.
            </p>
          )}
          <label className={styles.field}>
            Location
            <select
              onChange={(event) => setLocationId(event.target.value)}
              required
              value={locationId}
            >
              {locations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            Goods
            <select
              onChange={(event) =>
                setKind(event.target.value as "receipt" | "release")
              }
              value={kind}
            >
              <option value="receipt">Received into the warehouse</option>
              <option value="release">Released to the customer</option>
            </select>
          </label>
          <label className={styles.field}>
            Item
            <input
              maxLength={200}
              onChange={(event) => setItem(event.target.value)}
              required
              value={item}
            />
          </label>
          <label className={styles.field}>
            Quantity
            <input
              inputMode="numeric"
              min={1}
              onChange={(event) => setQuantity(event.target.value)}
              required
              type="number"
              value={quantity}
            />
          </label>
          <label className={styles.field}>
            Unit (for example cartons; default units)
            <input
              maxLength={40}
              onChange={(event) => setUnit(event.target.value)}
              value={unit}
            />
          </label>
          <label className={styles.field}>
            Delivery note or release order (optional)
            <input
              maxLength={200}
              onChange={(event) => setReference(event.target.value)}
              value={reference}
            />
          </label>
          <label className={styles.field}>
            Condition or handling discrepancy (optional)
            <input
              maxLength={2000}
              onChange={(event) => setConditionNotes(event.target.value)}
              value={conditionNotes}
            />
          </label>
          <label className={styles.field}>
            When (leave empty for now)
            <input
              onChange={(event) => setOccurredAt(event.target.value)}
              type="datetime-local"
              value={occurredAt}
            />
          </label>
          <div className={styles.formActions}>
            <button className={styles.button} type="submit">
              Save
            </button>
            <button
              className={styles.secondaryButton}
              onClick={() => setAdding(false)}
              type="button"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
