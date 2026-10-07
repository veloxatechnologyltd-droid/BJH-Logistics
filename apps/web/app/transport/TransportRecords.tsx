"use client";

import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import styles from "../jobs/jobs.module.css";
import {
  addDriver,
  addVehicle,
  listDrivers,
  listVehicles,
  setDriverActive,
  setVehicleActive,
} from "./transportApi";
import type { Driver, Vehicle } from "./transportApi";
import { ErrorPopup } from "../ErrorPopup";

/** Drivers and vehicles are records staff assign; drivers do not sign in. */
export function TransportRecords() {
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [registration, setRegistration] = useState("");
  const [description, setDescription] = useState("");
  const [adding, setAdding] = useState<"" | "driver" | "vehicle">("");

  const load = useCallback(async () => {
    try {
      const [driverList, vehicleList] = await Promise.all([
        listDrivers(),
        listVehicles(),
      ]);
      setDrivers(driverList);
      setVehicles(vehicleList);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Records could not be loaded",
      );
    }
  }, []);

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

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Drivers and vehicles</h1>
        </div>
      </header>
      <ErrorPopup message={error} />

      <div className={`${styles.grid} ${styles.compactGrid}`}>
        <section className={styles.card} aria-labelledby="drivers-title">
          <div className={styles.stepsHeading}>
            <h2 id="drivers-title">Drivers</h2>
            {adding !== "driver" && (
              <button
                className={styles.secondaryButton}
                onClick={() => setAdding("driver")}
                type="button"
              >
                Add driver
              </button>
            )}
          </div>
          {drivers.length === 0 && (
            <p className={styles.muted}>No drivers yet.</p>
          )}
          <ul className={styles.itemList}>
            {drivers.map((driver) => (
              <li key={driver.id}>
                <div>
                  <strong>{driver.name}</strong>
                  <small>
                    {driver.phone}
                    {driver.deactivatedAt ? " · out of service" : ""}
                  </small>
                </div>
                <button
                  className={styles.textButton}
                  onClick={() =>
                    void run(() =>
                      setDriverActive(driver.id, driver.deactivatedAt !== null),
                    )
                  }
                  type="button"
                >
                  {driver.deactivatedAt ? "Return to service" : "Take out"}
                </button>
              </li>
            ))}
          </ul>
          {adding === "driver" && (
            <form
              className={styles.form}
              onSubmit={(event: FormEvent) => {
                event.preventDefault();
                void run(
                  () => addDriver({ name: name.trim(), phone: phone.trim() }),
                  () => {
                    setName("");
                    setPhone("");
                    setAdding("");
                  },
                );
              }}
            >
              <label className={styles.field}>
                Name
                <input
                  autoFocus
                  onChange={(event) => setName(event.target.value)}
                  required
                  value={name}
                />
              </label>
              <label className={styles.field}>
                Phone
                <input
                  onChange={(event) => setPhone(event.target.value)}
                  required
                  value={phone}
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
        </section>

        <section className={styles.card} aria-labelledby="vehicles-title">
          <div className={styles.stepsHeading}>
            <h2 id="vehicles-title">Vehicles</h2>
            {adding !== "vehicle" && (
              <button
                className={styles.secondaryButton}
                onClick={() => setAdding("vehicle")}
                type="button"
              >
                Add vehicle
              </button>
            )}
          </div>
          {vehicles.length === 0 && (
            <p className={styles.muted}>No vehicles yet.</p>
          )}
          <ul className={styles.itemList}>
            {vehicles.map((vehicle) => (
              <li key={vehicle.id}>
                <div>
                  <strong>{vehicle.registration}</strong>
                  {(vehicle.description || vehicle.deactivatedAt) && (
                    <small>
                      {vehicle.description ?? ""}
                      {vehicle.description && vehicle.deactivatedAt
                        ? " · "
                        : ""}
                      {vehicle.deactivatedAt ? "out of service" : ""}
                    </small>
                  )}
                </div>
                <button
                  className={styles.textButton}
                  onClick={() =>
                    void run(() =>
                      setVehicleActive(
                        vehicle.id,
                        vehicle.deactivatedAt !== null,
                      ),
                    )
                  }
                  type="button"
                >
                  {vehicle.deactivatedAt ? "Return to service" : "Take out"}
                </button>
              </li>
            ))}
          </ul>
          {adding === "vehicle" && (
            <form
              className={styles.form}
              onSubmit={(event: FormEvent) => {
                event.preventDefault();
                void run(
                  () =>
                    addVehicle({
                      registration: registration.trim(),
                      description: description.trim() || undefined,
                    }),
                  () => {
                    setRegistration("");
                    setDescription("");
                    setAdding("");
                  },
                );
              }}
            >
              <label className={styles.field}>
                Registration
                <input
                  autoFocus
                  onChange={(event) => setRegistration(event.target.value)}
                  required
                  value={registration}
                />
              </label>
              <label className={styles.field}>
                Description (optional)
                <input
                  onChange={(event) => setDescription(event.target.value)}
                  value={description}
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
        </section>
      </div>
    </main>
  );
}
