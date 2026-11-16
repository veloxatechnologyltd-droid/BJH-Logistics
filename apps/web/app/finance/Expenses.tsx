"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import type { FormEvent } from "react";
import {
  expenseCategoryGroups,
  expensePaymentMethods,
  restrictedExpenseGroups,
} from "@bjh/contracts";
import type {
  ExpenseCategoryKey,
  ExpenseGroupKey,
  ExpensePaymentMethod,
} from "@bjh/contracts";
import { canWorkFinance } from "../auth/roleAccess";
import { useStaffAccess } from "../auth/useStaffAccess";
import { FinanceTabs } from "../invoices/FinanceTabs";
import { chartColors, RankedBars } from "../charts/Charts";
import charts from "../charts/charts.module.css";
import { formatMoney } from "../quotes/quoteApi";
import { ErrorPopup, plainMessage } from "../ErrorPopup";
import styles from "../jobs/jobs.module.css";
import chart from "./finance.module.css";
import { listExpenses, voidExpense } from "./expenseApi";
import type { Expense, ExpenseFilters, ExpenseList } from "./expenseApi";
import {
  expenseGroupLabel,
  expenseLabel,
  expensePeriods,
  paymentMethodLabel,
  periodRange,
} from "./expenseLabels";
import type { ExpensePeriod } from "./expenseLabels";

const emptyFilters = (): ExpenseFilters => ({
  ...(periodRange("this_month") as { from: string; to: string }),
  group: "",
  category: "",
  paymentMethod: "",
  currency: "",
  search: "",
  includeVoided: false,
});

