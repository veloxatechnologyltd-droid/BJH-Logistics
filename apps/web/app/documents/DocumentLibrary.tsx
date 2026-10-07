"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { documentTypeLabels } from "@bjh/contracts";
import type { DocumentType } from "@bjh/contracts";
import { useStaffAccess } from "../auth/useStaffAccess";
import { listCustomers } from "../customers/customerApi";
import type { CustomerCompany } from "../customers/customerApi";
import { listJobs } from "../jobs/jobApi";
import type { Job } from "../jobs/jobApi";
import { formatDate, formatSize } from "../jobs/jobFormat";
import styles from "../jobs/jobs.module.css";
import {
  getLibraryDownloadLink,
  searchDocuments,
  uploadLibraryDocument,
} from "./documentApi";
import type { LibraryDocument } from "./documentApi";
import { ErrorPopup } from "../ErrorPopup";

type Owner = "none" | "job" | "company";

const typeKeys = Object.keys(documentTypeLabels) as DocumentType[];

export function DocumentLibrary() {
  const { roles } = useStaffAccess();
  const isStaff = roles.length > 0;
  const [documents, setDocuments] = useState<LibraryDocument[]>([]);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<DocumentType | "">("");
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);

  const [adding, setAdding] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [docType, setDocType] = useState<DocumentType>("other");
  const [title, setTitle] = useState("");
  const [owner, setOwner] = useState<Owner>("none");
  const [jobId, setJobId] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [companies, setCompanies] = useState<CustomerCompany[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    setState("loading");
    // Wait a moment after typing so each keystroke does not start a request.
    const timer = setTimeout(() => {
      searchDocuments(search, typeFilter)
        .then((result) => {
          if (active) {
            setDocuments(result);
            setState("ready");
          }
        })
        .catch((cause: unknown) => {
          if (active) {
            setError(
              cause instanceof Error
                ? cause.message
                : "Documents are unavailable",
            );
            setState("error");
          }
        });
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [search, typeFilter, reload]);

  useEffect(() => {
    if (!adding || !isStaff) return;
    let active = true;
    Promise.all([listJobs(""), listCustomers("")])
      .then(([jobList, companyList]) => {
        if (!active) return;
        setJobs(jobList);
        setCompanies(companyList);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [adding, isStaff]);

  function download(documentId: string, versionNumber: number) {
    getLibraryDownloadLink(documentId, versionNumber)
      .then((link) => window.open(link.url, "_blank", "noopener"))
      .catch((cause: unknown) =>
        setError(
          cause instanceof Error ? cause.message : "Download is unavailable",
        ),
      );
  }

  function upload(event: FormEvent) {
    event.preventDefault();
    if (!file) return;
    setSaving(true);
    setError("");
    uploadLibraryDocument({
      file,
      documentType: docType,
      title,
      jobId: owner === "job" ? jobId : undefined,
      companyId: owner === "company" ? companyId : undefined,
    })
      .then(() => {
        setFile(null);
        setFileInputKey((current) => current + 1);
        setTitle("");
        setOwner("none");
        setJobId("");
        setCompanyId("");
        setAdding(false);
        setReload((current) => current + 1);
      })
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : "Upload failed"),
      )
      .finally(() => setSaving(false));
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Documents</h1>
        </div>
        {isStaff && !adding && (
          <button
            className={styles.button}
            onClick={() => setAdding(true)}
            type="button"
          >
            Upload document
          </button>
        )}
      </header>

      {isStaff && adding && (
        <form className={styles.form} onSubmit={upload}>
          <label className={styles.field}>
            File (PDF, PNG or JPEG, up to 25 MB)
            <input
              accept="application/pdf,image/png,image/jpeg"
              key={fileInputKey}
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              required
              type="file"
            />
          </label>
          <label className={styles.field}>
            Document type
            <select
              onChange={(event) =>
                setDocType(event.target.value as DocumentType)
              }
              value={docType}
            >
              {typeKeys.map((key) => (
                <option key={key} value={key}>
                  {documentTypeLabels[key]}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            Title (optional)
            <input
              maxLength={200}
              onChange={(event) => setTitle(event.target.value)}
              value={title}
            />
          </label>
          <label className={styles.field}>
            Belongs to
            <select
              onChange={(event) => setOwner(event.target.value as Owner)}
              value={owner}
            >
              <option value="none">Nothing: an office document</option>
              <option value="job">A job file</option>
              <option value="company">A customer company</option>
            </select>
          </label>
          {owner === "job" && (
            <label className={styles.field}>
              Job file
              <select
                onChange={(event) => setJobId(event.target.value)}
                required
                value={jobId}
              >
                <option value="">Choose a job</option>
                {jobs.map((job) => (
                  <option key={job.id} value={job.id}>
                    {job.fileNumber} · {job.customerCompanyName}
                  </option>
                ))}
              </select>
            </label>
          )}
          {owner === "company" && (
            <label className={styles.field}>
              Customer company (can read it in their portal)
              <select
                onChange={(event) => setCompanyId(event.target.value)}
                required
                value={companyId}
              >
                <option value="">Choose a company</option>
                {companies.map((company) => (
                  <option key={company.id} value={company.id}>
                    {company.companyName}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className={styles.formActions}>
            <button className={styles.button} disabled={saving} type="submit">
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

      <div className={styles.toolbar}>
        <input
          aria-label="Search documents"
          autoComplete="off"
          className={styles.searchInput}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search by name, file number, customer, B/L or container number, date…"
          type="search"
          value={search}
        />
        <select
          aria-label="Document type"
          onChange={(event) =>
            setTypeFilter(event.target.value as DocumentType | "")
          }
          value={typeFilter}
        >
          <option value="">All types</option>
          {typeKeys.map((key) => (
            <option key={key} value={key}>
              {documentTypeLabels[key]}
            </option>
          ))}
        </select>
      </div>

      {state === "loading" && <p role="status">Loading documents…</p>}
      <ErrorPopup message={error} />
      {state === "ready" && documents.length === 0 && (
        <p className={styles.muted}>
          {search || typeFilter ? "No documents match." : "No documents yet."}
        </p>
      )}
      {state === "ready" && documents.length > 0 && (
        <ul className={styles.itemList}>
          {documents.map((document) => (
            <li key={document.id}>
              <div>
                <span>{documentTypeLabels[document.documentType]}</span>
                <strong>{document.title ?? document.latest.filename}</strong>
                <small>
                  {document.title ? `${document.latest.filename} · ` : ""}
                  {document.versionCount > 1
                    ? `Version ${document.latest.versionNumber} · `
                    : ""}
                  {formatSize(document.latest.sizeBytes)} ·{" "}
                  {formatDate(document.latest.uploadedAt)}
                </small>
                {(document.fileNumber || document.companyName) && (
                  <small>
                    {document.jobId && document.fileNumber ? (
                      <Link href={`/jobs/${document.jobId}/documents`}>
                        {document.fileNumber}
                      </Link>
                    ) : null}
                    {document.fileNumber && document.companyName ? " · " : ""}
                    {document.companyName}
                  </small>
                )}
              </div>
              <button
                className={styles.textButton}
                onClick={() =>
                  download(document.id, document.latest.versionNumber)
                }
                type="button"
              >
                Download
              </button>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
