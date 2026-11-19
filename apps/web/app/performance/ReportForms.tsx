"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { ReferenceKind } from "@bjh/contracts";
import { listJobs, listReferences } from "../jobs/jobApi";
import type { Job } from "../jobs/jobApi";
import { listTeamPeople } from "../team-chat/teamChatApi";
import type { TeamPerson } from "../team-chat/teamChatApi";
import {
  departmentLabels,
  departmentMeasures,
  jobUpdateStatusLabels,
  submitReport,
} from "./performanceApi";
import type {
  Department,
  JobUpdateInput,
  JobUpdateStatus,
  ReportPreview,
  TeamKey,
} from "./performanceApi";
import styles from "../jobs/jobs.module.css";
import own from "./performance.module.css";

const referenceLabels: Partial<Record<ReferenceKind, string>> = {
  master_bl: "BL",
  house_bl: "House BL",
  master_awb: "AWB",
  house_awb: "House AWB",
  container: "Container",
};

/** "2026-11-20" → "20/11/2026", as the client writes dates. */
const slashDate = (isoDay: string) => isoDay.split("-").reverse().join("/");

type Draft = Omit<JobUpdateInput, "status"> & {
  key: number;
  status: JobUpdateStatus | "";
};

let nextKey = 1;
const emptyDraft = (me: string | null): Draft => ({
  key: nextKey++,
  jobId: null,
  client: "",
  workDone: "",
  agreedDeadline: "",
  nextAction: "",
  nextActionUserId: me,
  followUpDate: "",
  evidence: "",
  status: "",
});

/** Empty text is sent as nothing, so the API stores no value. */
const text = (value: string | null) => value?.trim() || undefined;

function DepartmentField({
  value,
  onChange,
}: {
  value: Department;
  onChange: (value: Department) => void;
}) {
  return (
    <label className={styles.field}>
      Department
      <select
        onChange={(event) => onChange(event.target.value as Department)}
        required
        value={value}
      >
        {(Object.keys(departmentLabels) as Department[]).map((key) => (
          <option key={key} value={key}>
            {departmentLabels[key]}
          </option>
        ))}
      </select>
    </label>
  );
}

function PersonField({
  people,
  value,
  onChange,
}: {
  people: TeamPerson[];
  value: string | null;
  onChange: (value: string | null) => void;
}) {
  return (
    <label className={styles.field}>
      Responsible person
      <select
        onChange={(event) => onChange(event.target.value || null)}
        value={value ?? ""}
      >
        <option value="">Not named</option>
        {people.map((person) => (
          <option key={person.userId} value={person.userId}>
            {person.you ? `${person.name} (you)` : person.name}
          </option>
        ))}
      </select>
    </label>
  );
}

