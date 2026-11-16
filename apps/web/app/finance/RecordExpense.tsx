"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import {
  expenseCategoryGroups,
  expenseGroupOf,
  expensePaymentMethods,
  restrictedExpenseGroups,
} from "@bjh/contracts";
import type { ExpenseCategoryKey, ExpensePaymentMethod } from "@bjh/contracts";
import { canWorkFinance } from "../auth/roleAccess";
import { useStaffAccess } from "../auth/useStaffAccess";
import { FinanceTabs } from "../invoices/FinanceTabs";
import { getSettings } from "../settings/business/settingsApi";
import { popularCurrencies } from "../settings/business/BusinessSettingsForm";
import { formatMoney, toMinor } from "../quotes/quoteApi";
import { ErrorPopup, plainMessage } from "../ErrorPopup";
import styles from "../jobs/jobs.module.css";
import chart from "./finance.module.css";
import { expenseLabel } from "./expenseLabels";
import { recordExpense } from "./expenseApi";

const localToday = () => {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};

/** Who is usually paid, by group, to hint what goes in "Paid to". */
const payeeHints: Record<string, string> = {
  payroll: "Staff member, or SSNIT / GRA",
  vehicles: "Fuel station, mechanic or supplier",
  operations: "Supplier or worker",
  premises: "Landlord, ECG, Ghana Water, provider",
  taxes: "GRA, assembly or authority",
  admin: "Supplier or firm",
  finance: "Bank or lender",
  other: "Who was paid",
};

/**
 * Finance → Expenses → Record expense: a page of its own. "Save" goes back to
 * the list; "Save and add another" stays, keeping the date, category,
 * currency and payment method for entering a batch of receipts. Payroll
 * categories are offered to the super admin only (the API enforces it too).
 */
