"use client";

import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { paymentMethodKeys } from "@bjh/contracts";
import type { PaymentMethod } from "@bjh/contracts";
import { formatMoney, toMinor } from "../quotes/quoteApi";
import { popularCurrencies } from "../settings/business/BusinessSettingsForm";
import { getSettings } from "../settings/business/settingsApi";
import {
  createInvoice,
  createInvoiceFromCharges,
  fetchInvoicePdf,
  fetchReceiptPdf,
  issueInvoice,
  listInvoices,
  recordInvoicePayment,
  reverseInvoicePayment,
  updateInvoice,
  voidInvoice,
} from "./jobApi";
import type { Invoice, InvoiceLine, JobDocument } from "./jobApi";
import styles from "./jobs.module.css";
import { ErrorPopup } from "../ErrorPopup";

const methodLabels: Record<PaymentMethod, string> = {
  cash: "Cash",
  bank_transfer: "Bank transfer",
  cheque: "Cheque",
  mobile_money: "Mobile money",
  other: "Other",
};

const statusLabels: Record<Invoice["paymentStatus"], string> = {
  draft: "Draft",
  void: "Void",
  unpaid: "Unpaid",
  partial: "Part paid",
  paid: "Paid",
};

type DraftLine = { description: string; amount: string; taxable: boolean };

const today = () => new Date().toISOString().slice(0, 10);

const toDraftLines = (lines: InvoiceLine[]): DraftLine[] =>
  lines.map((line) => ({
    description: line.description,
    amount: (line.amountMinor / 100).toFixed(2),
    taxable: line.taxable,
  }));

/**
 * Customer invoices and the payments staff record against them. Customers see
 * issued invoices and their balance; staff prepare, issue, void and record
 * payments received outside the system.
 */
