"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { CSSProperties, FormEvent } from "react";
import { quoteBasisKeys, quoteBasisLabels } from "@bjh/contracts";
import type { QuoteBasis, ServiceLine } from "@bjh/contracts";
import { useStaffAccess } from "../auth/useStaffAccess";
import { listCustomers } from "../customers/customerApi";
import type { CustomerCompany } from "../customers/customerApi";
import { serviceLineLabels } from "../jobs/jobApi";
import styles from "../jobs/jobs.module.css";
import layout from "./quoteEditor.module.css";
import { getSettings } from "../settings/business/settingsApi";
import { popularCurrencies } from "../settings/business/BusinessSettingsForm";
import { createQuote, saveQuoteDraft, toMinor } from "./quoteApi";
import type { Quote, QuoteVersion, QuoteVersionBody } from "./quoteApi";
import { ErrorPopup } from "../ErrorPopup";

const serviceLines = Object.keys(serviceLineLabels) as ServiceLine[];

type LineDraft = {
  section: string;
  description: string;
  details: string;
  basis: QuoteBasis;
  basisNote: string;
  amount: string;
  sizeAmounts: string[];
};

const blankLine = (section = "", sizeCount = 0): LineDraft => ({
  section,
  description: "",
  details: "",
  basis: "fixed",
  basisNote: "",
  amount: "",
  sizeAmounts: Array.from({ length: sizeCount }, () => ""),
});

const major = (minor: number | null) =>
  minor === null ? "" : (minor / 100).toFixed(2);

const cleanList = (items: string[]) =>
  items.map((item) => item.trim()).filter(Boolean);

const DEFAULT_SIZE_LABELS = ["20ft", "40ft"];

function linesFrom(
  version: QuoteVersion | undefined,
  sizeLabels: string[],
): LineDraft[] {
  if (!version || version.lines.length === 0) {
    return [blankLine("", sizeLabels.length)];
  }
  return version.lines.map((line) => ({
    section: line.section ?? "",
    description: line.description,
    details: line.details ?? "",
    basis: line.basis,
    basisNote: line.basisNote ?? "",
    amount: major(line.amountMinor ?? line.sizeAmountsMinor?.[0] ?? null),
    // A single-price charge fills every size, so all rows have the same boxes.
    sizeAmounts: sizeLabels.map((_, index) =>
      major(line.sizeAmountsMinor?.[index] ?? line.amountMinor),
    ),
  }));
}

