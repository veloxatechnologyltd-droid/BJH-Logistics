"use client";

import { useEffect, useMemo, useState } from "react";
import type { LeadSource, LeadStage, LeadUpdateInput } from "@bjh/contracts";
import { leadSourceKeys, leadStageKeys } from "@bjh/contracts";
import { listCustomers } from "../customerApi";
import type { CustomerCompany } from "../customerApi";
import {
  createLead,
  listLeads,
  sourceLabels,
  stageLabels,
  updateLead,
} from "../leadApi";
import type { Lead } from "../leadApi";
import { listQuoteRequests } from "../../quotations/quoteRequestApi";
import type { QuoteRequest } from "../../quotations/quoteRequestApi";
import chart from "../../finance/finance.module.css";
import ui from "../../jobs/jobs.module.css";
import styles from "../customerDirectory.module.css";
import { ErrorPopup } from "../../ErrorPopup";

type Filter = "open" | "won" | "lost" | "all";

const isOpen = (stage: LeadStage) =>
  stage === "new" || stage === "contacted" || stage === "quoted";

const shortDate = (value: string) =>
  new Date(`${value}T00:00:00`).toLocaleDateString("en-GH", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

const message = (cause: unknown, fallback: string) =>
  cause instanceof Error ? cause.message : fallback;

const emptyForm = {
  companyName: "",
  contactName: "",
  email: "",
  phone: "",
  source: "other" as LeadSource,
  nextFollowUp: "",
  notes: "",
};

/** Prospects from first contact to customer. Stages are few; nothing moves on its own. */
export function LeadsBoard() {
  const [leads, setLeads] = useState<Lead[] | null>(null);
  const [requests, setRequests] = useState<QuoteRequest[]>([]);
  const [customers, setCustomers] = useState<CustomerCompany[]>([]);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<Filter>("open");
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [busy, setBusy] = useState(false);
  // A move to Won or Lost needs one more answer before it is saved.
  const [pending, setPending] = useState<{
    lead: Lead;
    stage: "won" | "lost";
  } | null>(null);
  const [lostReason, setLostReason] = useState("");
  const [wonCompany, setWonCompany] = useState("");

  useEffect(() => {
    listLeads()
      .then(setLeads)
      .catch((cause) => setError(message(cause, "Leads could not be loaded")));
    // Requests and customers only enrich the page; the board works without them.
    listQuoteRequests()
      .then(setRequests)
      .catch(() => undefined);
    listCustomers("")
      .then(setCustomers)
      .catch(() => undefined);
  }, []);

  const untracked = useMemo(() => {
    const tracked = new Set((leads ?? []).map((lead) => lead.quoteRequestId));
    return requests.filter(
      (request) => !tracked.has(request.id) && !request.customerCompanyId,
    );
  }, [leads, requests]);

  const count = (stage: LeadStage) =>
    (leads ?? []).filter((lead) => lead.stage === stage).length;
  const openCount = (leads ?? []).filter((lead) => isOpen(lead.stage)).length;
  const overdue = (leads ?? []).filter((lead) => lead.followUpOverdue).length;
  const decided = count("won") + count("lost");

  const shown = (leads ?? []).filter((lead) =>
    filter === "all"
      ? true
      : filter === "open"
        ? isOpen(lead.stage)
        : lead.stage === filter,
  );

  function replace(saved: Lead) {
    setLeads((current) =>
      (current ?? []).map((lead) => (lead.id === saved.id ? saved : lead)),
    );
  }

  async function apply(lead: Lead, update: LeadUpdateInput): Promise<boolean> {
    setError("");
    try {
      replace(await updateLead(lead.id, update));
      return true;
    } catch (cause) {
      setError(message(cause, "The lead could not be saved"));
      return false;
    }
  }

  function chooseStage(lead: Lead, stage: LeadStage) {
    if (stage === lead.stage) return;
    if (stage === "won" || stage === "lost") {
      setPending({ lead, stage });
      setLostReason("");
      setWonCompany("");
      return;
    }
    void apply(lead, { stage });
  }

  async function confirmPending() {
    if (!pending) return;
    const update: LeadUpdateInput =
      pending.stage === "lost"
        ? { stage: "lost", lostReason }
        : { stage: "won", customerCompanyId: wonCompany };
    if (await apply(pending.lead, update)) setPending(null);
  }

  async function submitLead(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const created = await createLead({
        companyName: form.companyName,
        contactName: form.contactName,
        email: form.email,
        phone: form.phone,
        source: form.source,
        nextFollowUp: form.nextFollowUp || null,
        notes: form.notes,
      });
      setLeads((current) => [created, ...(current ?? [])]);
      setForm(emptyForm);
      setAdding(false);
    } catch (cause) {
      setError(message(cause, "The lead could not be added"));
    } finally {
      setBusy(false);
    }
  }

  async function track(request: QuoteRequest) {
    setError("");
    try {
      const created = await createLead({
        companyName: request.companyName,
        contactName: request.contactName,
        email: request.email,
        source: "quote_request",
        notes: request.message.slice(0, 2000),
        quoteRequestId: request.id,
      });
      setLeads((current) => [created, ...(current ?? [])]);
    } catch (cause) {
      setError(message(cause, "The request could not be tracked"));
    }
  }

  return (
    <>
      <section className={styles.overview} aria-label="Lead overview">
        <div className={styles.metric}>
          <span>Open leads</span>
          <strong>{leads ? openCount : "—"}</strong>
          <small>New, contacted or quoted</small>
        </div>
        <div className={styles.metric}>
          <span>Follow-ups overdue</span>
          <strong>{leads ? overdue : "—"}</strong>
          <small>Open leads whose follow-up date has passed</small>
        </div>
        <div className={styles.metric}>
          <span>Won</span>
          <strong>{leads ? count("won") : "—"}</strong>
          <small>Became customers</small>
        </div>
        <div className={styles.metric}>
          <span>Win rate</span>
          <strong>
            {leads && decided > 0
              ? `${Math.round((count("won") / decided) * 100)}%`
              : "—"}
          </strong>
          <small>
            {decided > 0
              ? `${count("won")} won of ${decided} decided`
              : "Nothing won or lost yet"}
          </small>
        </div>
      </section>

      <ErrorPopup message={error} />

      {untracked.length > 0 && (
        <section className={chart.chartCard} aria-labelledby="untracked-title">
          <h2 id="untracked-title">Quote requests not yet tracked</h2>
          <ul className={ui.itemList}>
            {untracked.map((request) => (
              <li key={request.id}>
                <div>
                  <strong>{request.companyName}</strong>
                  <p className={ui.muted}>
                    {request.contactName} · {request.email}
                  </p>
                </div>
                <button
                  className={ui.secondaryButton}
                  onClick={() => void track(request)}
                  type="button"
                >
                  Track as lead
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className={styles.directory} aria-label="Leads">
        <div className={styles.searchHeader}>
          <div className={ui.segmented} role="group" aria-label="Show">
            {(["open", "won", "lost", "all"] as const).map((option) => (
              <button
                aria-pressed={filter === option}
                className={filter === option ? ui.segmentActive : ""}
                key={option}
                onClick={() => setFilter(option)}
                type="button"
              >
                {option === "open"
                  ? "Open"
                  : option === "all"
                    ? "All"
                    : stageLabels[option]}
              </button>
            ))}
          </div>
          {!adding && (
            <button
              className={ui.button}
              onClick={() => setAdding(true)}
              type="button"
            >
              Add lead
            </button>
          )}
        </div>

        {adding && (
          <form className={ui.form} onSubmit={submitLead}>
            <div className={ui.grid}>
              <label className={ui.field}>
                Company
                <input
                  maxLength={160}
                  onChange={(event) =>
                    setForm({ ...form, companyName: event.target.value })
                  }
                  required
                  value={form.companyName}
                />
              </label>
              <label className={ui.field}>
                Contact
                <input
                  maxLength={160}
                  onChange={(event) =>
                    setForm({ ...form, contactName: event.target.value })
                  }
                  value={form.contactName}
                />
              </label>
              <label className={ui.field}>
                Email
                <input
                  onChange={(event) =>
                    setForm({ ...form, email: event.target.value })
                  }
                  type="email"
                  value={form.email}
                />
              </label>
              <label className={ui.field}>
                Phone
                <input
                  onChange={(event) =>
                    setForm({ ...form, phone: event.target.value })
                  }
                  type="tel"
                  value={form.phone}
                />
              </label>
              <label className={ui.field}>
                Source
                <select
                  onChange={(event) =>
                    setForm({
                      ...form,
                      source: event.target.value as LeadSource,
                    })
                  }
                  value={form.source}
                >
                  {leadSourceKeys
                    .filter((source) => source !== "quote_request")
                    .map((source) => (
                      <option key={source} value={source}>
                        {sourceLabels[source]}
                      </option>
                    ))}
                </select>
              </label>
              <label className={ui.field}>
                Follow up on
                <input
                  onChange={(event) =>
                    setForm({ ...form, nextFollowUp: event.target.value })
                  }
                  type="date"
                  value={form.nextFollowUp}
                />
              </label>
              <label className={`${ui.field} ${ui.wide}`}>
                Notes
                <textarea
                  maxLength={2000}
                  onChange={(event) =>
                    setForm({ ...form, notes: event.target.value })
                  }
                  rows={3}
                  value={form.notes}
                />
              </label>
            </div>
            <div className={ui.formActions}>
              <button className={ui.button} disabled={busy} type="submit">
                {busy ? "Saving…" : "Save lead"}
              </button>
              <button
                className={ui.secondaryButton}
                onClick={() => {
                  setAdding(false);
                  setForm(emptyForm);
                }}
                type="button"
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        {pending && (
          <div className={ui.form} role="group" aria-label="Finish lead">
            <strong>
              {pending.stage === "won" ? "Won" : "Lost"}:{" "}
              {pending.lead.companyName}
            </strong>
            {pending.stage === "lost" ? (
              <label className={ui.field}>
                Why was it lost?
                <input
                  maxLength={500}
                  onChange={(event) => setLostReason(event.target.value)}
                  value={lostReason}
                />
              </label>
            ) : (
              <label className={ui.field}>
                Which customer did it become?
                <select
                  onChange={(event) => setWonCompany(event.target.value)}
                  value={wonCompany}
                >
                  <option value="">Choose a customer</option>
                  {customers.map((company) => (
                    <option key={company.id} value={company.id}>
                      {company.companyName} ({company.customerNumber})
                    </option>
                  ))}
                </select>
              </label>
            )}
            <div className={ui.formActions}>
              <button
                className={ui.button}
                disabled={
                  pending.stage === "lost" ? !lostReason.trim() : !wonCompany
                }
                onClick={() => void confirmPending()}
                type="button"
              >
                Save
              </button>
              <button
                className={ui.secondaryButton}
                onClick={() => setPending(null)}
                type="button"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {!leads && !error && <p className={ui.muted}>Loading…</p>}
        {leads && shown.length === 0 && (
          <div className={styles.emptyState}>
            <h2>No leads here</h2>
            <p>
              {leads.length === 0
                ? "Add a prospect, or track a quote request."
                : "Nothing matches this view."}
            </p>
          </div>
        )}
        {shown.length > 0 && (
          <div className={styles.tableScroll}>
            <table className={styles.customerTable}>
              <thead>
                <tr>
                  <th scope="col">Lead</th>
                  <th scope="col">Stage</th>
                  <th scope="col">Source</th>
                  <th scope="col">Owner</th>
                  <th scope="col">Follow up</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((lead) => (
                  <tr key={lead.id}>
                    <th scope="row">
                      {lead.companyName}
                      <span className={styles.tradingName}>
                        {[lead.contactName, lead.email, lead.phone]
                          .filter(Boolean)
                          .join(" · ") || "No contact details"}
                      </span>
                      {lead.stage === "lost" && lead.lostReason && (
                        <span className={styles.tradingName}>
                          Lost: {lead.lostReason}
                        </span>
                      )}
                      {lead.stage === "won" && lead.customerCompanyName && (
                        <span className={styles.tradingName}>
                          Customer: {lead.customerCompanyName}
                        </span>
                      )}
                      {lead.notes && (
                        <span className={styles.tradingName}>{lead.notes}</span>
                      )}
                    </th>
                    <td>
                      <select
                        aria-label={`Stage of ${lead.companyName}`}
                        onChange={(event) =>
                          chooseStage(lead, event.target.value as LeadStage)
                        }
                        value={lead.stage}
                      >
                        {leadStageKeys.map((stage) => (
                          <option key={stage} value={stage}>
                            {stageLabels[stage]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>{sourceLabels[lead.source]}</td>
                    <td>
                      {lead.ownerEmail ?? "Unassigned"}{" "}
                      <button
                        className={ui.textButton}
                        onClick={() =>
                          void apply(lead, {
                            owner: lead.ownerId ? null : "me",
                          })
                        }
                        type="button"
                      >
                        {lead.ownerId ? "Release" : "Take"}
                      </button>
                    </td>
                    <td>
                      {isOpen(lead.stage) ? (
                        <>
                          <input
                            aria-label={`Follow-up date for ${lead.companyName}`}
                            onChange={(event) =>
                              void apply(lead, {
                                nextFollowUp: event.target.value || null,
                              })
                            }
                            type="date"
                            value={lead.nextFollowUp ?? ""}
                          />
                          {lead.followUpOverdue && lead.nextFollowUp && (
                            <span className={styles.tradingName}>
                              Overdue since {shortDate(lead.nextFollowUp)}
                            </span>
                          )}
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
