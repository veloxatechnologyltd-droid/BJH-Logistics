"use client";

import { useCallback, useEffect, useState } from "react";
import {
  formatBlContainers,
  formatTableRows,
  parseBlContainers,
  parseTableRows,
  sumBlContainerWeights,
  sumTableColumn,
  transportDocumentFields,
  transportDocumentKindsFor,
  transportDocumentTitles,
} from "@bjh/contracts";
import type {
  BlContainer,
  TableRow,
  ServiceLine,
  TransportDocumentKind,
} from "@bjh/contracts";
import {
  createTransportDocument,
  fetchTransportDocumentPdf,
  issueTransportDocument,
  listTransportDocuments,
  prefillTransportDocument,
  updateTransportDocument,
  voidTransportDocument,
} from "./jobApi";
import type { TransportDocument } from "./jobApi";
import styles from "./jobs.module.css";
import { ErrorPopup } from "../ErrorPopup";

type Editing = {
  id: string | null;
  kind: TransportDocumentKind;
  number: string;
  fields: Record<string, string>;
};

/**
 * BJH's own house B/L, house air waybill and air manifest for this job: start
 * from what the job holds, fill in the rest, type the number, issue. An issued
 * document is frozen; a mistake is corrected by voiding it and issuing a new one.
 * Customers see the issued ones.
 */
