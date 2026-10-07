"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import type { ReactNode } from "react";
import { useStaffAccess } from "../auth/useStaffAccess";
import {
  getStatusHistory,
  getTimeline,
  listDocuments,
  listParties,
  listReferences,
  serviceLineLabels,
  statusLabels,
} from "./jobApi";
import type {
  Job,
  JobDocument,
  Party,
  Reference,
  StatusHistory,
  Timeline,
} from "./jobApi";
import { formatDate } from "./jobFormat";
import styles from "./jobs.module.css";
import { ErrorPopup, plainMessage } from "../ErrorPopup";

type JobContextValue = {
  job: Job;
  timeline: Timeline;
  status: StatusHistory;
  parties: Party[];
  references: Reference[];
  documents: JobDocument[];
  isStaff: boolean;
  closedJob: boolean;
  reload: () => Promise<void>;
  run: (action: () => Promise<unknown>, after?: () => void) => Promise<void>;
};

const JobContext = createContext<JobContextValue | null>(null);

export function useJob(): JobContextValue {
  const value = useContext(JobContext);
  if (!value) throw new Error("useJob must be used inside JobShell");
  return value;
}

type Tab = { slug: string; label: string; staffOnly?: boolean };

const tabs: Tab[] = [
  { slug: "", label: "Overview" },
  { slug: "shipment", label: "Shipment details" },
  { slug: "documents", label: "Documents" },
  { slug: "delivery", label: "Delivery" },
  { slug: "money", label: "Costs & invoices" },
  { slug: "tasks", label: "Tasks", staffOnly: true },
  { slug: "messages", label: "Messages", staffOnly: true },
];

export function JobShell({
  jobId,
  children,
}: {
  jobId: string;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const { roles } = useStaffAccess();
  const isStaff = roles.length > 0;
  const [data, setData] = useState<{
    timeline: Timeline;
    status: StatusHistory;
    parties: Party[];
    references: Reference[];
    documents: JobDocument[];
  } | null>(null);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const [timeline, status, parties, references, documents] =
        await Promise.all([
          getTimeline(jobId),
          getStatusHistory(jobId),
          listParties(jobId),
          listReferences(jobId),
          listDocuments(jobId),
        ]);
      setData({ timeline, status, parties, references, documents });
      setLoadError("");
    } catch (cause) {
      setLoadError(
        cause instanceof Error ? cause.message : "The job could not be loaded",
      );
    }
  }, [jobId]);

  useEffect(() => {
    void load();
  }, [load, pathname]);

  const run = useCallback(
    async (action: () => Promise<unknown>, after?: () => void) => {
      setError("");
      try {
        await action();
        after?.();
        await load();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "The action failed");
      }
    },
    [load],
  );

  if (loadError) {
    return (
      <main className={styles.page}>
        <Link className={styles.link} href="/jobs">
          ← Jobs
        </Link>
        <ErrorPopup message={loadError} />
        <p className={styles.error}>{plainMessage(loadError)}</p>
      </main>
    );
  }
  if (!data) {
    return (
      <main className={styles.page}>
        <p role="status">Loading job…</p>
      </main>
    );
  }

  const { job } = data.timeline;
  const closedJob = job.status === "closed" || job.status === "cancelled";
  const base = `/jobs/${jobId}`;
  const visibleTabs = tabs
    .filter((tab) => isStaff || !tab.staffOnly)
    .map((tab) =>
      tab.slug === "money" && !isStaff ? { ...tab, label: "Invoices" } : tab,
    );

  return (
    <JobContext.Provider
      value={{
        job,
        ...data,
        isStaff,
        closedJob,
        reload: load,
        run,
      }}
    >
      <main className={styles.page}>
        <Link className={styles.link} href="/jobs">
          ← All jobs
        </Link>
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>
              {serviceLineLabels[job.serviceLine].toUpperCase()}
            </p>
            <h1 className={styles.title}>{job.fileNumber}</h1>
            <p className={styles.muted}>
              {job.customerCompanyName} · opened {formatDate(job.openedAt)}
            </p>
          </div>
          <span className={styles.badge}>{statusLabels[job.status]}</span>
        </header>

        <nav className={styles.tabs} aria-label="Job sections">
          {visibleTabs.map((tab) => {
            const href = tab.slug ? `${base}/${tab.slug}` : base;
            const active = tab.slug
              ? pathname.startsWith(href)
              : pathname === base;
            return (
              <Link
                aria-current={active ? "page" : undefined}
                className={`${styles.tab}${active ? ` ${styles.tabActive}` : ""}`}
                href={href}
                key={tab.slug}
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>

        <ErrorPopup message={error} />

        {children}
      </main>
    </JobContext.Provider>
  );
}
