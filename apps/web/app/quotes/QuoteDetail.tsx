"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { quoteBasisLabels } from "@bjh/contracts";
import { useStaffAccess } from "../auth/useStaffAccess";
import { serviceLineLabels } from "../jobs/jobApi";
import styles from "../jobs/jobs.module.css";
import { QuoteEditor } from "./QuoteEditor";
import {
  fetchQuotePdf,
  formatMoney,
  getQuote,
  issueQuote,
  recordQuoteDecision,
  respondToQuote,
  startQuoteVersion,
} from "./quoteApi";
import type { Quote, QuoteLine, QuoteVersion } from "./quoteApi";
import { ErrorPopup, plainMessage } from "../ErrorPopup";

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function amountText(line: QuoteLine, minor: number | null, currency: string) {
  if (minor === null) return line.basis === "at_cost" ? "At cost" : "—";
  const money = formatMoney(minor, currency);
  return line.basis === "at_cost" ? `At cost · ${money}` : money;
}

/** One version laid out like the printed quotation: tables grouped by heading. */
function VersionView({ version }: { version: QuoteVersion }) {
  const sections: Array<{ heading: string; lines: QuoteLine[] }> = [];
  for (const line of version.lines) {
    const heading = line.section ?? "Charges";
    const current = sections[sections.length - 1];
    if (current && current.heading === heading) current.lines.push(line);
    else sections.push({ heading, lines: [line] });
  }
  const hasWording =
    version.procedureSteps.length > 0 ||
    version.requiredDocuments.length > 0 ||
    Boolean(version.timeline) ||
    version.terms.length > 0;
  return (
    <div>
      <h3>{version.title}</h3>
      {version.subtitle && <p className={styles.muted}>{version.subtitle}</p>}
      {version.shipmentScope && <p>Shipment: {version.shipmentScope}</p>}
      {version.intro && <p>{version.intro}</p>}
      {sections.map((section) => {
        const sized = section.lines.some(
          (line) => line.sizeAmountsMinor !== null,
        );
        const hasSingleAmount = section.lines.some(
          (line) => line.sizeAmountsMinor === null && line.amountMinor !== null,
        );
        return (
          <div className={styles.tableScroll} key={section.heading}>
            <table className={styles.table}>
              <caption>{section.heading}</caption>
              <thead>
                <tr>
                  <th scope="col">Charge</th>
                  {sized ? (
                    version.sizeLabels.map((label) => (
                      <th key={label} scope="col">
                        {label}
                      </th>
                    ))
                  ) : (
                    <th scope="col">Amount</th>
                  )}
                  {sized && hasSingleAmount && <th scope="col">Amount</th>}
                  <th scope="col">Basis</th>
                </tr>
              </thead>
              <tbody>
                {section.lines.map((line) => (
                  <tr key={line.id}>
                    <th scope="row">
                      {line.description}
                      {line.details && (
                        <>
                          <br />
                          <span className={styles.muted}>{line.details}</span>
                        </>
                      )}
                    </th>
                    {sized ? (
                      <>
                        {version.sizeLabels.map((_, index) => (
                          <td key={`${line.id}-${index}`}>
                            {amountText(
                              line,
                              line.sizeAmountsMinor?.[index] ?? null,
                              version.currency,
                            )}
                          </td>
                        ))}
                        {hasSingleAmount && (
                          <td>
                            {line.sizeAmountsMinor === null
                              ? amountText(
                                  line,
                                  line.amountMinor,
                                  version.currency,
                                )
                              : "—"}
                          </td>
                        )}
                      </>
                    ) : (
                      <td>
                        {amountText(line, line.amountMinor, version.currency)}
                      </td>
                    )}
                    <td>
                      {line.basis === "at_cost" && line.basisNote
                        ? line.basisNote
                        : `${quoteBasisLabels[line.basis]}${
                            line.basisNote ? ` · ${line.basisNote}` : ""
                          }`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
      <p className={styles.muted}>
        All amounts are in {version.currency} unless otherwise stated.
      </p>
      {version.atCostNote && <p>{version.atCostNote}</p>}
      {hasWording && (
        <details>
          <summary className={styles.disclosureSummary}>
            Standard wording
          </summary>
          <div className={styles.disclosureContent}>
            {version.procedureSteps.length > 0 && (
              <>
                <h4>Procedure</h4>
                <ol className={styles.list}>
                  {version.procedureSteps.map((step, index) => (
                    <li key={index}>{step}</li>
                  ))}
                </ol>
              </>
            )}
            {version.requiredDocuments.length > 0 && (
              <>
                <h4>Documents required</h4>
                <ul className={styles.list}>
                  {version.requiredDocuments.map((item, index) => (
                    <li key={index}>{item}</li>
                  ))}
                </ul>
                {version.documentsNote && <p>{version.documentsNote}</p>}
              </>
            )}
            {version.timeline && (
              <>
                <h4>Timeline</h4>
                <p>{version.timeline}</p>
              </>
            )}
            {version.terms.length > 0 && (
              <>
                <h4>Important terms</h4>
                <ul className={styles.list}>
                  {version.terms.map((item, index) => (
                    <li key={index}>{item}</li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </details>
      )}
    </div>
  );
}

export function QuoteDetail({ quoteId }: { quoteId: string }) {
  const { roles } = useStaffAccess();
  const isStaff = roles.length > 0;
  const [quote, setQuote] = useState<Quote | null>(null);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [deciding, setDeciding] = useState(false);
  const [decision, setDecision] = useState<"accepted" | "rejected">("accepted");
  const [signatory, setSignatory] = useState("");
  const [decidedAt, setDecidedAt] = useState("");
  const [decisionNote, setDecisionNote] = useState("");
  const [openedJob, setOpenedJob] = useState<{
    id: string;
    fileNumber: string;
  } | null>(null);

  const load = useCallback(async () => {
    try {
      setQuote(await getQuote(quoteId));
      setLoadError("");
    } catch (cause) {
      setLoadError(
        cause instanceof Error
          ? cause.message
          : "The quote could not be loaded",
      );
    }
  }, [quoteId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(action: () => Promise<Quote>) {
    setError("");
    try {
      setQuote(await action());
      setEditing(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The action failed");
    }
  }

  async function openPdf(versionNumber: number) {
    // Opened first so the browser treats it as a click, not a pop-up.
    const tab = window.open("", "_blank");
    setError("");
    try {
      const blob = await fetchQuotePdf(quoteId, versionNumber);
      const url = URL.createObjectURL(blob);
      if (tab) tab.location.href = url;
      else window.location.href = url;
    } catch (cause) {
      tab?.close();
      setError(cause instanceof Error ? cause.message : "The PDF failed");
    }
  }

  async function submitDecision(event: FormEvent) {
    event.preventDefault();
    if (!quote) return;
    const latest = quote.versions
      .filter((version) => version.status === "issued")
      .at(-1);
    if (!latest) return;
    setError("");
    try {
      const result = isStaff
        ? await recordQuoteDecision(quote.id, {
            versionNumber: latest.versionNumber,
            decision,
            clientSignatory: signatory.trim(),
            decidedAt: decidedAt
              ? new Date(decidedAt).toISOString()
              : undefined,
            note: decisionNote.trim() || undefined,
          })
        : await respondToQuote(quote.id, {
            versionNumber: latest.versionNumber,
            decision,
            clientSignatory: signatory.trim(),
            note: decisionNote.trim() || undefined,
          });
      setOpenedJob(result.job);
      setDeciding(false);
      setSignatory("");
      setDecidedAt("");
      setDecisionNote("");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The action failed");
    }
  }

  if (loadError) {
    return (
      <main className={styles.page}>
        <Link className={styles.link} href="/quotes">
          ← Quotes
        </Link>
        <ErrorPopup message={loadError} />
        <p className={styles.error}>{plainMessage(loadError)}</p>
      </main>
    );
  }
  if (!quote) {
    return (
      <main className={styles.page}>
        <p role="status">Loading quote…</p>
      </main>
    );
  }

  const draft = quote.versions.find((version) => version.status === "draft");
  const issued = quote.versions.filter(
    (version) => version.status === "issued",
  );
  const accepted = quote.decisions.some((item) => item.decision === "accepted");
  const latestIssued = issued.at(-1);
  const latestDecision = latestIssued
    ? quote.decisions.find(
        (item) => item.versionNumber === latestIssued.versionNumber,
      )
    : undefined;
  const current = draft ?? latestIssued;
  const earlier = issued.filter((version) => version !== current).reverse();

  let statusText = "Draft";
  if (!draft && latestIssued) {
    statusText = latestDecision
      ? `${latestDecision.decision === "accepted" ? "Accepted" : "Rejected"} by ${
          latestDecision.clientSignatory
        } · ${formatDate(latestDecision.decidedAt)}`
      : "Issued · waiting for the client's answer";
  }

  return (
    <main className={styles.page}>
      <Link className={styles.link} href="/quotes">
        ← Quotes
      </Link>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>
            {quote.quoteNumber ?? "Draft (not numbered)"}
          </h1>
          <p className={styles.muted}>
            {quote.customerCompanyName} · {serviceLineLabels[quote.serviceLine]}
          </p>
          <span className={styles.badge}>{statusText}</span>
        </div>
        <div className={styles.actions}>
          {current && !editing && (
            <button
              className={styles.secondaryButton}
              onClick={() => void openPdf(current.versionNumber)}
              type="button"
            >
              {current.status === "draft" ? "PDF (draft)" : "PDF"}
            </button>
          )}
          {isStaff && draft && (
            <>
              <button
                className={styles.secondaryButton}
                onClick={() => setEditing((value) => !value)}
                type="button"
              >
                {editing ? "Cancel editing" : "Edit"}
              </button>
              {!editing && (
                <button
                  className={styles.button}
                  onClick={() => void run(() => issueQuote(quote.id))}
                  type="button"
                >
                  Issue to customer
                </button>
              )}
            </>
          )}
          {isStaff && !draft && !accepted && (
            <button
              className={
                latestDecision ? styles.button : styles.secondaryButton
              }
              onClick={() => void run(() => startQuoteVersion(quote.id))}
              type="button"
            >
              New version
            </button>
          )}
          {isStaff && !draft && latestIssued && !latestDecision && (
            <button
              className={styles.button}
              onClick={() => setDeciding((value) => !value)}
              type="button"
            >
              Record decision
            </button>
          )}
          {quote.jobId && (
            <Link className={styles.primaryLink} href={`/jobs/${quote.jobId}`}>
              Open job{openedJob ? ` ${openedJob.fileNumber}` : ""}
            </Link>
          )}
        </div>
      </header>

      <ErrorPopup message={error} />

      {isStaff && deciding && latestIssued && !latestDecision && (
        <section className={styles.card} aria-labelledby="decision-title">
          <h2 id="decision-title">
            Client&apos;s decision on version {latestIssued.versionNumber}
          </h2>
          <form
            className={`${styles.form} ${styles.quickUpdateForm}`}
            onSubmit={(event) => void submitDecision(event)}
          >
            <label className={styles.field}>
              Decision
              <select
                onChange={(event) =>
                  setDecision(event.target.value as "accepted" | "rejected")
                }
                value={decision}
              >
                <option value="accepted">Accepted (opens the job)</option>
                <option value="rejected">Rejected</option>
              </select>
            </label>
            <label className={styles.field}>
              Signed by
              <input
                onChange={(event) => setSignatory(event.target.value)}
                required
                value={signatory}
              />
            </label>
            <label className={styles.field}>
              Date (optional)
              <input
                onChange={(event) => setDecidedAt(event.target.value)}
                type="datetime-local"
                value={decidedAt}
              />
            </label>
            <label className={styles.field}>
              Note (optional)
              <input
                onChange={(event) => setDecisionNote(event.target.value)}
                value={decisionNote}
              />
            </label>
            <div className={styles.actions} style={{ gridColumn: "1 / -1" }}>
              <button className={styles.button} type="submit">
                Save decision
              </button>
              <button
                className={styles.secondaryButton}
                onClick={() => setDeciding(false)}
                type="button"
              >
                Cancel
              </button>
            </div>
          </form>
        </section>
      )}

      {!isStaff && latestIssued && !latestDecision && (
        <section className={styles.card} aria-labelledby="respond-title">
          <h2 id="respond-title">
            Your answer on quotation version {latestIssued.versionNumber}
          </h2>
          <p className={styles.muted}>
            Accepting confirms this version of the quotation and BJH will open
            your job. If you want a change, decline it and tell us what to
            change in the note.
          </p>
          <form
            className={styles.form}
            onSubmit={(event) => void submitDecision(event)}
          >
            <label className={styles.field}>
              Your answer
              <select
                onChange={(event) =>
                  setDecision(event.target.value as "accepted" | "rejected")
                }
                value={decision}
              >
                <option value="accepted">Accept this quotation</option>
                <option value="rejected">Decline this quotation</option>
              </select>
            </label>
            <label className={styles.field}>
              Your full name
              <input
                onChange={(event) => setSignatory(event.target.value)}
                required
                value={signatory}
              />
            </label>
            <label className={styles.field}>
              Note (optional)
              <input
                onChange={(event) => setDecisionNote(event.target.value)}
                value={decisionNote}
              />
            </label>
            <button className={styles.button} type="submit">
              Send my answer
            </button>
          </form>
        </section>
      )}

      {editing && draft ? (
        <QuoteEditor
          draft={draft}
          onSaved={(saved) => {
            setQuote(saved);
            setEditing(false);
          }}
          quote={quote}
        />
      ) : (
        current &&
        (current.status === "issued" || isStaff) && (
          <section className={styles.card} aria-labelledby="current-title">
            <h2 id="current-title">
              Version {current.versionNumber}
              {current.issuedAt
                ? ` · issued ${formatDate(current.issuedAt)}`
                : ""}
            </h2>
            <VersionView version={current} />
          </section>
        )
      )}

      {(quote.decisions.length > 0 || earlier.length > 0) && (
        <details className={styles.card}>
          <summary className={styles.disclosureSummary}>History</summary>
          <div className={styles.disclosureContent}>
            {quote.decisions.length > 0 && (
              <>
                <h2>Decisions</h2>
                <ul className={styles.list}>
                  {quote.decisions.map((item) => (
                    <li key={item.id}>
                      Version {item.versionNumber} ·{" "}
                      {item.decision === "accepted" ? "Accepted" : "Rejected"}{" "}
                      by {item.clientSignatory} · {formatDate(item.decidedAt)}
                      {item.note ? ` — ${item.note}` : ""}
                    </li>
                  ))}
                </ul>
              </>
            )}
            {earlier.map((version) => (
              <details key={version.id}>
                <summary className={styles.disclosureSummary}>
                  Version {version.versionNumber} · issued{" "}
                  {version.issuedAt ? formatDate(version.issuedAt) : ""}
                </summary>
                <div className={styles.disclosureContent}>
                  <div className={styles.actions}>
                    <button
                      className={styles.secondaryButton}
                      onClick={() => void openPdf(version.versionNumber)}
                      type="button"
                    >
                      PDF
                    </button>
                  </div>
                  <VersionView version={version} />
                </div>
              </details>
            ))}
          </div>
        </details>
      )}
    </main>
  );
}
