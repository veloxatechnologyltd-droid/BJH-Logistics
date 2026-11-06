"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { BankAccount } from "@bjh/contracts";
import { canWorkFinance } from "../auth/roleAccess";
import { useStaffAccess } from "../auth/useStaffAccess";
import { listCustomers } from "../customers/customerApi";
import type { CustomerCompany } from "../customers/customerApi";
import { FinanceTabs } from "../invoices/FinanceTabs";
import {
  createInvoice,
  createInvoiceFromCharges,
  importCharges,
  clientHome,
  listJobs,
  listReferences,
  serviceLineLabels,
  statusLabels,
} from "../jobs/jobApi";
import type { ChargeLeftOut, Job } from "../jobs/jobApi";
import { formatDate } from "../jobs/jobFormat";
import styles from "../jobs/jobs.module.css";
import { getQuote } from "../quotes/quoteApi";
import { popularCurrencies } from "../settings/business/BusinessSettingsForm";
import { BankAccountPicker, listedBankAccountIds } from "../BankAccountSelect";
import { getSettings } from "../settings/business/settingsApi";
import { plainMessage } from "../ErrorPopup";
import {
  ShipmentFields,
  emptyShipment,
  shipmentFromJob,
  shipmentInput,
} from "./ShipmentFields";
import type { ShipmentForm } from "./ShipmentFields";

type Start = "quote" | "fresh";

/** What the chosen job's accepted quote says, for a "from quote" invoice. */
type QuoteFacts = {
  quoteNumber: string | null;
  currency: string | null;
  sizeLabels: string[];
};

/**
 * Starts an invoice from Finance (Evans, 2026-11-04): choose the client,
 * whether it comes from their accepted quote or starts fresh, and, if wanted,
 * which of their jobs it bills. A job is optional (client request,
 * 2026-11-05): a fresh invoice can be made for a client with no job, with the
 * bill of lading and shipment details typed on it. The draft then opens in
 * Finance.
 */
