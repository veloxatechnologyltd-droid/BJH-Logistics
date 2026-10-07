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

type Edit = { checked: boolean; value: string; seal: string };

/**
 * Reads the text of a PDF (a bill of lading, an air waybill) into a DRAFT list
 * of references. Nothing is added to the job until a person checks the values,
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

  const pdfs = documents.filter(
    (item) => item.versions.at(-1)?.contentType === "application/pdf",
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
            value: field.value,
            seal: field.sealNumber ?? "",
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

  const documentName = (id: string) =>
    documents.find((item) => item.id === id)?.versions.at(-1)?.filename ??
    "document";

  return (
    <section className={styles.card} aria-labelledby="extractions-title">
      <h2 id="extractions-title">Details read from documents</h2>
      <ErrorPopup message={error} />
      <div className={styles.actions}>
        <label className={styles.field}>
          PDF document
          <select
            onChange={(event) => setDocumentId(event.target.value)}
            value={documentId}
          >
            <option value="">Choose a PDF</option>
            {pdfs.map((item) => (
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
                No references were recognised in this document.
              </p>
            )}
          {item.status === "draft" &&
            item.fields.map((field, index) => {
              const edit = edits[item.id]?.[index];
              if (!edit) return null;
              return (
                <div className={styles.actions} key={`${field.key}-${index}`}>
                  <label>
                    <input
                      checked={edit.checked}
                      onChange={(event) =>
                        change(item.id, index, {
                          checked: event.target.checked,
                        })
                      }
                      type="checkbox"
                    />{" "}
                    {field.label}
                  </label>
                  <input
                    aria-label={`${field.label} value`}
                    maxLength={80}
                    onChange={(event) =>
                      change(item.id, index, { value: event.target.value })
                    }
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
                  <span className={styles.muted}>Found: {field.evidence}</span>
                </div>
              );
            })}
          {item.status === "draft" && (
            <div className={styles.actions}>
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
                              value: edit.value.trim(),
                              sealNumber: edit.seal.trim() || undefined,
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
