import type {
  ExpenseCategoryKey,
  ExpenseGroupKey,
  ExpensePaymentMethod,
} from "@bjh/contracts";
import { authenticatedFetch } from "../auth/authenticatedFetch";

export type Expense = {
  id: string;
  spentOn: string;
  category: ExpenseCategoryKey;
  description: string | null;
  payee: string | null;
  amountMinor: number;
  currency: string;
  paymentMethod: ExpensePaymentMethod;
  reference: string | null;
  note: string | null;
  recordedByName: string | null;
  recordedAt: string;
  voidedAt: string | null;
  voidReason: string | null;
};

export type ExpenseList = {
  expenses: Expense[];
  /** More match than are listed; the totals still cover them all. */
  limited: boolean;
  totals: Array<{ currency: string; amountMinor: number; count: number }>;
  byCategory: Array<{
    category: ExpenseCategoryKey;
    currency: string;
    amountMinor: number;
  }>;
  canSeePayroll: boolean;
};

export type ExpenseFilters = {
  from: string;
  to: string;
  group: ExpenseGroupKey | "";
  category: ExpenseCategoryKey | "";
  paymentMethod: ExpensePaymentMethod | "";
  currency: string;
  search: string;
  includeVoided: boolean;
};

const apiBaseUrl =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:3001/api";
const expensesUrl = `${apiBaseUrl.replace(/\/$/, "")}/v1/finance/expenses`;

async function send<T>(path: string, method: string, body?: unknown) {
  const response = await authenticatedFetch(`${expensesUrl}${path}`, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const failure = (await response.json().catch(() => null)) as {
      message?: string | string[];
    } | null;
    const message = Array.isArray(failure?.message)
      ? failure.message.join(", ")
      : failure?.message;
    throw new Error(message ?? "The request could not be completed");
  }
  return (await response.json()) as T;
}

/** Empty filters are left out, so the API applies only the ones chosen. */
export function listExpenses(filters: ExpenseFilters) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (typeof value === "boolean") {
      if (value) query.set(key, "true");
    } else if (value.trim()) {
      query.set(key, value.trim());
    }
  }
  const text = query.toString();
  return send<ExpenseList>(text ? `?${text}` : "", "GET");
}

export const recordExpense = (expense: {
  spentOn: string;
  category: ExpenseCategoryKey;
  description: string;
  payee: string;
  amountMinor: number;
  currency: string;
  paymentMethod: ExpensePaymentMethod;
  reference: string;
  note: string;
}) => send<Expense>("", "POST", expense);

export const voidExpense = (id: string, reason: string) =>
  send<Expense>(`/${encodeURIComponent(id)}/void`, "POST", { reason });