const shortDate = (value: string) =>
  new Date(`${value}T00:00:00`).toLocaleDateString("en-GH", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

/**
 * Finance → Expenses → Business expenses: what it costs to run BJH (salaries,
 * fuel, rent, tax...), not tied to a client's job. Filter by period, group,
 * category, how it was paid, currency and words; totals and the breakdown
 * follow the filters. Payroll is shown to the super admin only.
 */
export function Expenses() {
  const { status, roles } = useStaffAccess();
  const allowed = canWorkFinance(roles);
  const [period, setPeriod] = useState<ExpensePeriod>("this_month");
  const [filters, setFilters] = useState<ExpenseFilters>(emptyFilters);
  // Typing in the search box waits a moment before asking again.
  const [searchText, setSearchText] = useState("");
  const [result, setResult] = useState<ExpenseList | null>(null);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [voiding, setVoiding] = useState<Expense | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(
      () => setFilters((current) => ({ ...current, search: searchText })),
      300,
    );
    return () => window.clearTimeout(timer);
  }, [searchText]);

  useEffect(() => {
    if (status !== "ready" || !allowed) return;
    let current = true;
    listExpenses(filters)
      .then((list) => {
        if (current) {
          setResult(list);
          setError("");
        }
      })
      .catch((cause) => {
        if (current) {
          setError(
            cause instanceof Error
              ? cause.message
              : "Expenses could not be loaded",
          );
        }
      });
    return () => {
      current = false;
    };
  }, [filters, reload, status, allowed]);

  const set = (change: Partial<ExpenseFilters>) =>
    setFilters((current) => ({ ...current, ...change }));

  function choosePeriod(next: ExpensePeriod) {
    setPeriod(next);
    const range = periodRange(next);
    if (range) set(range);
  }

  function clearFilters() {
    setPeriod("this_month");
    setSearchText("");
    setFilters(emptyFilters());
  }

  const canSeePayroll = result?.canSeePayroll ?? false;
  const groups = expenseCategoryGroups.filter(
    (group) => canSeePayroll || !restrictedExpenseGroups.includes(group.key),
  );
  const categoryGroups = filters.group
    ? groups.filter((group) => group.key === filters.group)
    : groups;
  const filtered =
    filters.group ||
    filters.category ||
    filters.paymentMethod ||
    filters.currency ||
    filters.search ||
    filters.includeVoided ||
    period !== "this_month";

  // The breakdown is in one currency: the one chosen, else the biggest.
  const totals = result?.totals ?? [];
  const breakdownCurrency =
    filters.currency ||
    [...totals].sort((a, b) => b.amountMinor - a.amountMinor)[0]?.currency ||
    "";
  const breakdown = (result?.byCategory ?? [])
    .filter((row) => row.currency === breakdownCurrency)
    .slice(0, 8);

  if (status === "ready" && !allowed) {
    return (
      <main className={styles.page}>
        <p className={styles.error} role="alert">
          Expenses are for finance staff.
        </p>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Finance</h1>
        </div>
        {result && (
          <Link className={styles.button} href="/finance/expenses/new">
            Record expense
          </Link>
        )}
      </header>
      <FinanceTabs active="/finance/expenses" />
      <ErrorPopup message={plainMessage(error)} />

      <div className={chart.board}>
        <section aria-label="Filter expenses" className={chart.filters}>
          <label className={styles.field}>
            Period
            <select
              onChange={(event) =>
                choosePeriod(event.target.value as ExpensePeriod)
              }
              value={period}
            >
              {expensePeriods.map((option) => (
                <option key={option.key} value={option.key}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          {period === "custom" && (
            <>
              <label className={styles.field}>
                From
                <input
                  max={filters.to || undefined}
                  onChange={(event) => set({ from: event.target.value })}
                  type="date"
                  value={filters.from}
                />
              </label>
              <label className={styles.field}>
                To
                <input
                  min={filters.from || undefined}
                  onChange={(event) => set({ to: event.target.value })}
                  type="date"
                  value={filters.to}
                />
              </label>
            </>
          )}
          <label className={styles.field}>
            Group
            <select
              onChange={(event) =>
                set({
                  group: event.target.value as ExpenseGroupKey | "",
                  category: "",
                })
              }
              value={filters.group}
            >
              <option value="">All groups</option>
              {groups.map((group) => (
                <option key={group.key} value={group.key}>
                  {group.label}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            Category
            <select
              onChange={(event) =>
                set({ category: event.target.value as ExpenseCategoryKey | "" })
              }
              value={filters.category}
            >
              <option value="">All categories</option>
              {categoryGroups.map((group) => (
                <optgroup key={group.key} label={group.label}>
                  {group.categories.map((entry) => (
                    <option key={entry.key} value={entry.key}>
                      {entry.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            Paid with
            <select
              onChange={(event) =>
                set({
                  paymentMethod: event.target.value as
                    ExpensePaymentMethod | "",
                })
              }
              value={filters.paymentMethod}
            >
              <option value="">Any way</option>
              {expensePaymentMethods.map((method) => (
                <option key={method.key} value={method.key}>
                  {method.label}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            Currency
            <select
              onChange={(event) => set({ currency: event.target.value })}
              value={filters.currency}
            >
              <option value="">All currencies</option>
              {[
                ...new Set([
                  ...totals.map((total) => total.currency),
                  ...(filters.currency ? [filters.currency] : []),
                  "GHS",
                  "USD",
                ]),
              ]
                .sort()
                .map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
            </select>
          </label>
          <label className={styles.field}>
            Search
            <input
              onChange={(event) => setSearchText(event.target.value)}
              placeholder="Paid to, description, reference"
              type="search"
              value={searchText}
            />
          </label>
          <label className={chart.checkField}>
            <input
              checked={filters.includeVoided}
              onChange={(event) => set({ includeVoided: event.target.checked })}
              type="checkbox"
            />
            Show voided entries
          </label>
          {filtered && (
            <button
              className={styles.textButton}
              onClick={clearFilters}
              type="button"
            >
              Clear filters
            </button>
          )}
        </section>

        {!result && !error && <p className={styles.muted}>Loading…</p>}

        {result && (
          <>
            <div className={chart.expenseKpis}>
              {totals.length === 0 ? (
                <div className={chart.kpi}>
                  <span>Spent</span>
                  <strong>{formatMoney(0, filters.currency || "GHS")}</strong>
                  <small>
                    {result.expenses.length > 0
                      ? "Only voided entries match; they do not count"
                      : "No expenses match these filters"}
                  </small>
                </div>
              ) : (
                totals.map((total) => (
                  <div className={chart.kpi} key={total.currency}>
                    <span>Spent in {total.currency}</span>
                    <strong>
                      {formatMoney(total.amountMinor, total.currency)}
                    </strong>
                    <small>
                      {total.count} {total.count === 1 ? "expense" : "expenses"}
                    </small>
                  </div>
                ))
              )}
              {breakdown[0] && (
                <div className={chart.kpi}>
                  <span>Biggest cost</span>
                  <strong>{expenseLabel(breakdown[0].category)}</strong>
                  <small>
                    {formatMoney(breakdown[0].amountMinor, breakdownCurrency)}
                  </small>
                </div>
              )}
            </div>

            {breakdown.length > 1 && (
              <section
                aria-labelledby="expense-breakdown-title"
                className={charts.card}
                style={{ marginBottom: 16 }}
              >
                <h2 id="expense-breakdown-title">Where the money went</h2>
                <p className={charts.headline}>
                  Biggest categories, in {breakdownCurrency}.
                </p>
                <RankedBars
                  rows={breakdown.map((row) => ({
                    key: row.category,
                    label: expenseLabel(row.category),
                    value: row.amountMinor,
                    display: formatMoney(row.amountMinor, row.currency),
                    color: chartColors.blue,
                  }))}
                />
              </section>
            )}

            {result.expenses.length === 0 ? (
              <p className={styles.muted}>
                No expenses match these filters.
                {filtered ? " Try clearing the filters." : ""}
              </p>
            ) : (
              <>
                {result.limited && (
                  <p className={styles.notice} role="status">
                    Showing the newest {result.expenses.length.toLocaleString()}{" "}
                    entries. The totals above include them all; narrow the
                    filters to see older ones.
                  </p>
                )}
                <div className={chart.tableWrap}>
                  <table className={chart.cardTable}>
                    <thead>
                      <tr>
                        <th scope="col">Date</th>
                        <th scope="col">What for</th>
                        <th scope="col">Paid to</th>
                        <th scope="col">Paid with</th>
                        <th className={chart.num} scope="col">
                          Amount
                        </th>
                        <th scope="col">
                          <span className={chart.srOnly}>Actions</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.expenses.map((expense) => (
                        <tr
                          className={
                            expense.voidedAt ? chart.voided : undefined
                          }
                          key={expense.id}
                        >
                          <td data-label="Date">
                            {shortDate(expense.spentOn)}
                          </td>
                          <td data-label="What for">
                            <strong>{expenseLabel(expense.category)}</strong>
                            <span className={chart.customerName}>
                              {expense.description ??
                                expenseGroupLabel(expense.category)}
                            </span>
                            {expense.voidedAt && (
                              <span className={chart.customerName}>
                                Voided: {expense.voidReason}
                              </span>
                            )}
                          </td>
                          <td data-label="Paid to">
                            {expense.payee ?? "-"}
                            {expense.reference && (
                              <span className={chart.customerName}>
                                Ref. {expense.reference}
                              </span>
                            )}
                          </td>
                          <td data-label="Paid with">
                            {paymentMethodLabel(expense.paymentMethod)}
                            {expense.recordedByName && (
                              <span className={chart.customerName}>
                                By {expense.recordedByName}
                              </span>
                            )}
                          </td>
                          <td className={chart.num} data-label="Amount">
                            {formatMoney(expense.amountMinor, expense.currency)}
                          </td>
                          <td>
                            {!expense.voidedAt && (
                              <button
                                className={styles.textButton}
                                onClick={() => setVoiding(expense)}
                                type="button"
                              >
                                Void
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </>
        )}
      </div>

      <VoidExpense
        expense={voiding}
        onClose={() => setVoiding(null)}
        onVoided={() => {
          setVoiding(null);
          setReload((count) => count + 1);
        }}
      />
    </main>
  );
}

/** Voiding keeps the entry on record, struck through, with the reason given. */
function VoidExpense({
  expense,
  onClose,
  onVoided,
}: {
  expense: Expense | null;
  onClose: () => void;
  onVoided: () => void;
}) {
  const titleId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (expense) {
      setReason("");
      setError("");
      dialog.current?.showModal();
    } else {
      dialog.current?.close();
    }
  }, [expense]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!expense || !reason.trim()) return;
    setSaving(true);
    try {
      await voidExpense(expense.id, reason);
      onVoided();
    } catch (cause) {
      setError(
        plainMessage(
          cause instanceof Error ? cause.message : "The expense was not voided",
        ),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <dialog
      aria-labelledby={titleId}
      className={styles.dialog}
      onCancel={onClose}
      ref={dialog}
    >
      {expense && (
        <form className={styles.form} onSubmit={submit}>
          <h2 id={titleId}>Void this expense?</h2>
          <p className={styles.muted}>
            {expenseLabel(expense.category)},{" "}
            {formatMoney(expense.amountMinor, expense.currency)} on{" "}
            {shortDate(expense.spentOn)}. It stays on record, crossed out, and
            no longer counts in the totals.
          </p>
          <label className={styles.field}>
            Why?
            <input
              maxLength={300}
              onChange={(event) => setReason(event.target.value)}
              placeholder="e.g. Recorded twice, wrong amount"
              required
              value={reason}
            />
          </label>
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
          <div className={styles.actions}>
            <button
              className={styles.button}
              disabled={saving || !reason.trim()}
              type="submit"
            >
              Void expense
            </button>
            <button
              className={styles.secondaryButton}
              onClick={onClose}
              type="button"
            >
              Keep it
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
}
