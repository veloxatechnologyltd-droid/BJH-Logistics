import { BadRequestException } from "@nestjs/common";
import type { TeamKey } from "@bjh/contracts";

/**
 * What each staff member's performance is measured on (Evans, 2026-11-16): things a person did,
 * counted from the records that already name them. A metric belongs to a team,
 * or to "all" when everyone can do it. The keys are the ones the database query
 * produces; change them together.
 */
export interface PerformanceMetric {
  key: string;
  label: string;
  team: TeamKey | "all";
}

export const performanceMetrics: PerformanceMetric[] = [
  { key: "leads_added", label: "Leads added", team: "sales" },
  { key: "lead_followups", label: "Follow-ups logged", team: "sales" },
  { key: "leads_won", label: "Leads won", team: "sales" },
  { key: "prospects_promoted", label: "Prospects promoted", team: "sales" },
  { key: "emails_sent", label: "Emails sent", team: "sales" },
  {
    key: "requests_answered",
    label: "Requests answered",
    team: "customer_service",
  },
  { key: "quotes_issued", label: "Quotes issued", team: "customer_service" },
  {
    key: "quotes_accepted",
    label: "Quotes accepted",
    team: "customer_service",
  },
  {
    key: "quotes_rejected",
    label: "Quotes rejected",
    team: "customer_service",
  },
  {
    key: "client_messages",
    label: "Client messages sent",
    team: "customer_service",
  },
  { key: "jobs_opened", label: "Jobs opened", team: "customer_service" },
  { key: "milestones", label: "Milestones recorded", team: "operations" },
  { key: "status_changes", label: "Status changes", team: "operations" },
  {
    key: "documents_uploaded",
    label: "Documents uploaded",
    team: "operations",
  },
  { key: "etas_recorded", label: "ETAs recorded", team: "operations" },
  {
    key: "deliveries_dispatched",
    label: "Deliveries dispatched",
    team: "operations",
  },
  { key: "invoices_issued", label: "Invoices issued", team: "finance" },
  { key: "payments_recorded", label: "Payments recorded", team: "finance" },
  { key: "costs_recorded", label: "Costs recorded", team: "finance" },
  { key: "tasks_done", label: "Tasks completed", team: "all" },
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
