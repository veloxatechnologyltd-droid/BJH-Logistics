import { BadRequestException } from "@nestjs/common";
import type { TeamKey } from "@bjh/contracts";

/**
 * What each member of staff is measured on (Evans, 2026-11-16): results, not
 * activity. A count or a money figure (per currency), counted from the records
 * that name the person. The keys are the ones the database query produces;
 * change them together.
 */
export interface PerformanceMetric {
  key: string;
  label: string;
  team: TeamKey;
  kind: "count" | "money";
}

export const performanceMetrics: PerformanceMetric[] = [
  { key: "leads_added", label: "New leads", team: "sales", kind: "count" },
  {
    key: "customers_won",
    label: "Customers won",
    team: "sales",
    kind: "count",
  },
  {
    key: "revenue_customers",
    label: "Revenue from their customers",
    team: "sales",
    kind: "money",
  },
  {
    key: "quotes_sent",
    label: "Quotes sent",
    team: "customer_service",
    kind: "count",
  },
  {
    key: "value_quoted",
    label: "Value quoted",
    team: "customer_service",
    kind: "money",
  },
  {
    key: "quotes_accepted",
    label: "Accepted",
    team: "customer_service",
    kind: "count",
  },
  {
    key: "value_accepted",
    label: "Value accepted",
    team: "customer_service",
    kind: "money",
  },
  {
    key: "quotes_lost",
    label: "Lost",
    team: "customer_service",
    kind: "count",
  },
  {
    key: "revenue_quotes",
    label: "Invoiced from their quotes",
    team: "customer_service",
    kind: "money",
  },
  {
    key: "jobs_taken",
    label: "Jobs taken on",
    team: "operations",
    kind: "count",
  },
  {
    key: "jobs_completed",
    label: "Jobs completed",
    team: "operations",
    kind: "count",
  },
  {
    key: "milestones",
    label: "Milestones updated",
    team: "operations",
    kind: "count",
  },
  { key: "tasks_done", label: "Tasks done", team: "operations", kind: "count" },
  {
    key: "invoices_sent",
    label: "Invoices sent",
    team: "finance",
    kind: "count",
  },
  { key: "invoiced", label: "Amount invoiced", team: "finance", kind: "money" },
  {
    key: "payments_recorded",
    label: "Payments recorded",
    team: "finance",
    kind: "count",
  },
  { key: "collected", label: "Collected", team: "finance", kind: "money" },
];

/** A period of whole days (Ghana time = UTC) and the equal one just before it. */
export interface PerformanceWindow {
  from: string;
  to: string;
  previousFrom: string;
  previousTo: string;
  /** ISO instants: `end` and the previous period's end are exclusive. */
  start: string;
  end: string;
  previousStart: string;
}

const DAY = 86_400_000;
const MAX_DAYS = 366;
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const dayMs = (value: string) => Date.parse(`${value}T00:00:00.000Z`);
const realDay = (value: unknown): value is string =>
  typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  isoDay(dayMs(value)) === value;

/** Parses `from` and `to` (YYYY-MM-DD); with neither, this month so far. */
export function performanceWindow(
  fromInput: unknown,
  toInput: unknown,
  now: Date = new Date(),
): PerformanceWindow {
  const today = isoDay(now.getTime());
  const missing = (value: unknown) => value === undefined || value === "";
  if (missing(fromInput) !== missing(toInput)) {
    throw new BadRequestException("Give both from and to, or neither");
  }
  const from = missing(fromInput) ? `${today.slice(0, 8)}01` : fromInput;
  const to = missing(toInput) ? today : toInput;
  if (!realDay(from) || !realDay(to)) {
    throw new BadRequestException("from and to must be dates (YYYY-MM-DD)");
  }
  if (from > to) {
    throw new BadRequestException("from must not be after to");
  }
  const days = (dayMs(to) - dayMs(from)) / DAY + 1;
  if (days > MAX_DAYS) {
    throw new BadRequestException(`A period can be at most ${MAX_DAYS} days`);
  }
  const previousTo = isoDay(dayMs(from) - DAY);
  const previousFrom = isoDay(dayMs(from) - days * DAY);
  return {
    from,
    to,
    previousFrom,
    previousTo,
    start: `${from}T00:00:00.000Z`,
    end: `${isoDay(dayMs(to) + DAY)}T00:00:00.000Z`,
    previousStart: `${previousFrom}T00:00:00.000Z`,
  };
}