export function JobTransportDocuments({
  jobId,
  serviceLine,
  isStaff,
  canEdit,
}: {
  jobId: string;
  serviceLine: ServiceLine;
  isStaff: boolean;
  canEdit: boolean;
}) {
  const kinds = transportDocumentKindsFor(serviceLine);
  const [items, setItems] = useState<TransportDocument[] | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<Editing | null>(null);
  // The house B/L's containers while editing; saved as lines of text.
  const [containerRows, setContainerRows] = useState<BlContainer[]>([]);
  // Table fields (manifest shipment lines) while editing, by field key.
  const [tables, setTables] = useState<Record<string, TableRow[]>>({});

  const load = useCallback(async () => {
    try {
      setItems(await listTransportDocuments(jobId));
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Documents could not be loaded",
      );
    }
  }, [jobId]);

  useEffect(() => {
    if (kinds.length > 0) void load();
  }, [load, kinds.length]);

  const loadTables = (
    kind: TransportDocumentKind,
    fields: Record<string, string>,
  ) =>
    Object.fromEntries(
      transportDocumentFields[kind]
        .filter((field) => field.columns)
        .map((field) => [
          field.key,
          parseTableRows(fields[field.key], field.columns ?? []),
        ]),
    );

  if (kinds.length === 0) return null;
  if (!isStaff && (!items || items.length === 0)) return null;

  async function run(action: () => Promise<unknown>) {
    setError("");
    try {
      await action();
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The action failed");
    }
  }

  async function openPdf(documentId: string) {
    // Opened first so the browser treats it as a click, not a pop-up.
    const tab = window.open("", "_blank");
    setError("");
    try {
      const url = URL.createObjectURL(
        await fetchTransportDocumentPdf(jobId, documentId),
      );
      if (tab) tab.location.href = url;
      else window.location.href = url;
    } catch (cause) {
      tab?.close();
      setError(cause instanceof Error ? cause.message : "The PDF failed");
    }
  }

  async function start(kind: TransportDocumentKind) {
    setError("");
    try {
      const suggestion = await prefillTransportDocument(jobId, kind);
      setContainerRows(parseBlContainers(suggestion.fields.containers ?? ""));
      setTables(loadTables(kind, suggestion.fields));
      setEditing({
        id: null,
        kind,
        number: suggestion.documentNumber ?? "",
        fields: suggestion.fields,
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The action failed");
    }
  }

  /** Changing the containers also refreshes the gross weight with their sum. */
  function changeContainers(next: BlContainer[]) {
    setContainerRows(next);
    const total = sumBlContainerWeights(next);
    if (editing && total !== null) {
      setEditing({
        ...editing,
        fields: { ...editing.fields, grossWeight: total },
      });
    }
  }

  async function save(issueAfter: boolean) {
    if (!editing) return;
    await run(async () => {
      const input = {
        documentNumber: editing.number.trim() || undefined,
        fields: {
          ...editing.fields,
          ...(editing.kind === "house_bl"
            ? { containers: formatBlContainers(containerRows) }
            : {}),
          ...Object.fromEntries(
            transportDocumentFields[editing.kind]
              .filter((field) => field.columns)
              .map((field) => [
                field.key,
                formatTableRows(tables[field.key] ?? [], field.columns ?? []),
              ]),
          ),
        },
      };
      const saved = editing.id
        ? await updateTransportDocument(jobId, editing.id, input)
        : await createTransportDocument(jobId, {
            kind: editing.kind,
            ...input,
          });
      if (issueAfter) await issueTransportDocument(jobId, saved.id);
      setEditing(null);
    });
  }

  const groups = editing
    ? [...new Set(transportDocumentFields[editing.kind].map((f) => f.group))]
    : [];

  return (
    <section className={styles.card} aria-labelledby="transport-docs-title">
      <div className={styles.stepsHeading}>
        <h2 id="transport-docs-title">House documents</h2>
        {isStaff && canEdit && !editing && (
          <div className={styles.actions}>
            {kinds.map((kind) => (
              <button
                className={styles.secondaryButton}
                key={kind}
                onClick={() => void start(kind)}
                type="button"
              >
                New {transportDocumentTitles[kind]}
              </button>
            ))}
          </div>
        )}
      </div>
      <ErrorPopup message={error} />
      {items && items.length === 0 && (
        <p className={styles.muted}>No documents yet.</p>
      )}
      {items && items.length > 0 && (
        <ul className={styles.itemList}>
          {items.map((item) => (
            <li key={item.id}>
              <div>
                <span>{transportDocumentTitles[item.kind]}</span>
                <strong>{item.documentNumber ?? "Not numbered"}</strong>
                <small>
                  {item.status === "draft"
                    ? "Draft"
                    : item.status === "issued"
                      ? "Issued"
                      : "Void"}
                  {item.status === "void" && item.voidReason
                    ? ` · ${item.voidReason}`
                    : ""}
                </small>
              </div>
              <div className={styles.actions}>
                <button
                  className={styles.textButton}
                  onClick={() => void openPdf(item.id)}
                  type="button"
                >
                  {item.status === "draft" ? "Preview PDF" : "PDF"}
                </button>
                {isStaff && canEdit && item.status === "draft" && (
                  <>
                    <button
                      className={styles.textButton}
                      onClick={() => {
                        setContainerRows(
                          parseBlContainers(item.fields.containers ?? ""),
                        );
                        setTables(loadTables(item.kind, item.fields));
                        setEditing({
                          id: item.id,
                          kind: item.kind,
                          number: item.documentNumber ?? "",
                          fields: item.fields,
                        });
                      }}
                      type="button"
                    >
                      Edit
                    </button>
                  </>
                )}
                {isStaff && canEdit && item.status !== "void" && (
                  <button
                    className={styles.textButton}
                    onClick={() => {
                      const why = window.prompt("Reason")?.trim();
                      if (!why) return;
                      void run(() =>
                        voidTransportDocument(jobId, item.id, why),
                      );
                    }}
                    type="button"
                  >
                    Void
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {isStaff && editing && (
        <form
          className={styles.form}
          onSubmit={(event) => {
            event.preventDefault();
            void save(false);
          }}
        >
          <h3>{transportDocumentTitles[editing.kind]}</h3>
          {editing.kind !== "house_bl" && (
            <label className={styles.field}>
              Document number (needed to issue; must be unused)
              <input
                maxLength={80}
                onChange={(event) =>
                  setEditing({ ...editing, number: event.target.value })
                }
                value={editing.number}
              />
            </label>
          )}
          {groups.map((group) => (
            <fieldset key={group}>
              <legend>{group}</legend>
              {transportDocumentFields[editing.kind]
                .filter((field) => field.group === group)
                .map((field) =>
                  field.columns ? (
                    <div className={styles.field} key={field.key}>
                      {field.label}
                      {(tables[field.key] ?? []).map((row, index) => (
                        <div className={styles.tableRow} key={index}>
                          {(field.columns ?? []).map((column) => {
                            const change = (value: string) =>
                              setTables({
                                ...tables,
                                [field.key]: (tables[field.key] ?? []).map(
                                  (item, at) =>
                                    at === index
                                      ? { ...item, [column.key]: value }
                                      : item,
                                ),
                              });
                            return (
                              <label className={styles.field} key={column.key}>
                                {column.label}
                                {column.multiline ? (
                                  <textarea
                                    aria-label={`${column.label}, line ${index + 1}`}
                                    maxLength={500}
                                    onChange={(event) =>
                                      change(event.target.value)
                                    }
                                    rows={3}
                                    value={row[column.key] ?? ""}
                                  />
                                ) : (
                                  <input
                                    aria-label={`${column.label}, line ${index + 1}`}
                                    maxLength={80}
                                    onChange={(event) =>
                                      change(event.target.value)
                                    }
                                    value={row[column.key] ?? ""}
                                  />
                                )}
                              </label>
                            );
                          })}
                          <button
                            className={styles.textButton}
                            onClick={() =>
                              setTables({
                                ...tables,
                                [field.key]: (tables[field.key] ?? []).filter(
                                  (_, at) => at !== index,
                                ),
                              })
                            }
                            type="button"
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                      <button
                        className={styles.secondaryButton}
                        onClick={() =>
                          setTables({
                            ...tables,
                            [field.key]: [...(tables[field.key] ?? []), {}],
                          })
                        }
                        type="button"
                      >
                        Add line
                      </button>
                      <p className={styles.muted}>
                        {(field.columns ?? [])
                          .filter((column) => column.sum)
                          .map((column) => {
                            const total = sumTableColumn(
                              tables[field.key] ?? [],
                              column.key,
                            );
                            return total === null
                              ? null
                              : `${column.label}: ${total}`;
                          })
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </div>
                  ) : field.key === "containers" ? (
                    <div className={styles.field} key={field.key}>
                      {field.label}
                      {containerRows.map((row, index) => (
                        <div className={styles.containerRow} key={index}>
                          {(
                            [
                              ["number", "Container no.", 30],
                              ["seal", "Seal no.", 30],
                              ["weightKg", "Weight (kg)", 12],
                            ] as const
                          ).map(([key, label, max]) => (
                            <input
                              aria-label={`${label}, container ${index + 1}`}
                              key={key}
                              maxLength={max}
                              onChange={(event) =>
                                changeContainers(
                                  containerRows.map((item, at) =>
                                    at === index
                                      ? { ...item, [key]: event.target.value }
                                      : item,
                                  ),
                                )
                              }
                              placeholder={label}
                              value={row[key]}
                            />
                          ))}
                          <button
                            className={styles.textButton}
                            onClick={() =>
                              changeContainers(
                                containerRows.filter((_, at) => at !== index),
                              )
                            }
                            type="button"
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                      <button
                        className={styles.secondaryButton}
                        onClick={() =>
                          setContainerRows([
                            ...containerRows,
                            { number: "", seal: "", weightKg: "" },
                          ])
                        }
                        type="button"
                      >
                        Add container
                      </button>
                      {sumBlContainerWeights(containerRows) !== null && (
                        <p className={styles.muted}>
                          Total: {sumBlContainerWeights(containerRows)} kg (also
                          entered as the gross weight)
                        </p>
                      )}
                    </div>
                  ) : (
                    <label className={styles.field} key={field.key}>
                      {field.label}
                      {field.multiline ? (
                        <textarea
                          maxLength={2000}
                          onChange={(event) =>
                            setEditing({
                              ...editing,
                              fields: {
                                ...editing.fields,
                                [field.key]: event.target.value,
                              },
                            })
                          }
                          rows={3}
                          value={editing.fields[field.key] ?? ""}
                        />
                      ) : (
                        <input
                          maxLength={300}
                          onChange={(event) =>
                            setEditing({
                              ...editing,
                              fields: {
                                ...editing.fields,
                                [field.key]: event.target.value,
                              },
                            })
                          }
                          value={editing.fields[field.key] ?? ""}
                        />
                      )}
                    </label>
                  ),
                )}
            </fieldset>
          ))}
          <div className={styles.actions}>
            <button className={styles.button} type="submit">
              Save draft
            </button>
            <button
              className={styles.button}
              onClick={() => void save(true)}
              type="button"
            >
              Save and issue
            </button>
            <button
              className={styles.secondaryButton}
              onClick={() => setEditing(null)}
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