/** One job update: pick the job and most of the rest fills itself in. */
function JobUpdateCard({
  draft,
  index,
  jobs,
  people,
  removable,
  onChange,
  onRemove,
}: {
  draft: Draft;
  index: number;
  jobs: Job[];
  people: TeamPerson[];
  removable: boolean;
  onChange: (patch: Partial<Draft>) => void;
  onRemove: () => void;
}) {
  async function pickJob(jobId: string) {
    const job = jobs.find((item) => item.id === jobId);
    if (!job) {
      onChange({ jobId: null, client: "", agreedDeadline: "" });
      return;
    }
    onChange({
      jobId,
      client: job.customerCompanyName,
      agreedDeadline: job.expectedCompletionDate
        ? slashDate(job.expectedCompletionDate)
        : "",
    });
    // Add the BL, AWB or container numbers the job already has.
    const references = await listReferences(jobId).catch(() => []);
    const shown = references
      .filter((reference) => referenceLabels[reference.kind])
      .map(
        (reference) => `${referenceLabels[reference.kind]} ${reference.value}`,
      );
    if (shown.length > 0) {
      onChange({
        client: `${job.customerCompanyName} · ${shown.join(", ")}`,
      });
    }
  }

  return (
    <fieldset className={own.jobCard}>
      <legend>Job update {index + 1}</legend>
      {removable && (
        <button className={own.linkButton} onClick={onRemove} type="button">
          Remove
        </button>
      )}
      <label className={styles.field}>
        Job
        <select
          onChange={(event) => void pickJob(event.target.value)}
          value={draft.jobId ?? ""}
        >
          <option value="">Not a job yet (prospect or other work)</option>
          {jobs.map((job) => (
            <option key={job.id} value={job.id}>
              {job.fileNumber} · {job.customerCompanyName}
            </option>
          ))}
        </select>
      </label>
      <label className={styles.field}>
        Client / prospect and shipment reference (BL, AWB or container)
        <input
          maxLength={500}
          onChange={(event) => onChange({ client: event.target.value })}
          required={!draft.jobId}
          value={draft.client ?? ""}
        />
      </label>
      <label className={styles.field}>
        Work completed / latest update
        <textarea
          maxLength={4000}
          onChange={(event) => onChange({ workDone: event.target.value })}
          required
          rows={3}
          value={draft.workDone}
        />
      </label>
      <fieldset className={own.statusChoice}>
        <legend>Job status</legend>
        {(Object.keys(jobUpdateStatusLabels) as JobUpdateStatus[]).map(
          (status) => (
            <label key={status}>
              <input
                checked={draft.status === status}
                name={`status-${draft.key}`}
                onChange={() => onChange({ status })}
                required
                type="radio"
              />
              {jobUpdateStatusLabels[status]}
            </label>
          ),
        )}
      </fieldset>
      <label className={styles.field}>
        Next action
        <textarea
          maxLength={2000}
          onChange={(event) => onChange({ nextAction: event.target.value })}
          placeholder="Write None if nothing is left"
          required
          rows={2}
          value={draft.nextAction}
        />
      </label>
      <div className={own.pair}>
        <PersonField
          onChange={(nextActionUserId) => onChange({ nextActionUserId })}
          people={people}
          value={draft.nextActionUserId}
        />
        <label className={styles.field}>
          Follow-up date
          <input
            onChange={(event) => onChange({ followUpDate: event.target.value })}
            type="date"
            value={draft.followUpDate ?? ""}
          />
        </label>
      </div>
      <details className={own.more}>
        <summary>Deadline and evidence (optional)</summary>
        <label className={styles.field}>
          Agreed completion deadline
          <input
            maxLength={100}
            onChange={(event) =>
              onChange({ agreedDeadline: event.target.value })
            }
            placeholder="DD/MM/YYYY and time"
            value={draft.agreedDeadline ?? ""}
          />
        </label>
        <label className={styles.field}>
          Evidence / handover reference
          <input
            maxLength={1000}
            onChange={(event) => onChange({ evidence: event.target.value })}
            placeholder="Receipt, release, POD or approved document"
            value={draft.evidence ?? ""}
          />
        </label>
      </details>
    </fieldset>
  );
}

/**
 * The written part of a report, following the client's tracker form. Daily:
 * one or several job updates, as the person chooses. Weekly: a summary, the
 * workload (counted for them) and their own department's figure.
 */
