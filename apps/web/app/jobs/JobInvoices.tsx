"use client";

import { useCallback, useEffect, useState } from "react";
import { ChargeOptions } from "../ChargeOptions";
import type { PaymentMethod } from "@bjh/contracts";
import { formatMoney, toMinor } from "../quotes/quoteApi";
import { popularCurrencies } from "../settings/business/BusinessSettingsForm";
import { getSettings } from "../settings/business/settingsApi";
import { canWorkFinance } from "../auth/roleAccess";
import { useStaffAccess } from "../auth/useStaffAccess";
import {
  acceptInvoice,
  fetchInvoicePdf,
  fetchReceiptPdf,
  issueInvoice,
  listInvoices,
  reverseInvoicePayment,
  sendReceipt,
  updateInvoice,
  voidInvoice,
} from "./jobApi";
import type { Invoice, InvoiceLine, JobDocument } from "./jobApi";
import styles from "./jobs.module.css";
import { ErrorPopup } from "../ErrorPopup";
import Link from "next/link";

export const methodLabels: Record<PaymentMethod, string> = {
  cash: "Cash",
  bank_transfer: "Bank transfer",
  cheque: "Cheque",
  mobile_money: "Mobile money",
  other: "Other",
};

export const invoiceStatusLabels: Record<Invoice["paymentStatus"], string> = {
  draft: "Draft",
  void: "Void",
  unpaid: "Unpaid",
  partial: "Part paid",
  paid: "Paid",
};

/** A line as typed: an amount, or a quantity and a unit price. */
type DraftLine = {
  description: string;
  quantity: string;
  unit: string;
  amount: string;
  taxable: boolean;
};

const blankLine = (): DraftLine => ({
  description: "",
  quantity: "",
  unit: "",
  amount: "",
  taxable: true,
});

/** "1,250.5" as a number; NaN when it is not one. */
const readQuantity = (text: string) => {
  const cleaned = text.replace(/[,\s]/g, "");
  return /^\d+(\.\d{1,3})?$/.test(cleaned) ? Number(cleaned) : Number.NaN;
};

/** The line's amount in minor units as typed, or null while it cannot be worked out. */
const lineMinor = (line: DraftLine): number | null => {
  if (line.quantity.trim() || line.unit.trim()) {
    const quantity = readQuantity(line.quantity);
    const unit = toMinor(line.unit);
    if (Number.isNaN(quantity) || unit === undefined || Number.isNaN(unit)) {
      return null;
    }
    return Math.round(quantity * unit);
  }
  const minor = toMinor(line.amount);
  return minor === undefined || Number.isNaN(minor) ? null : minor;
};

