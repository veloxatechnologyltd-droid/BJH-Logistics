"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import type { PartyRole, ReferenceKind } from "@bjh/contracts";
import {
  addParty,
  addReference,
  removeParty,
  removeReference,
} from "../../jobApi";
import { JobExtractions } from "../../JobExtractions";
import { JobVoyage } from "../../JobVoyage";
import { useJob } from "../../JobShell";
import styles from "../../jobs.module.css";

const partyRoles: Array<[PartyRole, string]> = [
  ["shipper", "Shipper"],
  ["consignee", "Consignee"],
  ["notify_party", "Notify party"],
  ["agent", "Agent"],
];
const referenceLabels: Record<ReferenceKind, string> = {
  master_bl: "Master B/L",
  house_bl: "House B/L",
  master_awb: "Master AWB",
  house_awb: "House AWB",
  booking: "Booking",
  container: "Container",
};
const seaKinds: ReferenceKind[] = [
  "master_bl",
  "house_bl",
  "booking",
  "container",
];
const airKinds: ReferenceKind[] = ["master_awb", "house_awb", "booking"];
const parentKinds: Partial<Record<ReferenceKind, ReferenceKind>> = {
  house_bl: "master_bl",
  house_awb: "master_awb",
};

export default function JobShipmentPage() {
  const {
    job,
    parties,
    references,
    documents,
    isStaff,
    closedJob,
    run,
    reload,
  } = useJob();
  const [partyRole, setPartyRole] = useState<PartyRole>("consignee");
  const [partyName, setPartyName] = useState("");
  const [partyDetails, setPartyDetails] = useState("");
  const [kind, setKind] = useState<ReferenceKind>("booking");
  const [value, setValue] = useState("");
  const [seal, setSeal] = useState("");
  const [parentId, setParentId] = useState("");
  const [adding, setAdding] = useState<"" | "party" | "reference">("");

  const kinds = job.serviceLine.startsWith("sea") ? seaKinds : airKinds;
  const parentKind = parentKinds[kind];
  const parentChoices = references.filter(
    (reference) => reference.kind === parentKind,
  );

  const canEdit = isStaff && !closedJob;
  const orderedReferences = references
    .filter((reference) => !reference.parentReferenceId)
    .flatMap((reference) => [
      reference,
      ...references.filter((child) => child.parentReferenceId === reference.id),
    ]);
  return (
    <>
      <JobVoyage
        canEdit={isStaff && !closedJob}
        job={job}
        key={`${job.vessel}|${job.portOfLoading}|${job.portOfDischarge}`}
        onSaved={reload}
      />
      <section className={styles.card} aria-labelledby="parties-title">
        <div className={styles.stepsHeading}>
          <h2 id="parties-title">Parties</h2>
          {canEdit && adding !== "party" && (
            <button
              className={styles.secondaryButton}
              onClick={() => setAdding("party")}
              type="button"
            >
              Add party
            </button>
          )}
        </div>
        {parties.length === 0 ? (
          <p className={styles.muted}>No parties recorded.</p>
        ) : (
          <ul className={styles.itemList}>
            {parties.map((party) => (
              <li key={party.id}>
                <div>
                  <span>
                    {partyRoles.find(([key]) => key === party.role)?.[1]}
                  </span>
                  <strong>{party.name}</strong>
                  {party.details && <small>{party.details}</small>}
                </div>
                {canEdit && (
                  <button
                    className={styles.textButton}
                    onClick={() =>
                      void run(() => removeParty(job.id, party.id))
                    }
                    type="button"
                  >
                    Remove
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {canEdit && adding === "party" && (
          <form
            className={`${styles.form} ${styles.quickUpdateForm}`}
            onSubmit={(event: FormEvent) => {
              event.preventDefault();
              void run(
                () =>
                  addParty(job.id, {
                    role: partyRole,
                    name: partyName,
                    details: partyDetails.trim() || undefined,
                  }),
                () => {
                  setPartyName("");
                  setPartyDetails("");
                  setAdding("");
                },
              );
            }}
          >
            <label className={styles.field}>
              Role
              <select
                onChange={(event) =>
                  setPartyRole(event.target.value as PartyRole)
                }
                value={partyRole}
              >
                {partyRoles.map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.field}>
              Name
              <input
                autoFocus
                onChange={(event) => setPartyName(event.target.value)}
                required
                value={partyName}
              />
            </label>
            <label className={styles.field}>
              Details (optional)
              <input
                onChange={(event) => setPartyDetails(event.target.value)}
                value={partyDetails}
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

      <section className={styles.card} aria-labelledby="references-title">
        <div className={styles.stepsHeading}>
          <h2 id="references-title">Shipment references</h2>
          {canEdit && adding !== "reference" && (
            <button
              className={styles.secondaryButton}
              onClick={() => setAdding("reference")}
              type="button"
            >
              Add reference
            </button>
          )}
        </div>
        {references.length === 0 ? (
          <p className={styles.muted}>No references recorded.</p>
        ) : (
          <ul className={styles.itemList}>
            {orderedReferences.map((reference) => (
              <li
                key={reference.id}
                style={
                  reference.parentReferenceId ? { marginLeft: 18 } : undefined
                }
              >
                <div>
                  <span>{referenceLabels[reference.kind]}</span>
                  <strong>{reference.value}</strong>
                  {reference.sealNumber && (
                    <small>Seal {reference.sealNumber}</small>
                  )}
                </div>
                {canEdit && (
                  <button
                    className={styles.textButton}
                    onClick={() =>
                      void run(() => removeReference(job.id, reference.id))
                    }
                    type="button"
                  >
                    Remove
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {canEdit && adding === "reference" && (
          <form
            className={`${styles.form} ${styles.quickUpdateForm}`}
            onSubmit={(event: FormEvent) => {
              event.preventDefault();
              void run(
                () =>
                  addReference(job.id, {
                    kind,
                    value,
                    sealNumber: seal.trim() || undefined,
                    parentReferenceId: parentId || undefined,
                  }),
                () => {
                  setValue("");
                  setSeal("");
                  setAdding("");
                },
              );
            }}
          >
            <label className={styles.field}>
              Type
              <select
                onChange={(event) => {
                  setKind(event.target.value as ReferenceKind);
                  setParentId("");
                }}
                value={kind}
              >
                {kinds.map((key) => (
                  <option key={key} value={key}>
                    {referenceLabels[key]}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.field}>
              Number
              <input
                autoFocus
                onChange={(event) => setValue(event.target.value)}
                required
                value={value}
              />
            </label>
            {kind === "container" && (
              <label className={styles.field}>
                Seal number (optional)
                <input
                  onChange={(event) => setSeal(event.target.value)}
                  value={seal}
                />
              </label>
            )}
            {parentKind && (
              <label className={styles.field}>
                Under master
                <select
                  onChange={(event) => setParentId(event.target.value)}
                  required
                  value={parentId}
                >
                  <option value="">Select the master</option>
                  {parentChoices.map((choice) => (
                    <option key={choice.id} value={choice.id}>
                      {choice.value}
                    </option>
                  ))}
                </select>
              </label>
            )}
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

      {isStaff && (
        <JobExtractions
          canEdit={!closedJob}
          documents={documents}
          jobId={job.id}
          onApplied={() => void reload()}
        />
      )}
    </>
  );
}
