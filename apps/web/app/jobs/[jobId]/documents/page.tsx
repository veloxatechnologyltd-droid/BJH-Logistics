"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { documentTypeLabels } from "@bjh/contracts";
import type { DocumentType } from "@bjh/contracts";
import { documentTypesFor } from "../../../auth/roleAccess";
import { useStaffAccess } from "../../../auth/useStaffAccess";
import { getDownloadLink, uploadDocument } from "../../jobApi";
import { formatDate, formatSize } from "../../jobFormat";
import { JobTransportDocuments } from "../../JobTransportDocuments";
import { useJob } from "../../JobShell";
import styles from "../../jobs.module.css";

export default function JobDocumentsPage() {
  const { job, documents, isStaff, closedJob, run } = useJob();
  const typeKeys = documentTypesFor(useStaffAccess().roles);
  const [docType, setDocType] = useState<DocumentType>("other");
  const [docTarget, setDocTarget] = useState("");
  const [docFile, setDocFile] = useState<File | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [adding, setAdding] = useState(false);

  function download(documentId: string, versionNumber: number) {
    void run(async () => {
      const link = await getDownloadLink(job.id, documentId, versionNumber);
      window.open(link.url, "_blank", "noopener");
    });
  }

  return (
    <>
      <section className={styles.card} aria-labelledby="documents-title">
        <div className={styles.stepsHeading}>
          <h2 id="documents-title">Documents</h2>
          {isStaff && !adding && (
            <button
              className={styles.secondaryButton}
              onClick={() => setAdding(true)}
              type="button"
            >
              Upload document
            </button>
          )}
        </div>
        {documents.length === 0 ? (
          <p className={styles.muted}>No documents uploaded.</p>
        ) : (
          <ul className={styles.itemList}>
            {documents.map((document) => {
              const latest = document.versions[document.versions.length - 1];
              const earlier = document.versions.slice(0, -1).reverse();
              return (
                <li key={document.id}>
                  <div>
                    <span>{documentTypeLabels[document.documentType]}</span>
                    <strong>{latest.filename}</strong>
                    <small>
                      {document.versions.length > 1
                        ? `Version ${latest.versionNumber} · `
                        : ""}
                      {formatSize(latest.sizeBytes)} ·{" "}
                      {formatDate(latest.uploadedAt)}
                    </small>
                    {earlier.length > 0 && (
                      <details>
                        <summary className={styles.disclosureSummary}>
                          Earlier versions ({earlier.length})
                        </summary>
                        <ul className={styles.list}>
                          {earlier.map((version) => (
                            <li key={version.versionNumber}>
                              v{version.versionNumber} · {version.filename} ·{" "}
                              {formatDate(version.uploadedAt)}{" "}
                              <button
                                className={styles.textButton}
                                onClick={() =>
                                  download(document.id, version.versionNumber)
                                }
                                type="button"
                              >
                                Download
                              </button>
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </div>
                  <button
                    className={styles.textButton}
                    onClick={() => download(document.id, latest.versionNumber)}
                    type="button"
                  >
                    Download
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {isStaff && adding && (
          <form
            className={`${styles.form} ${styles.quickUpdateForm}`}
            onSubmit={(event: FormEvent) => {
              event.preventDefault();
              if (!docFile) return;
              const existing = documents.find(
                (document) => document.id === docTarget,
              );
              void run(
                () =>
                  uploadDocument(job.id, {
                    file: docFile,
                    documentType: existing?.documentType ?? docType,
                    documentId: existing?.id,
                  }),
                () => {
                  setDocFile(null);
                  setDocTarget("");
                  setFileInputKey((current) => current + 1);
                  setAdding(false);
                },
              );
            }}
          >
            <label className={styles.field}>
              Add as
              <select
                onChange={(event) => setDocTarget(event.target.value)}
                value={docTarget}
              >
                <option value="">A new document</option>
                {documents.map((document) => (
                  <option key={document.id} value={document.id}>
                    New version of {documentTypeLabels[document.documentType]} (
                    {document.versions[document.versions.length - 1].filename})
                  </option>
                ))}
              </select>
            </label>
            {!docTarget && (
              <label className={styles.field}>
                Document type
                <select
                  onChange={(event) =>
                    setDocType(event.target.value as DocumentType)
                  }
                  required
                  value={docType}
                >
                  {typeKeys.map((key) => (
                    <option key={key} value={key}>
                      {documentTypeLabels[key]}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className={styles.field}>
              File (PDF, PNG or JPEG, up to 25 MB)
              <input
                accept="application/pdf,image/png,image/jpeg"
                key={fileInputKey}
                onChange={(event) =>
                  setDocFile(event.target.files?.[0] ?? null)
                }
                required
                type="file"
              />
            </label>
            <div className={styles.formActions}>
              <button className={styles.button} type="submit">
                Upload
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

      <JobTransportDocuments
        canEdit={!closedJob}
        isStaff={isStaff}
        jobId={job.id}
        serviceLine={job.serviceLine}
      />
    </>
  );
}
