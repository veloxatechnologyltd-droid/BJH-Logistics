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
  updateVehicle,
} from "./transportApi";
import type { Driver, Vehicle } from "./transportApi";
import { ErrorPopup } from "../ErrorPopup";
import { VehicleForm } from "./VehicleForm";

const shortDate = (day: string) =>
  new Intl.DateTimeFormat("en-GH", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(`${day}T00:00:00Z`));

const todayUtc = () => new Date().toISOString().slice(0, 10);

/** "Insurance ends 3 Dec 2026", flagged when within 14 days or past. */
function PaperDate({ label, day }: { label: string; day: string | null }) {
  if (!day) return null;
  const daysLeft = Math.round(
    (Date.parse(day) - Date.parse(todayUtc())) / 86_400_000,
  );
  const flag =
    daysLeft < 0 ? " (overdue)" : daysLeft <= 14 ? " (due soon)" : "";
  return (
    <small>
      {label} {shortDate(day)}
      {flag && <strong>{flag}</strong>}
    </small>
  );
}

/** Drivers and vehicles are records staff assign; drivers do not sign in. */
export function TransportRecords() {
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [adding, setAdding] = useState<"" | "driver" | "vehicle">("");
  const [editing, setEditing] = useState<string | null>(null);

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
                {editing === vehicle.id ? (
                  <VehicleForm
                    onCancel={() => setEditing(null)}
                    onSave={(input) =>
                      void run(
                        () => updateVehicle(vehicle.id, input),
                        () => setEditing(null),
                      )
                    }
                    vehicle={vehicle}
                  />
                ) : (
                  <>
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
                      <PaperDate
                        day={vehicle.insuranceEndOn}
                        label="Insurance ends"
                      />
                      <PaperDate
                        day={vehicle.dvlaExpiresOn}
                        label="DVLA expires"
                      />
                      <PaperDate
                        day={vehicle.nextServiceOn}
                        label="Next service"
                      />
                      {vehicle.serviceEveryMonths &&
                        !vehicle.lastServicedOn && (
                          <small>
                            Serviced every {vehicle.serviceEveryMonths} months;
                            add the last service date
                          </small>
                        )}
                    </div>
                    <button
                      className={styles.textButton}
                      onClick={() => setEditing(vehicle.id)}
                      type="button"
                    >
                      Edit
                    </button>
                    {vehicle.serviceEveryMonths && (
                      <button
                        className={styles.textButton}
                        onClick={() =>
                          void run(() =>
                            updateVehicle(vehicle.id, {
                              registration: vehicle.registration,
                              description: vehicle.description ?? "",
                              insuranceStartOn: vehicle.insuranceStartOn ?? "",
                              insuranceEndOn: vehicle.insuranceEndOn ?? "",
                              dvlaExpiresOn: vehicle.dvlaExpiresOn ?? "",
                              serviceEveryMonths: vehicle.serviceEveryMonths,
                              lastServicedOn: todayUtc(),
                            }),
                          )
                        }
                        type="button"
                      >
                        Serviced today
                      </button>
                    )}
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
                  </>
                )}
              </li>
            ))}
          </ul>
          {adding === "vehicle" && (
            <VehicleForm
              onCancel={() => setAdding("")}
              onSave={(input) =>
                void run(
                  () => addVehicle(input),
                  () => setAdding(""),
                )
              }
            />
          )}
        </section>
      </div>
    </main>
  );
}
