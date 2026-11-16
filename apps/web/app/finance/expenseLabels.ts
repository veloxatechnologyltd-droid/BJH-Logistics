import { expenseCategoryGroups, expensePaymentMethods } from "@bjh/contracts";

const categoryLabels = new Map<string, string>(
  expenseCategoryGroups.flatMap((group) =>
    group.categories.map((entry) => [entry.key, entry.label] as const),
  ),
);
const groupOfCategory = new Map<string, string>(
  expenseCategoryGroups.flatMap((group) =>
    group.categories.map((entry) => [entry.key, group.label] as const),
  ),
);
const methodLabels = new Map<string, string>(
  expensePaymentMethods.map((method) => [method.key, method.label]),
);

export const expenseLabel = (category: string) =>
  categoryLabels.get(category) ?? category;
export const expenseGroupLabel = (category: string) =>
  groupOfCategory.get(category) ?? "";
export const paymentMethodLabel = (method: string) =>
  methodLabels.get(method) ?? method;

export const expensePeriods = [
  { key: "this_month", label: "This month" },
  { key: "last_month", label: "Last month" },
  { key: "last_3_months", label: "Last 3 months" },
  { key: "this_year", label: "This year" },
  { key: "last_year", label: "Last year" },
  { key: "all", label: "All dates" },
  { key: "custom", label: "Choose dates" },
] as const;
export type ExpensePeriod = (typeof expensePeriods)[number]["key"];

const dateText = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

/**
 * The first and last day of a period, as YYYY-MM-DD in local time; empty for
 * no limit. "Custom" returns nothing: the person types the dates.
 */
export function periodRange(
  period: ExpensePeriod,
  today: Date = new Date(),
): { from: string; to: string } | null {
  const year = today.getFullYear();
  const month = today.getMonth();
  const monthEnd = (y: number, m: number) => new Date(y, m + 1, 0);
  switch (period) {
    case "this_month":
      return {
        from: dateText(new Date(year, month, 1)),
        to: dateText(monthEnd(year, month)),
      };
    case "last_month":
      return {
        from: dateText(new Date(year, month - 1, 1)),
        to: dateText(monthEnd(year, month - 1)),
      };
    case "last_3_months":
      return {
        from: dateText(new Date(year, month - 2, 1)),
        to: dateText(monthEnd(year, month)),
      };
    case "this_year":
      return { from: `${year}-01-01`, to: `${year}-12-31` };
    case "last_year":
      return { from: `${year - 1}-01-01`, to: `${year - 1}-12-31` };
    case "all":
      return { from: "", to: "" };
    case "custom":
      return null;
  }
}
