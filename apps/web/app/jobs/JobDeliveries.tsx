"use client";

import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import {
  dispatchDelivery,
  fetchWaybillPdf,
  listDeliveries,
  listDrivers,
  listVehicles,
  recordProof,
} from "../transport/transportApi";
import type { Delivery, Driver, Vehicle } from "../transport/transportApi";
import type { JobDocument } from "./jobApi";
import styles from "./jobs.module.css";
import { ErrorPopup } from "../ErrorPopup";

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

/** Waybills and proofs of delivery. Staff dispatch; customers only read. */
export function JobDeliveries({
  jobId,
  documents,
  canEdit,
}: {
  jobId: string;
  documents: JobDocument[];
  canEdit: boolean;
}) {
  const [deliveries, setDeliveries] = useState<Delivery[] | null>(null);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [error, setError] = useState("");
  const [driverId, setDriverId] = useState("");
  const [vehicleId, setVehicleId] = useState("");
  const [cargo, setCargo] = useState("");
  const [packages, setPackages] = useState("");
  const [weight, setWeight] = useState("");
  const [pickup, setPickup] = useState("");
  const [address, setAddress] = useState("");
  const [proofFor, setProofFor] = useState<string | null>(null);
  const [receiver, setReceiver] = useState("");
  const [receiverPhone, setReceiverPhone] = useState("");
  const [deliveredAt, setDeliveredAt] = useState("");
  const [damage, setDamage] = useState("");
  const [note, setNote] = useState("");
  const [adding, setAdding] = useState(false);

  async function openWaybill(deliveryId: string) {
    // Opened first so the browser treats it as a click, not a pop-up.
    const tab = window.open("", "_blank");
    setError("");
    try {
      const url = URL.createObjectURL(await fetchWaybillPdf(jobId, deliveryId));
      if (tab) tab.location.href = url;
      else window.location.href = url;
    } catch (cause) {
      tab?.close();
      setError(cause instanceof Error ? cause.message : "The PDF failed");
    }
  }

  const load = useCallback(async () => {
    try {
      setDeliveries(await listDeliveries(jobId));
      if (canEdit) {
        const [driverList, vehicleList] = await Promise.all([
          listDrivers(),
          listVehicles(),
        ]);
        setDrivers(driverList.filter((item) => item.deactivatedAt === null));
        setVehicles(vehicleList.filter((item) => item.deactivatedAt === null));
      }
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Deliveries could not be loaded",
      );
    }
  }, [jobId, canEdit]);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(action: () => Promise<unknown>, after?: () => void) {
    setError("");
    try {
      await action();
      after?.();
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The action failed");
    }
  }

  function submitDispatch(event: FormEvent) {
    event.preventDefault();
    void run(
      () =>
        dispatchDelivery(jobId, {
          driverId,
          vehicleId,
          cargoDescription: cargo.trim(),
          packages: packages.trim() ? Number(packages) : undefined,
          grossWeightKg: weight.trim() ? Number(weight) : undefined,
          pickupLocation: pickup.trim() || undefined,
          deliveryAddress: address.trim(),
        }),
      () => {
        setCargo("");
        setPackages("");
        setWeight("");
        setPickup("");
        setAddress("");
        setAdding(false);
      },
    );
  }

  function submitProof(event: FormEvent, delivery: Delivery) {
    event.preventDefault();
    void run(
      () =>
        recordProof(jobId, delivery.id, {
          receiverName: receiver.trim(),
          receiverPhone: receiverPhone.trim() || undefined,
          deliveredAt: deliveredAt
            ? new Date(deliveredAt).toISOString()
            : undefined,
          damageNotes: damage.trim() || undefined,
          podDocumentId: note || undefined,
        }),
      () => {
        setProofFor(null);
        setReceiver("");
        setReceiverPhone("");
        setDeliveredAt("");
        setDamage("");
        setNote("");
      },
    );
  }

  const deliveryNotes = documents.filter(
    (item) => item.documentType === "delivery_note",
  );

  return (
    <section className={styles.card} aria-labelledby="deliveries-title">
      <div className={styles.stepsHeading}>
        <h2 id="deliveries-title">Deliveries and waybills</h2>
        {canEdit && !adding && (
          <button
            className={styles.secondaryButton}
            onClick={() => setAdding(true)}
            type="button"
          >
            Dispatch a delivery
          </button>
        )}
      </div>
      <ErrorPopup message={error} />
      {deliveries && deliveries.length === 0 && (
        <p className={styles.muted}>No deliveries dispatched.</p>
      )}
      {deliveries && deliveries.length > 0 && (
        <ul className={styles.list}>
          {deliveries.map((delivery) => (
            <li key={delivery.id}>
              <strong>{delivery.waybillNumber}</strong> ·{" "}
              {delivery.status === "delivered" ? "Delivered" : "Dispatched"}
              <br />
              {delivery.cargoDescription}
              {delivery.packages ? ` · ${delivery.packages} packages` : ""}
              {delivery.grossWeightKg !== null
                ? ` · ${delivery.grossWeightKg} kg`
                : ""}
              <br />
              <span className={styles.muted}>
                {delivery.driverName} ({delivery.driverPhone}) ·{" "}
                {delivery.vehicleRegistration} · to {delivery.deliveryAddress} ·
                dispatched {formatDate(delivery.dispatchedAt)}
              </span>
              {delivery.status === "delivered" && (
                <>
                  <br />
                  Received by {delivery.receiverName}
                  {delivery.receiverPhone
                    ? ` (${delivery.receiverPhone})`
                    : ""}{" "}
                  ·{" "}
                  {delivery.deliveredAt ? formatDate(delivery.deliveredAt) : ""}
                  {delivery.damageNotes
                    ? ` · damage: ${delivery.damageNotes}`
                    : ""}
                </>
              )}{" "}
              <button
                className={styles.secondaryButton}
                onClick={() => void openWaybill(delivery.id)}
                type="button"
              >
                Waybill PDF
              </button>
              {canEdit && delivery.status === "dispatched" && (
                <>
                  {" "}
                  <button
                    className={styles.secondaryButton}
                    onClick={() =>
                      setProofFor(proofFor === delivery.id ? null : delivery.id)
                    }
                    type="button"
                  >
                    Record proof of delivery
                  </button>
                </>
              )}
              {canEdit && proofFor === delivery.id && (
                <form
                  className={`${styles.form} ${styles.quickUpdateForm}`}
                  onSubmit={(event) => submitProof(event, delivery)}
                >
                  <label className={styles.field}>
                    Received by
                    <input
                      onChange={(event) => setReceiver(event.target.value)}
                      required
                      value={receiver}
                    />
                  </label>
                  <label className={styles.field}>
                    Receiver phone (optional)
                    <input
                      onChange={(event) => setReceiverPhone(event.target.value)}
                      value={receiverPhone}
                    />
                  </label>
                  <label className={styles.field}>
                    When (optional, defaults to now)
                    <input
                      onChange={(event) => setDeliveredAt(event.target.value)}
                      type="datetime-local"
                      value={deliveredAt}
                    />
                  </label>
                  <label className={styles.field}>
                    Damage notes (optional)
                    <input
                      onChange={(event) => setDamage(event.target.value)}
                      value={damage}
                    />
                  </label>
                  <label className={styles.field}>
                    Signed delivery note (optional; upload it under Documents
                    first)
                    <select
                      onChange={(event) => setNote(event.target.value)}
                      value={note}
                    >
                      <option value="">None</option>
                      {deliveryNotes.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.versions.at(-1)?.filename ?? item.id}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className={styles.formActions}>
                    <button className={styles.button} type="submit">
                      Save proof of delivery
                    </button>
                    <button
                      className={styles.secondaryButton}
                      onClick={() => setProofFor(null)}
                      type="button"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}

      {canEdit && adding && (
        <form
          className={`${styles.form} ${styles.quickUpdateForm}`}
          onSubmit={submitDispatch}
        >
          <label className={styles.field}>
            Driver
            <select
              onChange={(event) => setDriverId(event.target.value)}
              required
              value={driverId}
            >
              <option value="">Select a driver</option>
              {drivers.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} ({item.phone})
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            Vehicle
            <select
              onChange={(event) => setVehicleId(event.target.value)}
              required
              value={vehicleId}
            >
              <option value="">Select a vehicle</option>
              {vehicles.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.registration}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            Cargo
            <input
              onChange={(event) => setCargo(event.target.value)}
              required
              value={cargo}
            />
          </label>
          <label className={styles.field}>
            Packages (optional)
            <input
              inputMode="numeric"
              onChange={(event) => setPackages(event.target.value)}
              value={packages}
            />
          </label>
          <label className={styles.field}>
            Gross weight in kg (optional)
            <input
              inputMode="decimal"
              onChange={(event) => setWeight(event.target.value)}
              value={weight}
            />
          </label>
          <label className={styles.field}>
            Pickup location (optional)
            <input
              onChange={(event) => setPickup(event.target.value)}
              value={pickup}
            />
          </label>
          <label className={styles.field}>
            Delivery address
            <input
              onChange={(event) => setAddress(event.target.value)}
              required
              value={address}
            />
          </label>
          <div className={styles.formActions}>
            <button className={styles.button} type="submit">
              Dispatch and number the waybill
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
