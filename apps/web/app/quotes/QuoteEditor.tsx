"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  BankAccountPicker,
  listedBankAccountIds,
  savedBankAccountIds,
} from "../BankAccountSelect";
import { ChargeOptions } from "../ChargeOptions";
import type { FormEvent, ReactNode } from "react";
import {
  quoteBasisKeys,
  quoteBasisLabels,
  serviceLinesForRoles,
} from "@bjh/contracts";
import type {
  BankAccount,
  HeldStaffRoleKey,
  QuoteBasis,
  ServiceLine,
} from "@bjh/contracts";
import { useStaffAccess } from "../auth/useStaffAccess";
import { listCustomers } from "../customers/customerApi";
import type { CustomerCompany } from "../customers/customerApi";
import { leadToCustomer, listLeads } from "../customers/leadApi";
import type { Lead } from "../customers/leadApi";
import { serviceLineLabels } from "../jobs/jobApi";
import styles from "../jobs/jobs.module.css";
import layout from "./quoteEditor.module.css";
import { getSettings } from "../settings/business/settingsApi";
import { popularCurrencies } from "../settings/business/BusinessSettingsForm";
import { createQuote, formatMoney, saveQuoteDraft, toMinor } from "./quoteApi";
import type { Quote, QuoteVersion, QuoteVersionBody } from "./quoteApi";
import { ErrorPopup } from "../ErrorPopup";

const serviceLines = Object.keys(serviceLineLabels) as ServiceLine[];

type LineDraft = {
  section: string;
  description: string;
  details: string;
  basis: QuoteBasis;
  basisNote: string;
  containerSize: string;
  quantity: string;
  /** Unit price, in major units as typed. */
  amount: string;
};

const blankLine = (section = ""): LineDraft => ({
  section,
  description: "",
  details: "",
  basis: "fixed",
  basisNote: "",
  containerSize: "",
  quantity: "1",
  amount: "",
});

/** Sizes offered while typing; any other label may be entered. */
const COMMON_SIZES = ["20ft", "40ft", "40ft HC", "45ft", "LCL"];

const major = (minor: number | null) =>
  minor === null ? "" : (minor / 100).toFixed(2);

const cleanList = (items: string[]) =>
  items.map((item) => item.trim()).filter(Boolean);

/**
 * The draft's lines as rows of unit price x quantity. An earlier version that
 * priced each line per size column becomes one row per size.
 */
function linesFrom(version: QuoteVersion | undefined): LineDraft[] {
  if (!version || version.lines.length === 0) return [blankLine()];
  return version.lines.flatMap((line) => {
    const common = {
      section: line.section ?? "",
      description: line.description,
      details: line.details ?? "",
      basis: line.basis,
      basisNote: line.basisNote ?? "",
    };
    if (line.sizeAmountsMinor) {
      return line.sizeAmountsMinor.map((minor, index) => ({
        ...common,
        containerSize: version.sizeLabels[index] ?? "",
        quantity: "1",
        amount: major(minor),
      }));
    }
    return [
      {
        ...common,
        containerSize: line.containerSize ?? "",
        quantity: String(line.quantity ?? 1),
        amount: major(line.amountMinor),
      },
    ];
  });
}

/** The row total as typed, or "" while the price or quantity is incomplete. */
function rowTotal(line: LineDraft, currency: string): string {
  const unit = toMinor(line.amount);
  const quantity = Number(line.quantity);
  if (unit === undefined || Number.isNaN(unit) || !Number.isInteger(quantity))
    return "";
  return formatMoney(unit * quantity, currency || "USD");
}

