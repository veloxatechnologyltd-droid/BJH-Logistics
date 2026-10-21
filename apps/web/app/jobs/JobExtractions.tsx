"use client";

import { useCallback, useEffect, useState } from "react";
import {
  approveExtraction,
  extractDocument,
  listExtractions,
  rejectExtraction,
} from "./jobApi";
import type { Extraction, JobDocument } from "./jobApi";
import styles from "./jobs.module.css";
import { ErrorPopup } from "../ErrorPopup";

type Edit = { checked: boolean; value: string; seal: string; details: string };

const readable = ["application/pdf", "image/png", "image/jpeg"];
const partyKeys = ["shipper", "consignee", "notify_party", "agent"];

/** An ISO time as the value of a datetime-local box, in the browser's time (GMT in Ghana). */
function localInput(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * Reads a document (a bill of lading, an air waybill, an arrival notice) into a
 * DRAFT: references, and with AI also parties and the ETA. AI reads PDFs,
 * scans and photos; without it, a PDF's text gives references only. Nothing is added to the job until a person checks the values,
 * corrects them if needed, and applies the ones they choose.
 */
export function JobExtractions({
  jobId,
  documents,
  canEdit,
  onApplied,
}: {
  jobId: string;
  documents: JobDocument[];
  canEdit: boolean;
  /** Called after fields were applied, so the job's references reload. */
  onApplied: () => void;
}) {
  const [items, setItems] = useState<Extraction[] | null>(null);
  const [error, setError] = useState("");
  const [documentId, setDocumentId] = useState("");
  const [edits, setEdits] = useState<Record<string, Edit[]>>({});

  const files = documents.filter((item) =>
    readable.includes(item.versions.at(-1)?.contentType ?? ""),
  );

  const load = useCallback(async () => {
    try {
      const loaded = await listExtractions(jobId);
      setItems(loaded);
      setEdits((current) => {
        const next = { ...current };
        for (const item of loaded) {
          next[item.id] ??= item.fields.map((field) => ({
            checked: true,
            value: field.key === "eta" ? localInput(field.value) : field.value,
            seal: field.sealNumber ?? "",
            details: field.details ?? "",
          }));
        }
        return next;
      });
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Drafts could not be loaded",
      );
    }
  }, [jobId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(action: () => Promise<unknown>, applied = false) {
    setError("");
    try {
      await action();
      await load();
      if (applied) onApplied();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The action failed");
    }
  }

  const change = (id: string, index: number, patch: Partial<Edit>) =>
    setEdits((current) => ({
      ...current,
      [id]: current[id].map((edit, at) =>
        at === index ? { ...edit, ...patch } : edit,
      ),
    }));

  /** The ETA box holds local time; the API takes an ISO time. */
  const etaValue = (item: Extraction, index: number, value: string) => {
    if (item.fields[index]?.key !== "eta") return value;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toISOString();
  };

  const documentName = (id: string) =>
    documents.find((item) => item.id === id)?.versions.at(-1)?.filename ??
    "document";

  return (
    <section className={styles.card} aria-labelledby="extractions-title">
      <h2 id="extractions-title">Details read from documents</h2>
      <ErrorPopup message={error} />
      <div className={styles.actions}>
        <label className={styles.field}>
          Document
          <select
            onChange={(event) => setDocumentId(event.target.value)}
            value={documentId}
          >
            <option value="">Choose a PDF or image</option>
            {files.map((item) => (
              <option key={item.id} value={item.id}>
                {item.versions.at(-1)?.filename ?? item.documentType}
              </option>
            ))}
          </select>
        </label>
        <button
          className={styles.secondaryButton}
          disabled={!documentId}
          onClick={() => void run(() => extractDocument(jobId, documentId))}
          type="button"
        >
          Read details (draft)
        </button>
      </div>
      {items && items.length === 0 && (
        <p className={styles.muted}>Nothing read yet.</p>
      )}
      {items?.map((item) => (
        <div className={styles.form} key={item.id}>
          <h3>
            {documentName(item.documentId)} ·{" "}
            {item.status === "draft"
              ? "draft"
              : item.status === "approved"
                ? "applied"
                : "rejected"}
          </h3>
          {item.status === "draft" && item.readBy && (
            <p className={styles.muted}>
              Read by AI ({item.readBy}). Check every value against the document
              before applying it.
            </p>
          )}
          {item.status === "draft" && !item.textFound && (
            <p className={styles.muted}>
              This PDF has no text to read (it is probably a scan). Add the
              references by hand.
            </p>
          )}
          {item.status === "draft" &&
            item.textFound &&
            item.fields.length === 0 && (
              <p className={styles.muted}>
                Nothing was recognised in this document.
              </p>
            )}
          {item.status === "draft" &&
            item.fields.map((field, index) => {
              const edit = edits[item.id]?.[index];
              if (!edit) return null;
              return (
                <div
                  className={styles.draftField}
                  key={`${field.key}-${index}`}
                >
                  <label className={styles.draftLabel}>
                    <input
                      checked={edit.checked}
                      onChange={(event) =>
                        change(item.id, index, {
                          checked: event.target.checked,
                        })
                      }
                      type="checkbox"
                    />
                    {field.label}
                  </label>
                  <div
                    className={
                      field.key === "container"
                        ? `${styles.draftInputs} ${styles.draftInputsPair}`
                        : styles.draftInputs
                    }
                  >
                    <input
                      aria-label={`${field.label} value`}
                      maxLength={partyKeys.includes(field.key) ? 200 : 80}
                      onChange={(event) =>
                        change(item.id, index, { value: event.target.value })
                      }
                      type={field.key === "eta" ? "datetime-local" : "text"}
                      value={edit.value}
                    />
                    {field.key === "container" && (
                      <input
                        aria-label="Seal number"
                        maxLength={80}
                        onChange={(event) =>
                          change(item.id, index, { seal: event.target.value })
                        }
                        placeholder="Seal number"
                        value={edit.seal}
                      />
                    )}
                    {partyKeys.includes(field.key) && (
                      <textarea
                        aria-label={`${field.label} address and contact`}
                        maxLength={1000}
                        onChange={(event) =>
                          change(item.id, index, {
                            details: event.target.value,
                          })
                        }
                        placeholder="Address and contact"
                        rows={2}
                        value={edit.details}
                      />
                    )}
                  </div>
                  <p className={styles.draftFound}>
                    Found: {field.evidence}
                    {field.key === "eta" &&
                      " · Applying it messages the customer, like any ETA change."}
                  </p>
                </div>
              );
            })}
          {item.status === "draft" && (
            <div className={`${styles.actions} ${styles.draftActions}`}>
              {item.fields.length > 0 && (
                <button
                  className={styles.button}
                  disabled={!canEdit}
                  onClick={() =>
                    void run(
                      () =>
                        approveExtraction(
                          jobId,
                          item.id,
                          (edits[item.id] ?? [])
                            .map((edit, index) => ({ edit, index }))
                            .filter(({ edit }) => edit.checked)
                            .map(({ edit, index }) => ({
                              index,
                              value: etaValue(item, index, edit.value.trim()),
                              sealNumber: edit.seal.trim() || undefined,
                              details: edit.details.trim() || undefined,
                            })),
                        ),
                      true,
                    )
                  }
                  type="button"
                >
                  Apply the ticked details to the job
                </button>
              )}
              <button
                className={styles.secondaryButton}
                onClick={() => void run(() => rejectExtraction(jobId, item.id))}
                type="button"
              >
                Discard this draft
              </button>
            </div>
          )}
          {item.status === "approved" && item.applied && (
            <ul className={styles.list}>
              {item.applied.map((result) => (
                <li key={result.index}>
                  {result.value}: {result.result}
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </section>
  );
}