export function WriteReport({
  preview,
  team,
  onSent,
  onError,
}: {
  preview: ReportPreview;
  team: TeamKey | "";
  onSent: () => void;
  onError: (message: string) => void;
}) {
  const daily = preview.period === "daily";
  const [department, setDepartment] = useState<Department>(preview.department);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [people, setPeople] = useState<TeamPerson[]>([]);
  const [several, setSeveral] = useState<boolean | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([emptyDraft(null)]);
  const [summary, setSummary] = useState("");
  const [kpiTarget, setKpiTarget] = useState("");
  const [kpiActual, setKpiActual] = useState("");
  const [kpiAction, setKpiAction] = useState("");
  const [plan, setPlan] = useState("");
  const [blockers, setBlockers] = useState("");
  const [sending, setSending] = useState(false);
  const me = people.find((person) => person.you)?.userId ?? null;

  useEffect(() => {
    // Open jobs and jobs closed in the last two weeks, newest first.
    const since = new Date(Date.now() - 14 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    if (daily) {
      listJobs("", { closedSince: since })
        .then(setJobs)
        .catch(() => setJobs([]));
    }
    listTeamPeople()
      .then((result) => {
        setPeople(result);
        const you = result.find((person) => person.you)?.userId ?? null;
        // The person sending is responsible until they name someone else.
        setDrafts((current) =>
          current.map((draft) =>
            draft.nextActionUserId
              ? draft
              : { ...draft, nextActionUserId: you },
          ),
        );
      })
      .catch(() => setPeople([]));
  }, [daily]);

  const update = (key: number, patch: Partial<Draft>) =>
    setDrafts((current) =>
      current.map((draft) =>
        draft.key === key ? { ...draft, ...patch } : draft,
      ),
    );

  async function send(event: FormEvent) {
    event.preventDefault();
    onError("");
    setSending(true);
    try {
      await submitReport({
        period: preview.period,
        teamKey: team || undefined,
        department,
        blockers: text(blockers),
        ...(daily
          ? {
              jobUpdates: drafts.map((draft) => ({
                jobId: draft.jobId,
                client: text(draft.client) ?? null,
                workDone: draft.workDone.trim(),
                agreedDeadline: text(draft.agreedDeadline) ?? null,
                nextAction: draft.nextAction.trim(),
                nextActionUserId: draft.nextActionUserId,
                followUpDate: draft.followUpDate || null,
                evidence: text(draft.evidence) ?? null,
                status: draft.status as JobUpdateStatus,
              })),
            }
          : {
              summary: summary.trim(),
              kpiTarget: kpiTarget.trim(),
              kpiActual: kpiActual.trim(),
              kpiAction: kpiAction.trim(),
              plan: plan.trim(),
            }),
      });
      onSent();
    } catch (cause) {
      onError(
        cause instanceof Error ? cause.message : "The report was not sent",
      );
    } finally {
      setSending(false);
    }
  }

  // Daily: first, one job or several.
  if (daily && several === null) {
    return (
      <section className={own.screen}>
        <h1 className={styles.title}>What are you reporting?</h1>
        <div className={own.choices}>
          <button
            className={own.choice}
            onClick={() => {
              setDrafts([emptyDraft(me)]);
              setSeveral(false);
            }}
            type="button"
          >
            <strong>One job update</strong>
            <span>An update on a single job or client.</span>
          </button>
          <button
            className={own.choice}
            onClick={() => {
              setDrafts([emptyDraft(me), emptyDraft(me)]);
              setSeveral(true);
            }}
            type="button"
          >
            <strong>Several jobs</strong>
            <span>Updates on every job you worked on today, in one go.</span>
          </button>
        </div>
      </section>
    );
  }

  return (
    <form className={own.screen} onSubmit={(event) => void send(event)}>
      <h1 className={styles.title}>
        {daily ? "Daily job update" : "Weekly performance review"}
      </h1>
      <DepartmentField onChange={setDepartment} value={department} />

      {daily ? (
        <>
          {drafts.map((draft, index) => (
            <JobUpdateCard
              draft={draft}
              index={index}
              jobs={jobs}
              key={draft.key}
              onChange={(patch) => update(draft.key, patch)}
              onRemove={() =>
                setDrafts((current) =>
                  current.filter((item) => item.key !== draft.key),
                )
              }
              people={people}
              removable={several === true && drafts.length > 1}
            />
          ))}
          {several && drafts.length < 20 && (
            <button
              className={styles.secondaryButton}
              onClick={() =>
                setDrafts((current) => [...current, emptyDraft(me)])
              }
              type="button"
            >
              Add another job
            </button>
          )}
        </>
      ) : (
        <>
          <section>
            <h2 className={own.formHeading}>Workload this week</h2>
            <p className={styles.muted}>
              Counted from your tasks; you do not type these.
            </p>
            <dl className={own.counts}>
              {(
                [
                  ["Opening active", preview.openingActive],
                  ["New", preview.newCount],
                  ["Completed", preview.completedCount],
                  ["Closing active", preview.closingActive],
                  ["Overdue", preview.overdueCount],
                ] as const
              ).map(([label, value]) => (
                <div className={own.count} key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          </section>
          <label className={styles.field}>
            Progress this week
            <textarea
              maxLength={4000}
              onChange={(event) => setSummary(event.target.value)}
              placeholder="What you completed, what moved forward, what slipped…"
              required
              rows={5}
              value={summary}
            />
          </label>
          <section>
            <h2 className={own.formHeading}>
              {departmentLabels[department]} figure
            </h2>
            <p className={styles.muted}>{departmentMeasures[department]}</p>
            <div className={own.kpi}>
              <label className={styles.field}>
                Target
                <input
                  maxLength={1000}
                  onChange={(event) => setKpiTarget(event.target.value)}
                  required
                  value={kpiTarget}
                />
              </label>
              <label className={styles.field}>
                Actual
                <input
                  maxLength={1000}
                  onChange={(event) => setKpiActual(event.target.value)}
                  required
                  value={kpiActual}
                />
              </label>
              <label className={styles.field}>
                Action
                <input
                  maxLength={1000}
                  onChange={(event) => setKpiAction(event.target.value)}
                  required
                  value={kpiAction}
                />
              </label>
            </div>
          </section>
          <label className={styles.field}>
            Next action, responsible person and follow-up deadline
            <textarea
              maxLength={2000}
              onChange={(event) => setPlan(event.target.value)}
              required
              rows={3}
              value={plan}
            />
          </label>
        </>
      )}

      <label className={styles.field}>
        Blockers / support needed / person escalated to (leave empty if none)
        <textarea
          maxLength={2000}
          onChange={(event) => setBlockers(event.target.value)}
          rows={3}
          value={blockers}
        />
      </label>
      <p className={styles.muted}>
        Your system report ({preview.activity.items.length} things recorded) is
        attached automatically.
      </p>
      <div className={styles.formActions}>
        <button className={styles.button} disabled={sending} type="submit">
          {sending ? "Sending…" : "Send report"}
        </button>
      </div>
    </form>
  );
}