export function NewInvoice() {
  const router = useRouter();
  const { status, roles } = useStaffAccess();
  const [customers, setCustomers] = useState<CustomerCompany[]>([]);
  const [configured, setConfigured] = useState<string[]>([]);
  const [companyId, setCompanyId] = useState("");
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [start, setStart] = useState<Start>("quote");
  const [jobId, setJobId] = useState("");
  const [shipment, setShipment] = useState<ShipmentForm>(emptyShipment);
  const [quote, setQuote] = useState<QuoteFacts | null>(null);
  const [currency, setCurrency] = useState("");
  const [containerSize, setContainerSize] = useState("");
  const [containers, setContainers] = useState("1");
  const [dueDate, setDueDate] = useState("");
  const [notes, setNotes] = useState("");
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  // null = untouched: the default accounts print.
  const [bankChoice, setBankChoice] = useState<string[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [leftOut, setLeftOut] = useState<{
    href: string;
    items: ChargeLeftOut[];
  } | null>(null);

  useEffect(() => {
    listCustomers("")
      .then(setCustomers)
      .catch(() => undefined);
    getSettings()
      .then((result) => {
        if (result.current) {
          setConfigured(result.current.settings.currencies);
          setBankAccounts(result.current.settings.bankAccounts ?? []);
        }
      })
      .catch(() => undefined);
  }, []);

  // A job's "Create invoice" arrives with ?client=<id>&job=<id>.
  const linkedJob = useRef<string | null>(null);
  // "Create another invoice" asks for ?start=fresh: the quote is already billed.
  const linkedFresh = useRef(false);
  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    linkedJob.current = query.get("job");
    linkedFresh.current = query.get("start") === "fresh";
    const client = query.get("client");
    if (client) setCompanyId(client);
  }, []);

  useEffect(() => {
    setJobs(null);
    setJobId("");
    if (!companyId) return;
    listJobs("", { customerCompanyId: companyId })
      .then((found) => {
        // Invoices are prepared on open jobs only.
        const open = found.filter(
          (job) => job.status !== "closed" && job.status !== "cancelled",
        );
        setJobs(open);
        const linked = open.find((job) => job.id === linkedJob.current);
        linkedJob.current = null;
        const fresh = linkedFresh.current;
        linkedFresh.current = false;
        if (linked) {
          setStart(linked.quoteId && !fresh ? "quote" : "fresh");
          setJobId(linked.id);
          return;
        }
        setStart(open.some((job) => job.quoteId) && !fresh ? "quote" : "fresh");
      })
      .catch((cause) =>
        setError(
          plainMessage(
            cause instanceof Error
              ? cause.message
              : "The client's jobs could not be loaded",
          ),
        ),
      );
  }, [companyId]);

  const choices = (jobs ?? []).filter(
    (job) => start === "fresh" || job.quoteId,
  );
  const job = choices.find((item) => item.id === jobId);

  // A job from a quote bills in the accepted quote's currency by default.
  useEffect(() => {
    setQuote(null);
    setContainerSize("");
    if (!job?.quoteId) return;
    getQuote(job.quoteId)
      .then((found) => {
        const accepted = found.decisions.find(
          (decision) => decision.decision === "accepted",
        );
        const version = found.versions.find(
          (item) => item.versionNumber === accepted?.versionNumber,
        );
        setQuote({
          quoteNumber: found.quoteNumber,
          currency: version?.currency ?? null,
          sizeLabels: version?.sizeLabels ?? [],
        });
        if (version) setCurrency(version.currency);
      })
      .catch(() => undefined);
  }, [job?.quoteId]);

  // Choosing a job fills the shipment details with what the job already
  // holds; they can be changed, and no job starts them empty.
  useEffect(() => {
    if (!job) {
      setShipment(emptyShipment());
      return;
    }
    let current = true;
    listReferences(job.id)
      .then((references) => {
        if (current) setShipment(shipmentFromJob(job, references));
      })
      .catch(() => {
        if (current) setShipment(shipmentFromJob(job, []));
      });
    return () => {
      current = false;
    };
  }, [job?.id]);

  const currencies = configured.length > 0 ? configured : popularCurrencies;
  const fromQuote = start === "quote" && Boolean(job?.quoteId);
  const sizePriced = fromQuote && quote !== null && quote.sizeLabels.length > 0;
  const containerCount = Number(containers);
  // Shown beside the button, so a greyed-out button always says why.
  const missing = [
    !currency && "a currency",
    sizePriced && !containerSize && "a container size",
    sizePriced &&
      !(Number.isInteger(containerCount) && containerCount > 0) &&
      "the number of containers",
  ].filter((item): item is string => Boolean(item));

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!currency || (!job && start === "quote")) return;
    setSaving(true);
    setError("");
    try {
      const details = {
        currency,
        dueDate: dueDate || undefined,
        notes: notes.trim() || undefined,
        bankAccountIds: listedBankAccountIds(bankAccounts, bankChoice),
        shipment: shipmentInput(shipment),
      };
      if (!job) {
        const created = await createInvoice(clientHome(companyId), {
          ...details,
          lines: [],
        });
        router.push(`/finance/clients/${companyId}/invoices/${created.id}`);
      } else if (fromQuote) {
        const count = Number(containers);
        // Lines already brought in from the quote are skipped, not doubled.
        await importCharges(
          job.id,
          containerSize || undefined,
          Number.isInteger(count) && count > 0 ? count : 1,
        );
        const result = await createInvoiceFromCharges(job.id, details);
        const href = `/finance/jobs/${job.id}/invoices/${result.invoice.id}`;
        if (result.leftOut.length > 0) {
          setLeftOut({ href, items: result.leftOut });
          return;
        }
        router.push(href);
      } else {
        const created = await createInvoice(job.id, { ...details, lines: [] });
        router.push(`/finance/jobs/${job.id}/invoices/${created.id}`);
      }
    } catch (cause) {
      setError(
        plainMessage(
          cause instanceof Error
            ? cause.message
            : "The invoice could not be started",
        ),
      );
    } finally {
      setSaving(false);
    }
  }

  if (status === "loading" && roles.length === 0) {
    return <p role="status">Checking staff access…</p>;
  }
  if (!canWorkFinance(roles)) {
    return (
      <main className={styles.page}>
        <p role="status">Invoices are for Finance.</p>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <Link className={styles.link} href="/invoices">
            ← Invoices
          </Link>
          <h1 className={styles.title}>New invoice</h1>
          <p className={styles.muted}>
            Start a draft, check the lines, then issue it to the client.
          </p>
        </div>
      </header>
      <FinanceTabs active="/invoices" />

      {leftOut ? (
        <section className={styles.card} aria-labelledby="left-out-title">
          <h2 id="left-out-title">Draft created</h2>
          <p>Some of the job&apos;s charges were not put on this invoice:</p>
          <ul className={styles.list}>
            {leftOut.items.map((item) => (
              <li key={`${item.description}-${item.currency ?? ""}`}>
                {item.reason === "no_amount"
                  ? `${item.description}: no amount recorded yet`
                  : `${item.description}: priced in ${item.currency}, so it goes on a ${item.currency} invoice`}
              </li>
            ))}
          </ul>
          <Link className={styles.primaryLink} href={leftOut.href}>
            Open the draft
          </Link>
        </section>
      ) : (
        <form className={styles.form} onSubmit={submit}>
          <section className={styles.card} aria-labelledby="client-title">
            <h2 id="client-title">1. Client</h2>
            <label className={styles.field}>
              Who is the invoice for?
              <select
                onChange={(event) => setCompanyId(event.target.value)}
                required
                value={companyId}
              >
                <option value="">Choose a client</option>
                {customers.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.companyName}
                  </option>
                ))}
              </select>
            </label>
          </section>

          {companyId && (
            <section className={styles.card} aria-labelledby="start-title">
              <h2 id="start-title">2. Start from</h2>
              <label className={styles.choice}>
                <input
                  checked={start === "quote"}
                  name="start"
                  onChange={() => {
                    setStart("quote");
                    setJobId("");
                  }}
                  type="radio"
                />
                <span>
                  <strong>The client&apos;s accepted quote</strong>
                  <small>
                    The quote&apos;s charges become the invoice lines, ready to
                    check
                  </small>
                </span>
              </label>
              <label className={styles.choice}>
                <input
                  checked={start === "fresh"}
                  name="start"
                  onChange={() => {
                    setStart("fresh");
                    setJobId("");
                  }}
                  type="radio"
                />
                <span>
                  <strong>A fresh invoice</strong>
                  <small>You type the lines yourself</small>
                </span>
              </label>
            </section>
          )}

          {companyId && (
            <section className={styles.card} aria-labelledby="job-title">
              <h2 id="job-title">3. Job it bills (optional)</h2>
              {!jobs && <p role="status">Loading the client&apos;s jobs…</p>}
              {jobs && choices.length === 0 && (
                <p className={styles.muted}>
                  {start === "quote"
                    ? "None of this client's open jobs came from an accepted quote. Choose a fresh invoice instead."
                    : "This client has no open jobs: the invoice will be made for the client directly."}
                </p>
              )}
              {start === "fresh" && (
                <label className={styles.choice}>
                  <input
                    checked={jobId === ""}
                    name="job"
                    onChange={() => setJobId("")}
                    type="radio"
                  />
                  <span>
                    <strong>No job</strong>
                    <small>Invoice the client directly, without a job</small>
                  </span>
                </label>
              )}
              {choices.map((item) => (
                <label className={styles.choice} key={item.id}>
                  <input
                    checked={jobId === item.id}
                    name="job"
                    onChange={() => setJobId(item.id)}
                    required={start === "quote"}
                    type="radio"
                  />
                  <span>
                    <strong>{item.fileNumber}</strong>
                    <small>
                      {serviceLineLabels[item.serviceLine]} ·{" "}
                      {statusLabels[item.status]} · opened{" "}
                      {formatDate(item.openedAt)}
                    </small>
                  </span>
                </label>
              ))}
            </section>
          )}

          {companyId && (job || start === "fresh") && (
            <section className={styles.card} aria-labelledby="details-title">
              <h2 id="details-title">4. Details</h2>
              {fromQuote && quote?.quoteNumber && (
                <p className={styles.muted}>
                  From quote {quote.quoteNumber}
                  {quote.currency ? `, accepted in ${quote.currency}` : ""}.
                </p>
              )}
              <label className={styles.field}>
                Currency (required)
                <select
                  onChange={(event) => setCurrency(event.target.value)}
                  required
                  value={currency}
                >
                  <option value="">Choose a currency</option>
                  {[
                    ...new Set([
                      ...(quote?.currency ? [quote.currency] : []),
                      ...currencies,
                    ]),
                  ].map((code) => (
                    <option key={code} value={code}>
                      {code}
                    </option>
                  ))}
                </select>
              </label>
              {fromQuote && quote && quote.sizeLabels.length > 0 && (
                <>
                  <label className={styles.field}>
                    Container size (required; the quote prices by size)
                    <select
                      onChange={(event) => setContainerSize(event.target.value)}
                      required
                      value={containerSize}
                    >
                      <option value="">Choose a size</option>
                      {quote.sizeLabels.map((label) => (
                        <option key={label} value={label}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className={styles.field}>
                    Number of containers (required)
                    <input
                      inputMode="numeric"
                      min={1}
                      onChange={(event) => setContainers(event.target.value)}
                      required
                      type="number"
                      value={containers}
                    />
                  </label>
                </>
              )}
              <BankAccountPicker
                accounts={bankAccounts}
                className={styles.field}
                onChange={setBankChoice}
                value={bankChoice}
              />
              <ShipmentFields onChange={setShipment} value={shipment} />
              <label className={styles.field}>
                Due date (optional; the payment terms in settings apply
                otherwise)
                <input
                  onChange={(event) => setDueDate(event.target.value)}
                  type="date"
                  value={dueDate}
                />
              </label>
              <label className={styles.field}>
                Notes (optional)
                <input
                  maxLength={2000}
                  onChange={(event) => setNotes(event.target.value)}
                  value={notes}
                />
              </label>
              {error && (
                <p className={styles.error} role="alert">
                  {error}
                </p>
              )}
              {!fromQuote && (
                <p className={styles.muted}>
                  Next you add the charge lines (description, quantity, unit
                  price) on the draft, then issue it.
                </p>
              )}
              {missing.length > 0 && (
                <p className={styles.error} role="status">
                  Still needed before the draft can be created:{" "}
                  {missing.join(", ")}.
                </p>
              )}
              <div className={styles.formActions}>
                <button
                  className={styles.button}
                  disabled={saving || missing.length > 0}
                  type="submit"
                >
                  {saving ? "Creating…" : "Create draft invoice"}
                </button>
                <Link className={styles.secondaryButton} href="/invoices">
                  Cancel
                </Link>
              </div>
            </section>
          )}
          {!(companyId && (job || start === "fresh")) && error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
        </form>
      )}
    </main>
  );
}
