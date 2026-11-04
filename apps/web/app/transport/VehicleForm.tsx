"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import styles from "../jobs/jobs.module.css";
import type { Vehicle, VehicleInput } from "./transportApi";

const blank: VehicleInput = {
  registration: "",
  description: "",
  insuranceStartOn: "",
  insuranceEndOn: "",
  dvlaExpiresOn: "",
  serviceEveryMonths: 3,
  lastServicedOn: "",
};

/** Add or edit a vehicle: registration, insurance, DVLA and servicing. */
export function VehicleForm({
  vehicle,
  onSave,
  onCancel,
}: {
  vehicle?: Vehicle;
  onSave: (input: VehicleInput) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState<VehicleInput>(
    vehicle
      ? {
          registration: vehicle.registration,
          description: vehicle.description ?? "",
          insuranceStartOn: vehicle.insuranceStartOn ?? "",
          insuranceEndOn: vehicle.insuranceEndOn ?? "",
          dvlaExpiresOn: vehicle.dvlaExpiresOn ?? "",
          serviceEveryMonths: vehicle.serviceEveryMonths,
          lastServicedOn: vehicle.lastServicedOn ?? "",
        }
      : blank,
  );
  const set = (key: keyof VehicleInput) => (text: string) =>
    setValue((current) => ({ ...current, [key]: text }));

  return (
    <form
      className={styles.form}
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        onSave({
          ...value,
          registration: value.registration.trim(),
          description: value.description?.trim() ?? "",
        });
      }}
    >
      <label className={styles.field}>
        Registration
        <input
          autoFocus
          maxLength={40}
          onChange={(event) => set("registration")(event.target.value)}
          required
          value={value.registration}
        />
      </label>
      <label className={styles.field}>
        Description (optional)
        <input
          maxLength={200}
          onChange={(event) => set("description")(event.target.value)}
          value={value.description ?? ""}
        />
      </label>
      <label className={styles.field}>
        Insurance starts
        <input
          onChange={(event) => set("insuranceStartOn")(event.target.value)}
          type="date"
          value={value.insuranceStartOn ?? ""}
        />
      </label>
      <label className={styles.field}>
        Insurance ends
        <input
          min={value.insuranceStartOn || undefined}
          onChange={(event) => set("insuranceEndOn")(event.target.value)}
          type="date"
          value={value.insuranceEndOn ?? ""}
        />
      </label>
      <label className={styles.field}>
        DVLA roadworthy expires
        <input
          onChange={(event) => set("dvlaExpiresOn")(event.target.value)}
          type="date"
          value={value.dvlaExpiresOn ?? ""}
        />
      </label>
      <label className={styles.field}>
        Service every (months)
        <input
          max={60}
          min={1}
          onChange={(event) =>
            setValue((current) => ({
              ...current,
              serviceEveryMonths: event.target.value
                ? Number(event.target.value)
                : null,
            }))
          }
          type="number"
          value={value.serviceEveryMonths ?? ""}
        />
      </label>
      <label className={styles.field}>
        Last serviced on
        <input
          onChange={(event) => set("lastServicedOn")(event.target.value)}
          type="date"
          value={value.lastServicedOn ?? ""}
        />
      </label>
      <p className={styles.muted}>
        The super admin is notified 14 days before the insurance ends, the DVLA
        expires or the next service is due, and again on the day.
      </p>
      <div className={styles.formActions}>
        <button className={styles.button} type="submit">
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
  );
}