const toDraftLines = (lines: InvoiceLine[]): DraftLine[] =>
  lines.map((line) => ({
    description: line.description,
    quantity:
      line.quantity != null && line.unitAmountMinor != null
        ? String(line.quantity)
        : "",
    unit:
      line.quantity != null && line.unitAmountMinor != null
        ? (line.unitAmountMinor / 100).toFixed(2)
        : "",
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
  invoiceId,
  onLoaded,
}: {
  jobId: string;
  documents: JobDocument[];
  /** Staff may record payments even after the job is closed. */
  isStaff: boolean;
  /** Preparing, issuing and voiding invoices needs an open job. */
  canEdit: boolean;
  /** Finance's invoice page: show only this invoice, its draft editor open. */
  invoiceId?: string;
  /** Told the job's invoices each time they are (re)loaded. */
  onLoaded?: (invoices: Invoice[]) => void;
}) {
  const [invoices, setInvoices] = useState<Invoice[] | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [configuredCurrencies, setConfiguredCurrencies] = useState<string[]>(
    [],
  );
  const [editing, setEditing] = useState<string | null>(null);
  const [lines, setLines] = useState<DraftLine[]>([]);
  // The currency of the draft being edited; it can still be changed.
  const [draftCurrency, setDraftCurrency] = useState("");
  const [accepting, setAccepting] = useState<string | null>(null);
  const [signatory, setSignatory] = useState("");
  const { roles, isSuperAdmin } = useStaffAccess();
  // Finance, customer service (who does BJH's finance work) and the super
  // admin reach this tab on the staff side. The client accepts in the portal;
  // on the staff side customer service or the super admin records it.
  const finance = isStaff && canWorkFinance(roles);
  const canRecordAcceptance =
    !isStaff || isSuperAdmin || roles.includes("customer_service_rep");

  const load = useCallback(async () => {
    try {
      const found = await listInvoices(jobId);
      setInvoices(found);
      onLoaded?.(found);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Invoices could not be loaded",
      );
    }
  }, [jobId, onLoaded]);

  useEffect(() => {
    void load();
  }, [load]);

  // Finance's invoice page opens a draft with its editor ready.
  const [linkHandled, setLinkHandled] = useState(false);
  useEffect(() => {
    if (!invoices || linkHandled) return;
    setLinkHandled(true);
    const linked = invoices.find((invoice) => invoice.id === invoiceId);
    if (finance && canEdit && linked?.status === "draft") {
      setEditing(linked.id);
      setDraftCurrency(linked.currency);
      setLines(
        linked.lines.length > 0 ? toDraftLines(linked.lines) : [blankLine()],
      );
    }
  }, [invoices, finance, canEdit, linkHandled, invoiceId]);

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

  function draftInput(from: DraftLine[]) {
    const parsed: InvoiceLine[] = [];
    for (const line of from) {
      const priced = Boolean(line.quantity.trim() || line.unit.trim());
      const minor = lineMinor(line);
      if (minor === null) {
        setError(
          priced
            ? `"${line.description || "A line"}" needs a quantity such as 2 or 1.5 and a unit price such as 250.50`
            : "Amounts must be numbers such as 250 or 250.50",
        );
        return null;
      }
      parsed.push(
        priced
          ? {
              description: line.description.trim(),
              quantity: readQuantity(line.quantity),
              unitAmountMinor: toMinor(line.unit)!,
              amountMinor: minor,
              taxable: line.taxable,
            }
          : {
              description: line.description.trim(),
              amountMinor: minor,
              taxable: line.taxable,
            },
      );
    }
    return parsed;
  }

  function saveDraft(invoice: Invoice, after?: () => Promise<unknown>) {
    // Only the draft open in the editor takes the typed lines and currency;
    // issuing another draft keeps its own saved lines.
    const open = editing === invoice.id;
    const parsed = draftInput(open ? lines : toDraftLines(invoice.lines));
    if (!parsed) return;
    void run(async () => {
      await updateInvoice(jobId, invoice.id, {
        currency: open && draftCurrency ? draftCurrency : invoice.currency,
        lines: parsed,
        dueDate: invoice.dueDate ?? undefined,
        notes: invoice.notes ?? undefined,
      });
      if (after) await after();
      else setEditing(null);
    });
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
  const shown = invoiceId
    ? (invoices ?? []).filter((invoice) => invoice.id === invoiceId)
    : invoices;

  return (
    <section
      className={styles.card}
      aria-label={invoiceId ? "Invoice" : "Invoices and payments"}
    >
      {/* Finance's invoice page has its own title. */}
      {!invoiceId && <h2>Invoices and payments</h2>}
      <ErrorPopup message={error} />
      {notice && <p className={styles.notice}>{notice}</p>}
      {shown && shown.length === 0 && (
        <p className={styles.muted}>
          {invoiceId ? "This invoice was not found." : "No invoices yet."}
        </p>
      )}
      {shown && shown.length > 0 && (
        <ul className={styles.invoiceList}>
          {shown.map((invoice) => (
            <li key={invoice.id}>
              <div>
                <strong>{invoice.invoiceNumber ?? "Draft invoice"}</strong>{" "}
                <span className={styles.badge}>
                  {invoiceStatusLabels[invoice.paymentStatus]}
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
              {invoice.acceptance && (
                <span className={styles.muted}>
                  Accepted by {invoice.acceptance.signatoryName} on{" "}
                  {new Date(invoice.acceptance.acceptedAt).toLocaleDateString()}
                  {invoice.acceptance.via === "portal"
                    ? " in the portal"
                    : " (recorded by staff)"}
                </span>
              )}
              {/* While the lines are open for editing, the editor shows them. */}
              {editing !== invoice.id && (
                <span className={styles.muted}>
                  {invoice.lines
                    .map(
                      (line) =>
                        `${line.description}${line.quantity != null && line.unitAmountMinor != null ? ` ${line.quantity} × ${formatMoney(line.unitAmountMinor, invoice.currency)} =` : ""} ${formatMoney(line.amountMinor, invoice.currency)}${line.taxable ? "" : " (no tax)"}`,
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
              )}
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
                            {!payment.reversal && (
                              <button
                                className={styles.textButton}
                                onClick={() =>
                                  void run(
                                    () =>
                                      sendReceipt(
                                        jobId,
                                        invoice.id,
                                        payment.id,
                                      ),
                                    () =>
                                      setNotice(
                                        `Receipt ${payment.receiptNumber} is on its way to the client.`,
                                      ),
                                  )
                                }
                                type="button"
                              >
                                Email receipt
                              </button>
                            )}
                          </>
                        )}
                        {finance && canEdit && !payment.reversal && (
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
              {finance && canEdit && invoice.status === "draft" && (
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
                      setDraftCurrency(invoice.currency);
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
              {finance &&
                editing === invoice.id &&
                invoice.status === "draft" && (
                  <form
                    className={styles.form}
                    onSubmit={(event) => {
                      event.preventDefault();
                      saveDraft(invoice);
                    }}
                  >
                    <label className={styles.field}>
                      Invoice currency
                      <select
                        onChange={(event) =>
                          setDraftCurrency(event.target.value)
                        }
                        value={draftCurrency || invoice.currency}
                      >
                        {[
                          ...new Set([
                            invoice.currency,
                            ...(configuredCurrencies.length > 0
                              ? configuredCurrencies
                              : popularCurrencies),
                          ]),
                        ].map((code) => (
                          <option key={code} value={code}>
                            {code}
                          </option>
                        ))}
                      </select>
                    </label>
                    {lines.map((line, index) => (
                      <div className={styles.actions} key={index}>
                        <label className={styles.field}>
                          Description
                          <input
                            list="invoice-charge-options"
                            placeholder="Pick or type any charge"
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
                          Qty
                          <input
                            inputMode="decimal"
                            onChange={(event) =>
                              setLines(
                                lines.map((item, at) =>
                                  at === index
                                    ? { ...item, quantity: event.target.value }
                                    : item,
                                ),
                              )
                            }
                            size={6}
                            value={line.quantity}
                          />
                        </label>
                        <label className={styles.field}>
                          Unit price
                          <input
                            inputMode="decimal"
                            onChange={(event) =>
                              setLines(
                                lines.map((item, at) =>
                                  at === index
                                    ? { ...item, unit: event.target.value }
                                    : item,
                                ),
                              )
                            }
                            size={10}
                            value={line.unit}
                          />
                        </label>
                        <label className={styles.field}>
                          Amount ({draftCurrency || invoice.currency})
                          {line.quantity.trim() || line.unit.trim() ? (
                            <output>
                              {lineMinor(line) === null
                                ? "—"
                                : formatMoney(
                                    lineMinor(line)!,
                                    draftCurrency || invoice.currency,
                                  )}
                            </output>
                          ) : (
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
                          )}
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
                    <ChargeOptions id="invoice-charge-options" />
                    <div className={styles.actions}>
                      <button
                        className={styles.secondaryButton}
                        onClick={() => setLines([...lines, blankLine()])}
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
              {(invoice.status !== "draft" || !(finance && canEdit)) && (
                <div className={styles.actions}>
                  {finance &&
                    canEdit &&
                    invoice.status === "issued" &&
                    invoice.outstandingMinor > 0 && (
                      <Link
                        className={styles.secondaryButton}
                        href={`/finance/receipts?invoice=${invoice.id}`}
                      >
                        Record payment
                      </Link>
                    )}
                  {canRecordAcceptance &&
                    invoice.status === "issued" &&
                    !invoice.acceptance && (
                      <button
                        className={styles.secondaryButton}
                        onClick={() =>
                          setAccepting(
                            accepting === invoice.id ? null : invoice.id,
                          )
                        }
                        type="button"
                      >
                        {isStaff
                          ? "Record client acceptance"
                          : "Accept invoice"}
                      </button>
                    )}
                  <button
                    className={styles.textButton}
                    onClick={() => void openPdf(invoice.id)}
                    type="button"
                  >
                    {invoice.status === "draft" ? "Preview PDF" : "PDF"}
                  </button>
                  {/* The API refuses to void while payments stand; reverse them first. */}
                  {finance &&
                    canEdit &&
                    invoice.status === "issued" &&
                    invoice.paidMinor === 0 && (
                      <button
                        className={styles.textButton}
                        onClick={() =>
                          askReason((why) =>
                            voidInvoice(jobId, invoice.id, why),
                          )
                        }
                        type="button"
                      >
                        Void invoice
                      </button>
                    )}
                </div>
              )}

              {accepting === invoice.id && (
                <form
                  className={styles.form}
                  onSubmit={(event) => {
                    event.preventDefault();
                    void run(
                      () => acceptInvoice(jobId, invoice.id, signatory.trim()),
                      () => {
                        setAccepting(null);
                        setSignatory("");
                      },
                    );
                  }}
                >
                  <label className={styles.field}>
                    {isStaff
                      ? "Name of the person at the client who accepted"
                      : "Your name"}
                    <input
                      onChange={(event) => setSignatory(event.target.value)}
                      required
                      value={signatory}
                    />
                  </label>
                  <div className={styles.actions}>
                    <button className={styles.button} type="submit">
                      {isStaff ? "Save acceptance" : "Accept invoice"}
                    </button>
                    <button
                      className={styles.secondaryButton}
                      onClick={() => setAccepting(null)}
                      type="button"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