export function JobInvoices({
  jobId,
  documents,
  isStaff,
  canEdit,
}: {
  jobId: string;
  documents: JobDocument[];
  /** Staff may record payments even after the job is closed. */
  isStaff: boolean;
  /** Preparing, issuing and voiding invoices needs an open job. */
  canEdit: boolean;
}) {
  const [invoices, setInvoices] = useState<Invoice[] | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [currency, setCurrency] = useState("");
  const [configuredCurrencies, setConfiguredCurrencies] = useState<string[]>(
    [],
  );
  const [dueDate, setDueDate] = useState("");
  const [invoiceNotes, setInvoiceNotes] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [paying, setPaying] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [receivedOn, setReceivedOn] = useState(today());
  const [method, setMethod] = useState<PaymentMethod>("bank_transfer");
  const [reference, setReference] = useState("");
  const [evidence, setEvidence] = useState("");
  const [paymentNote, setPaymentNote] = useState("");
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    try {
      setInvoices(await listInvoices(jobId));
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Invoices could not be loaded",
      );
    }
  }, [jobId]);

  useEffect(() => {
    void load();
  }, [load]);

  // "Record payment" on the job progress list arrives with ?pay=1.
  const [payLinkHandled, setPayLinkHandled] = useState(false);
  useEffect(() => {
    if (!invoices || payLinkHandled) return;
    setPayLinkHandled(true);
    if (window.location.hash === "#invoices-title")
      document
        .getElementById("invoices-title")
        ?.scrollIntoView({ block: "start" });
    if (
      !isStaff ||
      new URLSearchParams(window.location.search).get("pay") !== "1"
    )
      return;
    const owing = invoices.find(
      (invoice) => invoice.status === "issued" && invoice.outstandingMinor > 0,
    );
    if (!owing) return;
    setPaying(owing.id);
    setAmount((owing.outstandingMinor / 100).toFixed(2));
  }, [invoices, isStaff, payLinkHandled]);

  useEffect(() => {
    if (!isStaff) return;
    getSettings()
      .then((result) => {
        if (result.current)
          setConfiguredCurrencies(result.current.settings.currencies);
      })
      .catch(() => undefined);
  }, [isStaff]);

  async function run(action: () => Promise<unknown>, after?: () => void) {
    setError("");
    setNotice("");
    try {
      await action();
      after?.();
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The action failed");
    }
  }

  async function openBlob(fetchBlob: () => Promise<Blob>) {
    // Opened first so the browser treats it as a click, not a pop-up.
    const tab = window.open("", "_blank");
    setError("");
    try {
      const url = URL.createObjectURL(await fetchBlob());
      if (tab) tab.location.href = url;
      else window.location.href = url;
    } catch (cause) {
      tab?.close();
      setError(cause instanceof Error ? cause.message : "The PDF failed");
    }
  }

  const openPdf = (invoiceId: string) =>
    openBlob(() => fetchInvoicePdf(jobId, invoiceId));
  const openReceipt = (invoiceId: string, paymentId: string) =>
    openBlob(() => fetchReceiptPdf(jobId, invoiceId, paymentId));

  function draftInput() {
    const parsed: InvoiceLine[] = [];
    for (const line of lines) {
      const minor = toMinor(line.amount);
      if (minor === undefined || Number.isNaN(minor)) {
        setError("Amounts must be numbers such as 250 or 250.50");
        return null;
      }
      parsed.push({
        description: line.description.trim(),
        amountMinor: minor,
        taxable: line.taxable,
      });
    }
    return parsed;
  }

  function submitNew(event: FormEvent) {
    event.preventDefault();
    void run(
      async () => {
        const created = await createInvoice(jobId, {
          currency: currency.trim(),
          lines: [],
          dueDate: dueDate || undefined,
          notes: invoiceNotes.trim() || undefined,
        });
        setEditing(created.id);
        setLines([{ description: "", amount: "", taxable: true }]);
        setAdding(false);
      },
      () => {
        setDueDate("");
        setInvoiceNotes("");
      },
    );
  }

  function startFromCharges() {
    if (!currency) {
      setError("Choose the invoice currency first");
      return;
    }
    void run(async () => {
      const result = await createInvoiceFromCharges(jobId, {
        currency: currency.trim(),
        dueDate: dueDate || undefined,
        notes: invoiceNotes.trim() || undefined,
      });
      setEditing(result.invoice.id);
      setLines(toDraftLines(result.invoice.lines));
      setAdding(false);
      setNotice(
        result.skipped > 0
          ? `${result.skipped} charge(s) without an amount were left out.`
          : "",
      );
    });
  }

  function saveDraft(invoice: Invoice, after?: () => Promise<unknown>) {
    const parsed = draftInput();
    if (!parsed) return;
    void run(async () => {
      await updateInvoice(jobId, invoice.id, {
        currency: invoice.currency,
        lines: parsed,
        dueDate: invoice.dueDate ?? undefined,
        notes: invoice.notes ?? undefined,
      });
      if (after) await after();
      else setEditing(null);
    });
  }

  function submitPayment(event: FormEvent, invoice: Invoice) {
    event.preventDefault();
    const minor = toMinor(amount);
    if (minor === undefined || Number.isNaN(minor)) {
      setError("Enter the amount as a number such as 250 or 250.50");
      return;
    }
    void run(
      () =>
        recordInvoicePayment(jobId, invoice.id, {
          amountMinor: minor,
          receivedOn,
          method,
          reference: reference.trim() || undefined,
          evidenceDocumentId: evidence || undefined,
          note: paymentNote.trim() || undefined,
        }),
      () => {
        setPaying(null);
        setAmount("");
        setReference("");
        setEvidence("");
        setPaymentNote("");
      },
    );
  }

  function askReason(action: (why: string) => Promise<unknown>) {
    const why = window.prompt("Reason")?.trim();
    if (!why) return;
    void run(() => action(why));
  }

  const evidenceName = (id: string | null) =>
    documents.find((item) => item.id === id)?.versions.at(-1)?.filename ??
    "document";

  if (!isStaff && (!invoices || invoices.length === 0)) return null;

  return (
    <section className={styles.card} aria-labelledby="invoices-title">
      <div className={styles.stepsHeading}>
        <h2 id="invoices-title">Invoices and payments</h2>
        {isStaff && canEdit && !adding && (
          <button
            className={styles.secondaryButton}
            onClick={() => setAdding(true)}
            type="button"
          >
            New invoice
          </button>
        )}
      </div>
      <ErrorPopup message={error} />
      {notice && <p className={styles.notice}>{notice}</p>}
      {invoices && invoices.length === 0 && (
        <p className={styles.muted}>No invoices yet.</p>
      )}
      {invoices && invoices.length > 0 && (
        <ul className={styles.invoiceList}>
          {invoices.map((invoice) => (
            <li key={invoice.id}>
              <div>
                <strong>{invoice.invoiceNumber ?? "Draft invoice"}</strong>{" "}
                <span className={styles.badge}>
                  {statusLabels[invoice.paymentStatus]}
                </span>{" "}
                {formatMoney(invoice.totalMinor, invoice.currency)}
                {invoice.status === "issued" && (
                  <>
                    {" "}
                    · paid {formatMoney(invoice.paidMinor, invoice.currency)} ·
                    owing{" "}
                    {formatMoney(invoice.outstandingMinor, invoice.currency)}
                  </>
                )}
                {invoice.dueDate ? ` · due ${invoice.dueDate}` : ""}
                {invoice.status === "void" && invoice.voidReason
                  ? ` · void: ${invoice.voidReason}`
                  : ""}
              </div>
              <span className={styles.muted}>
                {invoice.lines
                  .map(
                    (line) =>
                      `${line.description} ${formatMoney(line.amountMinor, invoice.currency)}${line.taxable ? "" : " (no tax)"}`,
                  )
                  .join(" · ")}
                {invoice.taxLines.length > 0
                  ? ` · ${invoice.taxLines
                      .map(
                        (tax) =>
                          `${tax.name} ${tax.rateBasisPoints / 100}% ${formatMoney(tax.amountMinor, invoice.currency)}`,
                      )
                      .join(" · ")}`
                  : ""}
              </span>
              {isStaff && invoice.payments && invoice.payments.length > 0 && (
                <details>
                  <summary className={styles.disclosureSummary}>
                    Payments ({invoice.payments.length})
                  </summary>
                  <ul className={styles.list}>
                    {invoice.payments.map((payment) => (
                      <li key={payment.id}>
                        {payment.reversal ? (
                          <s>
                            {formatMoney(payment.amountMinor, invoice.currency)}
                          </s>
                        ) : (
                          formatMoney(payment.amountMinor, invoice.currency)
                        )}{" "}
                        · {methodLabels[payment.method]} · {payment.receivedOn}
                        {payment.reference ? ` · ${payment.reference}` : ""}
                        {payment.evidenceDocumentId
                          ? ` · ${evidenceName(payment.evidenceDocumentId)}`
                          : ""}
                        {payment.reversal
                          ? ` · reversed: ${payment.reversal.reason}`
                          : ""}
                        {payment.receiptNumber && (
                          <>
                            {" "}
                            <button
                              className={styles.textButton}
                              onClick={() =>
                                void openReceipt(invoice.id, payment.id)
                              }
                              type="button"
                            >
                              Receipt {payment.receiptNumber}
                            </button>
                          </>
                        )}
                        {!payment.reversal && (
                          <>
                            {" "}
                            <button
                              className={styles.textButton}
                              onClick={() =>
                                askReason((why) =>
                                  reverseInvoicePayment(
                                    jobId,
                                    invoice.id,
                                    payment.id,
                                    why,
                                  ),
                                )
                              }
                              type="button"
                            >
                              Reverse
                            </button>
                          </>
                        )}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              {isStaff && canEdit && invoice.status === "draft" && (
                <div className={styles.actions}>
                  <button
                    className={styles.button}
                    onClick={() =>
                      saveDraft(invoice, () => issueInvoice(jobId, invoice.id))
                    }
                    type="button"
                  >
                    Issue invoice
                  </button>
                  <button
                    className={styles.secondaryButton}
                    onClick={() => {
                      setEditing(editing === invoice.id ? null : invoice.id);
                      setLines(toDraftLines(invoice.lines));
                    }}
                    type="button"
                  >
                    Edit lines
                  </button>
                  <button
                    className={styles.textButton}
                    onClick={() => void openPdf(invoice.id)}
                    type="button"
                  >
                    Preview PDF
                  </button>
                  <button
                    className={styles.textButton}
                    onClick={() =>
                      askReason((why) => voidInvoice(jobId, invoice.id, why))
                    }
                    type="button"
                  >
                    Discard draft
                  </button>
                </div>
              )}
              {isStaff &&
                editing === invoice.id &&
                invoice.status === "draft" && (
                  <form
                    className={styles.form}
                    onSubmit={(event) => {
                      event.preventDefault();
                      saveDraft(invoice);
                    }}
                  >
                    {lines.map((line, index) => (
                      <div className={styles.actions} key={index}>
                        <label className={styles.field}>
                          Description
                          <input
                            maxLength={300}
                            onChange={(event) =>
                              setLines(
                                lines.map((item, at) =>
                                  at === index
                                    ? {
                                        ...item,
                                        description: event.target.value,
                                      }
                                    : item,
                                ),
                              )
                            }
                            required
                            value={line.description}
                          />
                        </label>
                        <label className={styles.field}>
                          Amount ({invoice.currency})
                          <input
                            inputMode="decimal"
                            onChange={(event) =>
                              setLines(
                                lines.map((item, at) =>
                                  at === index
                                    ? { ...item, amount: event.target.value }
                                    : item,
                                ),
                              )
                            }
                            required
                            value={line.amount}
                          />
                        </label>
                        <label>
                          <input
                            checked={line.taxable}
                            onChange={(event) =>
                              setLines(
                                lines.map((item, at) =>
                                  at === index
                                    ? { ...item, taxable: event.target.checked }
                                    : item,
                                ),
                              )
                            }
                            type="checkbox"
                          />{" "}
                          Taxed
                        </label>
                        <button
                          className={styles.secondaryButton}
                          onClick={() =>
                            setLines(lines.filter((_, at) => at !== index))
                          }
                          type="button"
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                    <div className={styles.actions}>
                      <button
                        className={styles.secondaryButton}
                        onClick={() =>
                          setLines([
                            ...lines,
                            { description: "", amount: "", taxable: true },
                          ])
                        }
                        type="button"
                      >
                        Add line
                      </button>
                      <button className={styles.button} type="submit">
                        Save draft
                      </button>
                    </div>
                  </form>
                )}
              {(invoice.status !== "draft" || !(isStaff && canEdit)) && (
                <div className={styles.actions}>
                  {isStaff &&
                    invoice.status === "issued" &&
                    invoice.outstandingMinor > 0 && (
                      <button
                        className={styles.secondaryButton}
                        onClick={() => {
                          setPaying(paying === invoice.id ? null : invoice.id);
                          setAmount(
                            (invoice.outstandingMinor / 100).toFixed(2),
                          );
                        }}
                        type="button"
                      >
                        Record payment
                      </button>
                    )}
                  <button
                    className={styles.textButton}
                    onClick={() => void openPdf(invoice.id)}
                    type="button"
                  >
                    {invoice.status === "draft" ? "Preview PDF" : "PDF"}
                  </button>
                  {isStaff && canEdit && invoice.status === "issued" && (
                    <button
                      className={styles.textButton}
                      onClick={() =>
                        askReason((why) => voidInvoice(jobId, invoice.id, why))
                      }
                      type="button"
                    >
                      Void invoice
                    </button>
                  )}
                </div>
              )}

              {isStaff && paying === invoice.id && (
                <form
                  className={styles.form}
                  onSubmit={(event) => submitPayment(event, invoice)}
                >
                  <label className={styles.field}>
                    Amount received ({invoice.currency})
                    <input
                      inputMode="decimal"
                      onChange={(event) => setAmount(event.target.value)}
                      required
                      value={amount}
                    />
                  </label>
                  <label className={styles.field}>
                    Date received
                    <input
                      max={today()}
                      onChange={(event) => setReceivedOn(event.target.value)}
                      required
                      type="date"
                      value={receivedOn}
                    />
                  </label>
                  <label className={styles.field}>
                    Method
                    <select
                      onChange={(event) =>
                        setMethod(event.target.value as PaymentMethod)
                      }
                      value={method}
                    >
                      {paymentMethodKeys.map((key) => (
                        <option key={key} value={key}>
                          {methodLabels[key]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className={styles.field}>
                    Reference (optional)
                    <input
                      maxLength={200}
                      onChange={(event) => setReference(event.target.value)}
                      value={reference}
                    />
                  </label>
                  <label className={styles.field}>
                    Evidence document (optional)
                    <select
                      onChange={(event) => setEvidence(event.target.value)}
                      value={evidence}
                    >
                      <option value="">None</option>
                      {documents.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.versions.at(-1)?.filename ?? item.documentType}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className={styles.field}>
                    Note (optional)
                    <input
                      maxLength={2000}
                      onChange={(event) => setPaymentNote(event.target.value)}
                      value={paymentNote}
                    />
                  </label>
                  <button className={styles.button} type="submit">
                    Save payment
                  </button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
      {isStaff && (
        <>
          {canEdit && adding && (
            <form
              className={`${styles.form} ${styles.quickUpdateForm}`}
              onSubmit={submitNew}
            >
              <label className={styles.field}>
                Currency
                <select
                  onChange={(event) => setCurrency(event.target.value)}
                  required
                  value={currency}
                >
                  <option value="">Choose a currency</option>
                  {(configuredCurrencies.length > 0
                    ? configuredCurrencies
                    : popularCurrencies
                  ).map((code) => (
                    <option key={code} value={code}>
                      {code}
                    </option>
                  ))}
                </select>
              </label>
              <label className={styles.field}>
                Due date (optional; the settings&apos; payment terms apply
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
                  onChange={(event) => setInvoiceNotes(event.target.value)}
                  value={invoiceNotes}
                />
              </label>
              <div className={styles.formActions}>
                <button
                  className={styles.button}
                  onClick={startFromCharges}
                  type="button"
                >
                  Start from job charges
                </button>
                <button className={styles.secondaryButton} type="submit">
                  Start blank draft
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
        </>
      )}
    </section>
  );
}
