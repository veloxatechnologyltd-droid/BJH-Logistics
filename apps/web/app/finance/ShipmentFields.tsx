"use client";

import { Fragment } from "react";
import type { InvoiceShipment } from "@bjh/contracts";
import type {
  InvoiceShipmentInput,
  Job,
  Party,
  Reference,
} from "../jobs/jobApi";
import styles from "../jobs/jobs.module.css";

/** The shipment details as typed: every detail is text. */
export type ShipmentForm = Record<keyof InvoiceShipment, string>;

const keys: Array<keyof InvoiceShipment> = [
  "shipper",
  "consignee",
  "notifyParty",
  "freightForwarder",
  "billOfLading",
  "billOfLadingDate",
  "waybillNumber",
  "vessel",
  "voyage",
  "callDate",
  "placeOfReceipt",
  "portOfLoading",
  "portOfDischarge",
  "placeOfDelivery",
  "containerNumbers",
  "containerType",
  "sealNumbers",
  "commodityCode",
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

/** What the job already knows: parties, bill of lading, vessel, ports, containers, seals and goods. */
export function shipmentFromJob(
  job: Job,
  references: Reference[],
  parties: Party[] = [],
): ShipmentForm {
  const values = (kind: Reference["kind"]) =>
    references.filter((reference) => reference.kind === kind);
  const bill = values("house_bl")[0] ?? values("master_bl")[0];
  const containers = values("container");
  // Name, then its address or contact lines, as printed.
  const party = (role: Party["role"]) =>
    parties
      .filter((item) => item.role === role)
      .map((item) => [item.name, item.details].filter(Boolean).join("\n"))
      .join("\n\n");
  return {
    ...emptyShipment(),
    shipper: party("shipper"),
    consignee: party("consignee"),
    notifyParty: party("notify_party"),
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
  /** A name with address lines: a box of several lines. */
  lines?: boolean;
  /** Starts a group, under this small heading. */
  group?: string;
};

const partyHint = "Name, then address or contact on the next lines";

const details: Detail[] = [
  {
    key: "shipper",
    label: "Shipper",
    hint: partyHint,
    lines: true,
    group: "Parties",
  },
  { key: "consignee", label: "Consignee", hint: partyHint, lines: true },
  { key: "notifyParty", label: "Notify party", hint: partyHint, lines: true },
  {
    key: "freightForwarder",
    label: "Freight forwarder",
    hint: partyHint,
    lines: true,
  },
  {
    key: "billOfLading",
    label: "Bill of lading no.",
    group: "Documents and voyage",
  },
  { key: "billOfLadingDate", label: "Bill of lading date", type: "date" },
  { key: "waybillNumber", label: "Waybill no." },
  { key: "callDate", label: "Call date", type: "date" },
  { key: "vessel", label: "Vessel" },
  { key: "voyage", label: "Voyage" },
  { key: "placeOfReceipt", label: "Place of receipt" },
  { key: "portOfLoading", label: "Port of loading" },
  { key: "portOfDischarge", label: "Port of discharge" },
  { key: "placeOfDelivery", label: "Place of delivery" },
  { key: "containerNumbers", label: "Container number(s)", group: "Cargo" },
  { key: "containerType", label: "Container type", hint: "e.g. 1 x 40HQ" },
  { key: "sealNumbers", label: "Seal number(s)" },
  { key: "commodityCode", label: "Commodity (HS) code", hint: "e.g. 640299" },
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
 * The invoice's "Shipment details": parties, bill of lading and waybill,
 * vessel and route, containers and seals, goods, and quantity and weight.
 * Everything is optional; what is left empty is not printed.
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
      {details.map(({ key, label, hint, type, wide, lines, group }) => (
        <Fragment key={key}>
          {group && <h3 className={styles.shipmentGroup}>{group}</h3>}
          <label
            className={`${styles.field} ${wide ? styles.shipmentWide : ""}`}
          >
            {label}
            {lines ? (
              <textarea
                maxLength={500}
                onChange={(event) =>
                  onChange({ ...value, [key]: event.target.value })
                }
                placeholder={hint}
                rows={3}
                value={value[key]}
              />
            ) : (
              <input
                maxLength={key === "goods" ? 600 : 300}
                onChange={(event) =>
                  onChange({ ...value, [key]: event.target.value })
                }
                placeholder={hint}
                type={type ?? "text"}
                value={value[key]}
              />
            )}
          </label>
        </Fragment>
      ))}
    </fieldset>
  );
}
