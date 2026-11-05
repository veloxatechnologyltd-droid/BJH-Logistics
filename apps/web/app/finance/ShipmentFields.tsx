"use client";

import type { InvoiceShipment } from "@bjh/contracts";
import type { InvoiceShipmentInput, Job, Reference } from "../jobs/jobApi";
import styles from "../jobs/jobs.module.css";

/** The shipment details as typed: every detail is text. */
export type ShipmentForm = Record<keyof InvoiceShipment, string>;

const keys: Array<keyof InvoiceShipment> = [
  "billOfLading",
  "billOfLadingDate",
  "vessel",
  "voyage",
  "portOfLoading",
  "portOfDischarge",
  "containerNumbers",
  "containerType",
  "sealNumbers",
  "goods",
  "otherReferences",
  "packages",
  "weightKg",
  "volumeCbm",
];

export const emptyShipment = (): ShipmentForm =>
  Object.fromEntries(keys.map((key) => [key, ""])) as ShipmentForm;

export const toShipmentForm = (
  shipment: InvoiceShipment | null,
): ShipmentForm =>
  Object.fromEntries(
    keys.map((key) => [key, shipment?.[key] ?? ""]),
  ) as ShipmentForm;

/** Only the details filled in; nothing at all when the form is empty. */
export function shipmentInput(form: ShipmentForm): InvoiceShipmentInput | null {
  const filled = Object.fromEntries(
    keys
      .map((key) => [key, form[key].trim()] as const)
      .filter(([, value]) => value !== ""),
  ) as InvoiceShipmentInput;
  return Object.keys(filled).length > 0 ? filled : null;
}

/** What the job already knows: bill of lading, vessel, ports, containers, seals and goods. */
export function shipmentFromJob(
  job: Job,
  references: Reference[],
): ShipmentForm {
  const values = (kind: Reference["kind"]) =>
    references.filter((reference) => reference.kind === kind);
  const bill = values("house_bl")[0] ?? values("master_bl")[0];
  const containers = values("container");
  return {
    ...emptyShipment(),
    billOfLading: bill?.value ?? "",
    vessel: job.vessel ?? "",
    portOfLoading: job.portOfLoading ?? "",
    portOfDischarge: job.portOfDischarge ?? "",
    containerNumbers: containers.map((item) => item.value).join(", "),
    sealNumbers: containers
      .map((item) => item.sealNumber)
      .filter(Boolean)
      .join(", "),
    goods: job.goodsDescription ?? "",
  };
}

type Detail = {
  key: keyof InvoiceShipment;
  label: string;
  hint?: string;
  type?: "date";
  wide?: boolean;
};

const details: Detail[] = [
  { key: "billOfLading", label: "Bill of lading no." },
  { key: "billOfLadingDate", label: "Bill of lading date", type: "date" },
  { key: "vessel", label: "Vessel" },
  { key: "voyage", label: "Voyage" },
  { key: "portOfLoading", label: "Port of loading" },
  { key: "portOfDischarge", label: "Port of discharge" },
  { key: "containerNumbers", label: "Container number(s)" },
  { key: "containerType", label: "Container type", hint: "e.g. 1 x 40HQ" },
  { key: "sealNumbers", label: "Seal number(s)" },
  { key: "goods", label: "Goods", wide: true },
  {
    key: "otherReferences",
    label: "Other references",
    hint: "e.g. Chassis: LVAV2JVB7LE200954",
    wide: true,
  },
  { key: "packages", label: "Packages", hint: "e.g. 56" },
  { key: "weightKg", label: "Weight (kg)", hint: "e.g. 2,840" },
  { key: "volumeCbm", label: "Volume (CBM)", hint: "e.g. 32.96" },
];

/**
 * The invoice's "Shipment details": bill of lading, vessel and route,
 * containers and seals, goods, and quantity and weight. Everything is
 * optional; what is left empty is not printed.
 */
export function ShipmentFields({
  value,
  onChange,
}: {
  value: ShipmentForm;
  onChange: (next: ShipmentForm) => void;
}) {
  return (
    <fieldset className={styles.shipmentFields}>
      <legend>Shipment details (optional)</legend>
      <p className={styles.muted}>
        Printed on the invoice. Leave out whatever does not apply.
      </p>
      {details.map(({ key, label, hint, type, wide }) => (
        <label
          className={`${styles.field} ${wide ? styles.shipmentWide : ""}`}
          key={key}
        >
          {label}
          <input
            maxLength={key === "goods" ? 600 : 300}
            onChange={(event) =>
              onChange({ ...value, [key]: event.target.value })
            }
            placeholder={hint}
            type={type ?? "text"}
            value={value[key]}
          />
        </label>
      ))}
    </fieldset>
  );
}
