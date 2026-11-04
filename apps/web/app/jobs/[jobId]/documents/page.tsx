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
  const [docFiles, setDocFiles] = useState<File[]>([]);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [adding, setAdding] = useState(false);
  const [uploadNote, setUploadNote] = useState("");

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
              if (docFiles.length === 0) return;
              const existing = documents.find(
                (document) => document.id === docTarget,
              );
              const files = docFiles;
              const clear = () => {
                setDocFiles([]);
                setDocTarget("");
                setFileInputKey((current) => current + 1);
              };
              // One file at a time: each becomes its own document of the
              // chosen type, and one bad file does not stop the others.
              const failed: string[] = [];
              setUploadNote("");
              void run(
                async () => {
                  for (const file of files) {
                    try {
                      await uploadDocument(job.id, {
                        file,
                        documentType: existing?.documentType ?? docType,
                        documentId: existing?.id,
                      });
                    } catch (cause) {
                      failed.push(
                        `${file.name} (${cause instanceof Error ? cause.message : "failed"})`,
                      );
                    }
                  }
                  clear();
                },
                () => {
                  if (failed.length === 0) {
                    setAdding(false);
                    return;
                  }
                  setUploadNote(
                    `Uploaded ${files.length - failed.length} of ${files.length}. Not uploaded: ${failed.join("; ")}. Pick those files again to retry.`,
                  );
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
              {docTarget
                ? "File (PDF, PNG or JPEG, up to 25 MB)"
                : "Files (PDF, PNG or JPEG, up to 25 MB each; pick several at once if needed)"}
              <input
                accept="application/pdf,image/png,image/jpeg"
                key={fileInputKey}
                multiple={!docTarget}
                onChange={(event) =>
                  setDocFiles(Array.from(event.target.files ?? []))
                }
                required
                type="file"
              />
            </label>
            {uploadNote && (
              <p className={styles.muted} role="alert">
                {uploadNote}
              </p>
            )}
            <div className={styles.formActions}>
              <button className={styles.button} type="submit">
                {docFiles.length > 1
                  ? `Upload ${docFiles.length} files`
                  : "Upload"}
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