/** Prepares a new quote, or edits the draft version of an existing one. */
export function QuoteEditor({
  quote,
  draft,
  onSaved,
  fromRequest,
  initialCustomerId,
  initialServiceLine,
  notice,
}: {
  quote?: Quote;
  draft?: QuoteVersion;
  onSaved?: (quote: Quote) => void;
  /** Set when the quote answers a customer request: the client is fixed. */
  fromRequest?: { requestId: string; customerId: string };
  /** The client to start with when staff can still change it. */
  initialCustomerId?: string;
  /** The service to start with, for example the request's. */
  initialServiceLine?: ServiceLine;
  /** Shown under the page heading of a new quote. */
  notice?: ReactNode;
}) {
  const router = useRouter();
  const { roles, isSuperAdmin } = useStaffAccess();
  const [customers, setCustomers] = useState<CustomerCompany[]>([]);
  /** Open leads not yet linked to a customer; a quote can be prepared for them too. */
  const [leads, setLeads] = useState<Lead[]>([]);
  /** Whether the quote is for a customer or a lead; picked before the name. */
  const [partyKind, setPartyKind] = useState<"customer" | "lead">("customer");
  const [customerId, setCustomerId] = useState(
    fromRequest?.customerId ?? initialCustomerId ?? "",
  );
  const [serviceLine, setServiceLine] = useState<ServiceLine | "">(
    initialServiceLine ?? "",
  );
  const [currency, setCurrency] = useState(draft?.currency ?? "");
  const [title, setTitle] = useState(draft?.title ?? "");
  const [subtitle, setSubtitle] = useState(draft?.subtitle ?? "");
  const [shipmentScope, setShipmentScope] = useState(
    draft?.shipmentScope ?? "",
  );
  const [intro, setIntro] = useState(draft?.intro ?? "");
  const [atCostNote, setAtCostNote] = useState(draft?.atCostNote ?? "");
  const [steps, setSteps] = useState(draft?.procedureSteps ?? []);
  const [documents, setDocuments] = useState(draft?.requiredDocuments ?? []);
  const [documentsNote, setDocumentsNote] = useState(
    draft?.documentsNote ?? "",
  );
  const [timeline, setTimeline] = useState(draft?.timeline ?? "");
  const [terms, setTerms] = useState(draft?.terms ?? []);
  const [lines, setLines] = useState<LineDraft[]>(() => linesFrom(draft));
  const [grouped, setGrouped] = useState(
    Boolean(draft?.lines.some((line) => line.section)),
  );
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [configuredCurrencies, setConfiguredCurrencies] = useState<string[]>(
    [],
  );
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  // null = untouched: the default accounts print.
  const [bankChoice, setBankChoice] = useState<string[] | null>(
    savedBankAccountIds(draft?.bankAccounts),
  );
  /** The standard wording saved in Settings; null until loaded. */
  const [defaults, setDefaults] = useState<Wording | null>(null);
  /**
   * How this quote's wording is made: the Settings defaults as they are, the
   * defaults changed for this quote only, or new text. Settings never change.
   * A saved draft or a prefilled quote has its own text, so it starts editable.
   */
  const [wordingMode, setWordingMode] = useState<"default" | "edit" | "new">(
    draft ? "edit" : "default",
  );

  const allowedLines = isSuperAdmin
    ? serviceLines
    : serviceLines.filter((line) =>
        serviceLinesForRoles(roles as HeldStaffRoleKey[]).includes(line),
      );

  useEffect(() => {
    if (quote) return;
    listCustomers("")
      .then(setCustomers)
      .catch(() => setError("Customers could not be loaded"));
    listLeads()
      .then((all) =>
        setLeads(
          all.filter(
            (lead) =>
              !lead.customerCompanyId &&
              ["new", "contacted", "quoted"].includes(lead.stage),
          ),
        ),
      )
      .catch(() => undefined);
  }, [quote]);

  // Configured currencies and, for a new quote, the default text from Settings.
  // The currency is never defaulted: staff choose it for each quote.
  useEffect(() => {
    getSettings()
      .then(({ current }) => {
        if (!current) return;
        const { settings } = current;
        setConfiguredCurrencies(settings.currencies);
        setBankAccounts(settings.bankAccounts ?? []);
        setDefaults(settings.quoteDefaults);
        if (draft) return;
        applyWording(settings.quoteDefaults);
      })
      .catch(() => undefined);
  }, [draft]);

  function applyWording(wording: Wording) {
    setIntro(wording.intro ?? "");
    setAtCostNote(wording.atCostNote ?? "");
    setSteps(wording.procedureSteps);
    setDocuments(wording.requiredDocuments);
    setDocumentsNote(wording.documentsNote ?? "");
    setTimeline(wording.timeline ?? "");
    setTerms(wording.terms);
  }

  function chooseWording(mode: "default" | "edit" | "new") {
    setWordingMode(mode);
    if (mode === "default" && defaults) applyWording(defaults);
    if (mode === "new") applyWording(emptyWording);
  }

  const noDefaults =
    defaults !== null &&
    !defaults.intro &&
    !defaults.atCostNote &&
    !defaults.documentsNote &&
    !defaults.timeline &&
    defaults.procedureSteps.length === 0 &&
    defaults.requiredDocuments.length === 0 &&
    defaults.terms.length === 0;

  function change(index: number, patch: Partial<LineDraft>) {
    setLines((current) =>
      current.map((line, at) => (at === index ? { ...line, ...patch } : line)),
    );
  }

  function buildBody(): QuoteVersionBody | string {
    const built: QuoteVersionBody["lines"] = [];
    for (const line of lines) {
      const unit = toMinor(line.amount);
      if (unit !== undefined && Number.isNaN(unit)) {
        return "Prices must be numbers such as 250 or 250.50";
      }
      const quantity = Number(line.quantity);
      if (!Number.isInteger(quantity) || quantity < 1) {
        return "Quantity must be a whole number of 1 or more";
      }
      if (unit === undefined && line.basis !== "at_cost") {
        return "Enter a unit price or select At cost";
      }
      built.push({
        section: (grouped && line.section.trim()) || undefined,
        description: line.description.trim(),
        details: line.details.trim() || undefined,
        basis: line.basis,
        basisNote: line.basisNote.trim() || undefined,
        containerSize: line.containerSize.trim() || undefined,
        quantity,
        amountMinor: unit,
      });
    }
    return {
      currency: currency.trim(),
      title: title.trim(),
      subtitle: subtitle.trim() || undefined,
      shipmentScope: shipmentScope.trim() || undefined,
      intro: intro.trim() || undefined,
      atCostNote: atCostNote.trim() || undefined,
      procedureSteps: cleanList(steps),
      requiredDocuments: cleanList(documents),
      documentsNote: documentsNote.trim() || undefined,
      timeline: timeline.trim() || undefined,
      terms: cleanList(terms),
      sizeLabels: [],
      bankAccountIds: listedBankAccountIds(bankAccounts, bankChoice),
      lines: built,
    };
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    const body = buildBody();
    if (typeof body === "string") {
      setError(body);
      return;
    }
    setSaving(true);
    try {
      if (quote) {
        onSaved?.(await saveQuoteDraft(quote.id, body));
      } else {
        // A lead becomes a customer first; the quote is saved for that company.
        const companyId = customerId.startsWith("lead:")
          ? (await leadToCustomer(customerId.slice(5))).customerCompanyId
          : customerId;
        const created = await createQuote({
          customerCompanyId: companyId,
          serviceLine: serviceLine as ServiceLine,
          quoteRequestId: fromRequest?.requestId,
          version: body,
        });
        router.push(`/quotes/${created.id}`);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The quote failed");
    }
    setSaving(false);
  }

  return (
    <main className={quote ? undefined : styles.page}>
      {!quote && (
        <header className={styles.header}>
          <div>
            <h1 className={styles.title}>Prepare a quote</h1>
          </div>
          <Link className={styles.secondaryButton} href="/quotes">
            Back to quotes
          </Link>
        </header>
      )}
      {!quote && notice}
      <form className={styles.card} onSubmit={(event) => void submit(event)}>
        <div className={layout.section}>
          {!quote && (
            <div className={layout.row}>
              <label className={styles.field}>
                Prepared for
                <select
                  disabled={Boolean(fromRequest)}
                  onChange={(event) => {
                    setPartyKind(event.target.value as "customer" | "lead");
                    setCustomerId("");
                  }}
                  value={partyKind}
                >
                  <option value="customer">Customer</option>
                  <option value="lead">Lead</option>
                </select>
              </label>
              <label className={styles.field}>
                {partyKind === "customer" ? "Customer" : "Lead"}
                <select
                  disabled={Boolean(fromRequest)}
                  onChange={(event) => setCustomerId(event.target.value)}
                  required
                  value={customerId}
                >
                  {partyKind === "customer" ? (
                    <>
                      <option value="">Select a customer</option>
                      {customers.map((customer) => (
                        <option key={customer.id} value={customer.id}>
                          {customer.companyName} ({customer.customerNumber})
                        </option>
                      ))}
                    </>
                  ) : (
                    <>
                      <option value="">
                        {leads.length ? "Select a lead" : "No open leads"}
                      </option>
                      {leads.map((lead) => (
                        <option key={lead.id} value={`lead:${lead.id}`}>
                          {lead.companyName}
                          {lead.contactName ? ` (${lead.contactName})` : ""}
                        </option>
                      ))}
                    </>
                  )}
                </select>
              </label>
            </div>
          )}
          {!quote && (
            <div className={layout.row}>
              <label className={styles.field}>
                Service
                <select
                  onChange={(event) =>
                    setServiceLine(event.target.value as ServiceLine)
                  }
                  required
                  value={serviceLine}
                >
                  <option value="">Select a service</option>
                  {allowedLines.map((line) => (
                    <option key={line} value={line}>
                      {serviceLineLabels[line]}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
          <div className={layout.row}>
            <label className={`${styles.field} ${layout.rowWide}`}>
              Quote title
              <input
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Sea freight clearance quotation"
                required
                value={title}
              />
            </label>
            <label className={`${styles.field} ${layout.rowWide}`}>
              Subtitle (optional)
              <input
                onChange={(event) => setSubtitle(event.target.value)}
                placeholder="Full container load general cargo at Tema Port"
                value={subtitle}
              />
            </label>
            <label className={styles.field}>
              Shipment (optional)
              <input
                onChange={(event) => setShipmentScope(event.target.value)}
                placeholder="20ft FCL / 40ft FCL"
                value={shipmentScope}
              />
            </label>
            <label className={styles.field}>
              Currency
              <select
                onChange={(event) => setCurrency(event.target.value)}
                required
                value={currency}
              >
                <option value="">Choose a currency</option>
                {[
                  ...new Set([
                    // Until Settings has currencies, offer the popular list.
                    ...(configuredCurrencies.length > 0
                      ? configuredCurrencies
                      : popularCurrencies),
                    currency,
                  ]),
                ]
                  .filter(Boolean)
                  .map((code) => (
                    <option key={code} value={code}>
                      {code}
                    </option>
                  ))}
              </select>
            </label>
            <BankAccountPicker
              accounts={bankAccounts}
              className={styles.field}
              onChange={setBankChoice}
              value={bankChoice}
            />
          </div>

          <h2>Charges</h2>
          <label className={layout.check}>
            <input
              checked={grouped}
              onChange={(event) => setGrouped(event.target.checked)}
              type="checkbox"
            />
            Group charges under headings
          </label>
          <div>
            <ChargeOptions id="quote-charge-options" />
            <datalist id="quote-size-options">
              {COMMON_SIZES.map((size) => (
                <option key={size} value={size} />
              ))}
            </datalist>
            {lines.map((line, index) => (
              <div
                className={`${layout.charge} ${layout.unitPriced}`}
                key={index}
              >
                <label className={`${layout.small} ${layout.chargeName}`}>
                  Charge
                  <input
                    list="quote-charge-options"
                    onChange={(event) =>
                      change(index, { description: event.target.value })
                    }
                    placeholder="Port handling fee"
                    required
                    value={line.description}
                  />
                </label>
                <label className={layout.small}>
                  Container size
                  <input
                    list="quote-size-options"
                    maxLength={30}
                    onChange={(event) =>
                      change(index, { containerSize: event.target.value })
                    }
                    placeholder="Optional"
                    value={line.containerSize}
                  />
                </label>
                <label className={layout.small}>
                  Qty
                  <input
                    inputMode="numeric"
                    min={1}
                    onChange={(event) =>
                      change(index, { quantity: event.target.value })
                    }
                    type="number"
                    value={line.quantity}
                  />
                </label>
                <label className={layout.small}>
                  Unit price
                  <input
                    inputMode="decimal"
                    onChange={(event) =>
                      change(index, { amount: event.target.value })
                    }
                    value={line.amount}
                  />
                </label>
                <div className={layout.small}>
                  Total
                  <output className={layout.total}>
                    {rowTotal(line, currency) || "—"}
                  </output>
                </div>
                <label className={layout.small}>
                  Basis
                  <select
                    onChange={(event) =>
                      change(index, { basis: event.target.value as QuoteBasis })
                    }
                    value={line.basis}
                  >
                    {quoteBasisKeys.map((basis) => (
                      <option key={basis} value={basis}>
                        {quoteBasisLabels[basis]}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  className={layout.remove}
                  disabled={lines.length === 1}
                  onClick={() =>
                    setLines((current) =>
                      current.filter((_, at) => at !== index),
                    )
                  }
                  type="button"
                >
                  Remove
                </button>
                <label className={`${layout.small} ${layout.extra}`}>
                  Description (optional)
                  <input
                    maxLength={500}
                    onChange={(event) =>
                      change(index, { details: event.target.value })
                    }
                    placeholder="Covers terminal handling and gate-in"
                    value={line.details}
                  />
                </label>
                {grouped && (
                  <label className={`${layout.small} ${layout.extra}`}>
                    Heading
                    <input
                      onChange={(event) =>
                        change(index, { section: event.target.value })
                      }
                      placeholder="Clearance Charges"
                      value={line.section}
                    />
                  </label>
                )}
              </div>
            ))}
          </div>
          <div className={styles.actions}>
            <button
              className={styles.secondaryButton}
              onClick={() =>
                setLines((current) => [
                  ...current,
                  blankLine(current[current.length - 1]?.section ?? ""),
                ])
              }
              type="button"
            >
              Add a charge
            </button>
          </div>
          <p className={styles.muted}>
            Leave the price empty only when the basis is At cost.
          </p>
          <p className={layout.grandTotal}>
            Total{" "}
            {formatMoney(
              lines.reduce((sum, line) => {
                const unit = toMinor(line.amount);
                const quantity = Number(line.quantity);
                return unit === undefined ||
                  Number.isNaN(unit) ||
                  !Number.isInteger(quantity)
                  ? sum
                  : sum + unit * quantity;
              }, 0),
              currency || "USD",
            )}
          </p>

          <details className={layout.more}>
            <summary>Standard wording</summary>
            <div className={layout.wordingChoice} role="radiogroup">
              {(
                [
                  ["default", "Use the defaults"],
                  ["edit", "Edit the defaults for this quote"],
                  ["new", "Write new wording"],
                ] as const
              ).map(([mode, label]) => (
                <label key={mode}>
                  <input
                    checked={wordingMode === mode}
                    name="wording"
                    onChange={() => chooseWording(mode)}
                    type="radio"
                  />{" "}
                  {label}
                </label>
              ))}
            </div>
            <p className={styles.muted}>
              {noDefaults
                ? "No default wording is set yet. "
                : wordingMode === "default"
                  ? "This quote uses the wording saved in Settings. "
                  : "Changes here apply to this quote only. "}
              {isSuperAdmin ? (
                <Link href="/settings/business">
                  Set the defaults in Business settings
                </Link>
              ) : (
                "The defaults are set in Business settings."
              )}
            </p>
            <fieldset
              className={`${layout.section} ${layout.wordingFields}`}
              disabled={wordingMode === "default"}
            >
              <label className={styles.field}>
                Introduction
                <textarea
                  onChange={(event) => setIntro(event.target.value)}
                  placeholder="BJH Logistics is pleased to provide this quotation for…"
                  rows={3}
                  value={intro}
                />
              </label>
              <label className={styles.field}>
                Note on at-cost charges
                <textarea
                  onChange={(event) => setAtCostNote(event.target.value)}
                  placeholder="Third-party charges are payable at the actual invoiced amount"
                  rows={2}
                  value={atCostNote}
                />
              </label>
              <ListEditor
                addLabel="Add a step"
                items={steps}
                label="Procedure steps"
                numbered
                onChange={setSteps}
                placeholder="Document review: BJH receives and checks the documents"
              />
              <ListEditor
                addLabel="Add a document"
                items={documents}
                label="Documents required"
                onChange={setDocuments}
                placeholder="Commercial invoice"
              />
              <label className={styles.field}>
                Note below the documents
                <textarea
                  onChange={(event) => setDocumentsNote(event.target.value)}
                  placeholder="Additional documents may be requested depending on the HS code"
                  rows={2}
                  value={documentsNote}
                />
              </label>
              <label className={styles.field}>
                Delivery time
                <textarea
                  onChange={(event) => setTimeline(event.target.value)}
                  placeholder="3 to 5 business days after receipt of complete documents"
                  rows={2}
                  value={timeline}
                />
              </label>
              <ListEditor
                addLabel="Add a term"
                items={terms}
                label="Important terms"
                onChange={setTerms}
                placeholder="Rates are subject to confirmation at the time of shipment"
              />
            </fieldset>
          </details>

          <ErrorPopup message={error} />
          <div className={styles.actions}>
            <button className={styles.button} disabled={saving} type="submit">
              {saving ? "Saving…" : quote ? "Save draft" : "Save as draft"}
            </button>
          </div>
        </div>
      </form>
    </main>
  );
}

type Wording = {
  intro: string | null;
  atCostNote: string | null;
  procedureSteps: string[];
  requiredDocuments: string[];
  documentsNote: string | null;
  timeline: string | null;
  terms: string[];
};

const emptyWording: Wording = {
  intro: null,
  atCostNote: null,
  procedureSteps: [],
  requiredDocuments: [],
  documentsNote: null,
  timeline: null,
  terms: [],
};

/** An editable list: one box per entry, with add and remove. */
function ListEditor({
  label,
  items,
  onChange,
  addLabel,
  placeholder,
  numbered = false,
}: {
  label: string;
  items: string[];
  onChange: (items: string[]) => void;
  addLabel: string;
  placeholder: string;
  numbered?: boolean;
}) {
  return (
    <fieldset className={layout.list}>
      <legend>{label}</legend>
      {items.map((item, index) => (
        <div className={layout.listItem} key={index}>
          {numbered && <span className={layout.number}>{index + 1}.</span>}
          <textarea
            aria-label={`${label} ${index + 1}`}
            onChange={(event) =>
              onChange(
                items.map((entry, at) =>
                  at === index ? event.target.value : entry,
                ),
              )
            }
            placeholder={placeholder}
            rows={item.length > 90 ? 3 : 1}
            value={item}
          />
          <button
            aria-label={`Remove ${label.toLowerCase()} ${index + 1}`}
            className={layout.remove}
            onClick={() => onChange(items.filter((_, at) => at !== index))}
            type="button"
          >
            Remove
          </button>
        </div>
      ))}
      <button
        className={layout.add}
        onClick={() => onChange([...items, ""])}
        type="button"
      >
        + {addLabel}
      </button>
    </fieldset>
  );
}