export function RecordExpense() {
  const router = useRouter();
  const { status, roles, isSuperAdmin } = useStaffAccess();
  const allowed = canWorkFinance(roles);
  const amountInput = useRef<HTMLInputElement>(null);
  const [currencies, setCurrencies] = useState<string[]>(popularCurrencies);
  const [spentOn, setSpentOn] = useState(localToday);
  const [category, setCategory] = useState<ExpenseCategoryKey | "">("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("GHS");
  const [paymentMethod, setPaymentMethod] =
    useState<ExpensePaymentMethod>("cash");
  const [payee, setPayee] = useState("");
  const [description, setDescription] = useState("");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (status !== "ready" || !allowed) return;
    getSettings()
      .then((result) => {
        const configured = result.current?.settings.currencies ?? [];
        if (configured.length > 0) setCurrencies(configured);
      })
      // The usual currencies are offered when settings cannot be read.
      .catch(() => undefined);
  }, [status, allowed]);

  const amountMinor = toMinor(amount);
  const group = category ? expenseGroupOf(category) : null;
  const needsDescription = category === "other";
  const ready =
    Boolean(category) &&
    typeof amountMinor === "number" &&
    !Number.isNaN(amountMinor) &&
    amountMinor > 0 &&
    Boolean(spentOn) &&
    (!needsDescription || description.trim() !== "");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ready || !category || amountMinor === undefined) return;
    // The button pressed decides whether to stay for the next one.
    const another =
      (event.nativeEvent as SubmitEvent).submitter?.getAttribute(
        "data-another",
      ) === "true";
    setSaving(true);
    setError("");
    try {
      const saved = await recordExpense({
        spentOn,
        category,
        description,
        payee,
        amountMinor,
        currency,
        paymentMethod,
        reference,
        note,
      });
      if (!another) {
        router.push("/finance/expenses");
        return;
      }
      setNotice(
        `Saved: ${expenseLabel(saved.category)}, ${formatMoney(saved.amountMinor, saved.currency)}. Enter the next one.`,
      );
      setAmount("");
      setPayee("");
      setDescription("");
      setReference("");
      setNote("");
      amountInput.current?.focus();
    } catch (cause) {
      setError(
        plainMessage(
          cause instanceof Error ? cause.message : "The expense was not saved",
        ),
      );
    } finally {
      setSaving(false);
    }
  }

  if (status === "ready" && !allowed) {
    return (
      <main className={styles.page}>
        <p className={styles.error} role="alert">
          Expenses are for finance staff.
        </p>
      </main>
    );
  }

  const currencyChoices = [...new Set([currency, ...currencies])];

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <Link className={styles.link} href="/finance/expenses">
            ← Business expenses
          </Link>
          <h1 className={styles.title}>Record an expense</h1>
        </div>
      </header>
      <FinanceTabs active="/finance/expenses" />
      <ErrorPopup message={error} />

      <form
        className={`${styles.card} ${styles.form} ${chart.expenseForm}`}
        onSubmit={submit}
      >
        {notice && (
          <p className={styles.notice} role="status">
            {notice}
          </p>
        )}

        <fieldset className={chart.formSection}>
          <legend>What was it for?</legend>
          <label className={styles.field}>
            Category
            <select
              onChange={(event) =>
                setCategory(event.target.value as ExpenseCategoryKey)
              }
              required
              value={category}
            >
              <option value="">Choose a category</option>
              {expenseCategoryGroups
                .filter(
                  (entry) =>
                    isSuperAdmin ||
                    !restrictedExpenseGroups.includes(entry.key),
                )
                .map((entry) => (
                  <optgroup key={entry.key} label={entry.label}>
                    {entry.categories.map((option) => (
                      <option key={option.key} value={option.key}>
                        {option.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
            </select>
          </label>
          <label className={styles.field}>
            {needsDescription ? "Description" : "Description (optional)"}
            <input
              maxLength={300}
              onChange={(event) => setDescription(event.target.value)}
              placeholder={
                needsDescription
                  ? "Say what it was"
                  : "e.g. Diesel for the Tema delivery truck"
              }
              required={needsDescription}
              value={description}
            />
          </label>
        </fieldset>

        <fieldset className={chart.formSection}>
          <legend>How much, and when</legend>
          <div className={chart.formPair}>
            <label className={styles.field}>
              Amount
              <input
                inputMode="decimal"
                onChange={(event) => setAmount(event.target.value)}
                placeholder="0.00"
                ref={amountInput}
                required
                value={amount}
              />
            </label>
            <label className={styles.field}>
              Currency
              <select
                onChange={(event) => setCurrency(event.target.value)}
                value={currency}
              >
                {currencyChoices.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {Number.isNaN(amountMinor) && (
            <p className={styles.error}>
              Type the amount as a number, e.g. 250 or 250.50.
            </p>
          )}
          <div className={chart.formPair}>
            <label className={styles.field}>
              Date paid
              <input
                max={localToday()}
                onChange={(event) => setSpentOn(event.target.value)}
                required
                type="date"
                value={spentOn}
              />
            </label>
            <label className={styles.field}>
              Paid with
              <select
                onChange={(event) =>
                  setPaymentMethod(event.target.value as ExpensePaymentMethod)
                }
                value={paymentMethod}
              >
                {expensePaymentMethods.map((method) => (
                  <option key={method.key} value={method.key}>
                    {method.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </fieldset>

        <fieldset className={chart.formSection}>
          <legend>Who was paid</legend>
          <div className={chart.formPair}>
            <label className={styles.field}>
              Paid to (optional)
              <input
                maxLength={200}
                onChange={(event) => setPayee(event.target.value)}
                placeholder={payeeHints[group ?? "other"]}
                value={payee}
              />
            </label>
            <label className={styles.field}>
              Receipt or reference number (optional)
              <input
                maxLength={200}
                onChange={(event) => setReference(event.target.value)}
                placeholder="Receipt, invoice or MoMo ID"
                value={reference}
              />
            </label>
          </div>
          <label className={styles.field}>
            Note (optional)
            <textarea
              maxLength={2000}
              onChange={(event) => setNote(event.target.value)}
              rows={3}
              value={note}
            />
          </label>
        </fieldset>

        <div className={styles.actions}>
          <button
            className={styles.button}
            disabled={saving || !ready}
            type="submit"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          <button
            className={styles.secondaryButton}
            data-another="true"
            disabled={saving || !ready}
            type="submit"
          >
            Save and add another
          </button>
          <Link className={styles.secondaryButton} href="/finance/expenses">
            Cancel
          </Link>
        </div>
      </form>
    </main>
  );
}