/** Prepares a new quote, or edits the draft version of an existing one. */
export function QuoteEditor({
  quote,
  draft,
  onSaved,
  fromRequest,
}: {
  quote?: Quote;
  draft?: QuoteVersion;
  onSaved?: (quote: Quote) => void;
  /** Set when the quote answers a customer request: the client is fixed. */
  fromRequest?: { requestId: string; customerId: string };
}) {
  const router = useRouter();
  const { roles, isSuperAdmin } = useStaffAccess();
  const [customers, setCustomers] = useState<CustomerCompany[]>([]);
  const [customerId, setCustomerId] = useState(fromRequest?.customerId ?? "");
  const [serviceLine, setServiceLine] = useState<ServiceLine | "">("");
  const [currency, setCurrency] = useState(draft?.currency ?? "");
  const [title, setTitle] = useState(draft?.title ?? "");
  const [subtitle, setSubtitle] = useState(draft?.subtitle ?? "");
  const [shipmentScope, setShipmentScope] = useState(
    draft?.shipmentScope ?? "",
  );
  const [sizeLabels, setSizeLabels] = useState(
    draft?.sizeLabels.length ? draft.sizeLabels : DEFAULT_SIZE_LABELS,
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
  const [lines, setLines] = useState<LineDraft[]>(() =>
    linesFrom(
      draft,
      draft?.sizeLabels.length ? draft.sizeLabels : DEFAULT_SIZE_LABELS,
    ),
  );
  const [sized, setSized] = useState(
    draft ? draft.sizeLabels.length > 0 : true,
  );
  const [grouped, setGrouped] = useState(
    Boolean(draft?.lines.some((line) => line.section)),
  );
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [configuredCurrencies, setConfiguredCurrencies] = useState<string[]>(
    [],
  );

  const allowedLines = isSuperAdmin
    ? serviceLines
    : serviceLines.filter((line) => roles.includes(`${line}_rep`));

  useEffect(() => {
    if (quote) return;
    listCustomers("")
      .then(setCustomers)
      .catch(() => setError("Customers could not be loaded"));
  }, [quote]);

  // Configured currencies and, for a new quote, the default text from Settings.
  // The currency is never defaulted: staff choose it for each quote.
  useEffect(() => {
    getSettings()
      .then(({ current }) => {
        if (!current) return;
        const { settings } = current;
        setConfiguredCurrencies(settings.currencies);
        if (draft) return;
        setIntro(settings.quoteDefaults.intro ?? "");
        setAtCostNote(settings.quoteDefaults.atCostNote ?? "");
        setSteps(settings.quoteDefaults.procedureSteps);
        setDocuments(settings.quoteDefaults.requiredDocuments);
        setDocumentsNote(settings.quoteDefaults.documentsNote ?? "");
        setTimeline(settings.quoteDefaults.timeline ?? "");
        setTerms(settings.quoteDefaults.terms);
      })
      .catch(() => undefined);
  }, [draft]);

  function change(index: number, patch: Partial<LineDraft>) {
    setLines((current) =>
      current.map((line, at) => (at === index ? { ...line, ...patch } : line)),
    );
  }

  function changeSizeLabel(index: number, value: string) {
    setSizeLabels((current) =>
      current.map((label, at) => (at === index ? value : label)),
    );
  }

  function addSizeLabel() {
    if (sizeLabels.length >= 4) return;
    setSizeLabels((current) => [...current, ""]);
    setLines((current) =>
      current.map((line) => ({
        ...line,
        sizeAmounts: [...line.sizeAmounts, ""],
      })),
    );
  }

  function removeSizeLabel(index: number) {
    setSizeLabels((current) => current.filter((_, at) => at !== index));
    setLines((current) =>
      current.map((line) => ({
        ...line,
        sizeAmounts: line.sizeAmounts.filter((_, at) => at !== index),
      })),
    );
  }

  function buildBody(): QuoteVersionBody | string {
    const activeSizeLabels = sized
      ? sizeLabels.map((label) => label.trim())
      : [];
    if (sized && activeSizeLabels.length === 0) {
      return "Add at least one container size, or turn off size pricing";
    }
    if (activeSizeLabels.some((label) => !label)) {
      return "Enter a name for each container size";
    }
    if (
      new Set(activeSizeLabels.map((label) => label.toLowerCase())).size !==
      activeSizeLabels.length
    ) {
      return "Container size names must be unique";
    }

    const built: QuoteVersionBody["lines"] = [];
    for (const line of lines) {
      const lineIsSized = sized;
      const amounts = lineIsSized
        ? line.sizeAmounts.map(toMinor)
        : [toMinor(line.amount)];
      if (amounts.some((value) => Number.isNaN(value))) {
        return "Amounts must be numbers such as 250 or 250.50";
      }
      const enteredAmounts = amounts.filter(
        (value): value is number => value !== undefined,
      );
      if (
        lineIsSized &&
        enteredAmounts.length > 0 &&
        enteredAmounts.length !== activeSizeLabels.length
      ) {
        return "Enter a price for each container size, or leave all sizes empty for an at-cost charge";
      }
      if (
        lineIsSized &&
        enteredAmounts.length === 0 &&
        line.basis !== "at_cost"
      ) {
        return "Enter a price for each container size";
      }
      if (
        !lineIsSized &&
        enteredAmounts.length === 0 &&
        line.basis !== "at_cost"
      ) {
        return "Enter a price or select At cost";
      }
      built.push({
        section: (grouped && line.section.trim()) || undefined,
        description: line.description.trim(),
        details: line.details.trim() || undefined,
        basis: line.basis,
        basisNote: line.basisNote.trim() || undefined,
        ...(lineIsSized
          ? enteredAmounts.length > 0
            ? { sizeAmountsMinor: enteredAmounts }
            : {}
          : { amountMinor: amounts[0] }),
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
      sizeLabels: activeSizeLabels,
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
        const created = await createQuote({
          customerCompanyId: customerId,
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
      <form className={styles.card} onSubmit={(event) => void submit(event)}>
        <div className={layout.section}>
          {!quote && (
            <div className={layout.row}>
              <label className={styles.field}>
                Prepared for
                <select
                  disabled={Boolean(fromRequest)}
                  onChange={(event) => setCustomerId(event.target.value)}
                  required
                  value={customerId}
                >
                  <option value="">Select a customer</option>
                  {customers.map((customer) => (
                    <option key={customer.id} value={customer.id}>
                      {customer.companyName}
                    </option>
                  ))}
                </select>
              </label>
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
          </div>

          <h2>Charges</h2>
          <label className={layout.check}>
            <input
              checked={sized}
              onChange={(event) => setSized(event.target.checked)}
              type="checkbox"
            />
            Price by container size
          </label>
          {sized && (
            <div className={layout.sizes}>
              {sizeLabels.map((label, index) => (
                <label className={layout.small} key={index}>
                  Container size {index + 1}
                  <span className={layout.sizeInput}>
                    <input
                      aria-label={`Container size ${index + 1} name`}
                      maxLength={30}
                      onChange={(event) =>
                        changeSizeLabel(index, event.target.value)
                      }
                      placeholder="e.g. 50ft"
                      value={label}
                    />
                    <button
                      aria-label={`Remove ${label || `container size ${index + 1}`}`}
                      className={layout.remove}
                      disabled={sizeLabels.length === 1}
                      onClick={() => removeSizeLabel(index)}
                      type="button"
                    >
                      Remove
                    </button>
                  </span>
                </label>
              ))}
              <button
                className={styles.secondaryButton}
                disabled={sizeLabels.length >= 4}
                onClick={addSizeLabel}
                type="button"
              >
                Add container size
              </button>
              <p className={styles.muted}>
                Container sizes are quote-specific. Rename, remove or add sizes
                to match this shipment.
              </p>
            </div>
          )}
          <label className={layout.check}>
            <input
              checked={grouped}
              onChange={(event) => setGrouped(event.target.checked)}
              type="checkbox"
            />
            Group charges under headings
          </label>
          <div>
            {lines.map((line, index) => (
              <div
                className={`${layout.charge} ${sized ? "" : layout.single}`}
                style={
                  {
                    "--size-count": sized ? sizeLabels.length : 0,
                  } as CSSProperties
                }
                key={index}
              >
                <label className={`${layout.small} ${layout.chargeName}`}>
                  Charge
                  <input
                    onChange={(event) =>
                      change(index, { description: event.target.value })
                    }
                    placeholder="Port handling fee"
                    required
                    value={line.description}
                  />
                </label>
                {sized ? (
                  <>
                    {sizeLabels.map((label, sizeIndex) => (
                      <label className={layout.small} key={sizeIndex}>
                        {label.trim() || `Size ${sizeIndex + 1}`}
                        <input
                          aria-label={`${label.trim() || `Size ${sizeIndex + 1}`} price for ${line.description || `charge ${index + 1}`}`}
                          inputMode="decimal"
                          onChange={(event) =>
                            change(index, {
                              sizeAmounts: line.sizeAmounts.map((amount, at) =>
                                at === sizeIndex ? event.target.value : amount,
                              ),
                            })
                          }
                          value={line.sizeAmounts[sizeIndex] ?? ""}
                        />
                      </label>
                    ))}
                  </>
                ) : (
                  <label className={layout.small}>
                    Price
                    <input
                      inputMode="decimal"
                      onChange={(event) =>
                        change(index, { amount: event.target.value })
                      }
                      value={line.amount}
                    />
                  </label>
                )}
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
                  blankLine(
                    current[current.length - 1]?.section ?? "",
                    sized ? sizeLabels.length : 0,
                  ),
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

          <details className={layout.more}>
            <summary>Standard wording (from Settings)</summary>
            <div className={layout.section}>
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
            </div>
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
