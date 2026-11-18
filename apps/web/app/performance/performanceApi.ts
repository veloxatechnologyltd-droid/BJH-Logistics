import { authenticatedFetch } from "../auth/authenticatedFetch";

const apiBaseUrl = (
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:3001/api"
).replace(/\/$/, "");
const performanceUrl = `${apiBaseUrl}/v1/performance`;

export type TeamKey = "sales" | "customer_service" | "operations" | "finance";
export type Period = "daily" | "weekly";

export const teamLabels: Record<TeamKey, string> = {
  sales: "Sales",
  customer_service: "Customer Service",
  operations: "Operations",
  finance: "Finance",
};

/** The client's seven departments, as on their tracker form. */
export type Department =
  | "customer_service"
  | "operations"
  | "documentation"
  | "field_operations"
  | "finance"
  | "transport"
  | "sales_marketing";
export const departmentLabels: Record<Department, string> = {
  customer_service: "Customer Service",
  operations: "Operations",
  documentation: "Documentation",
  field_operations: "Field / Operations",
  finance: "Accounts / Finance",
  transport: "Drivers / Transport",
  sales_marketing: "Sales & Marketing",
};
/** What each department reports in its weekly figure (the client's wording). */
export const departmentMeasures: Record<Department, string> = {
  customer_service:
    "Enquiries / updates on time, complaints resolved and customer satisfaction.",
  operations:
    "On-time deliveries, release-to-delivery hours and storage / detention exceptions.",
  documentation:
    "Complete files, first-pass accuracy, on-time submissions and archiving.",
  field_operations:
    "Tasks on time, repeat visits, evidence returned and damage / safety incidents.",
  finance:
    "Invoices on time, collections against due, reconciled jobs and unretired advances. Include the currency.",
  transport:
    "Deliveries on time, signed PODs returned, km per litre and vehicle / safety incidents.",
  sales_marketing:
    "Qualified leads, quotations sent, follow-ups on time, new paying clients and BJH service fees collected. Include the currency; leave out duty, freight and pass-through costs.",
};
export type JobUpdateStatus =
  "not_started" | "in_progress" | "blocked" | "completed";
export const jobUpdateStatusLabels: Record<JobUpdateStatus, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  blocked: "Blocked / awaiting action",
  completed: "Completed",
};
/** One job update in a daily report, as sent. */
export type JobUpdate = {
  jobId: string | null;
  jobReference: string | null;
  client: string | null;
  workDone: string;
  agreedDeadline: string | null;
  nextAction: string;
  nextActionUserId: string | null;
  nextActionName: string | null;
  followUpDate: string | null;
  evidence: string | null;
  status: JobUpdateStatus;
};
export type JobUpdateInput = Omit<JobUpdate, "jobReference" | "nextActionName">;

/** One thing the system recorded the person doing. */
export type ActivityItem = {
  at: string;
  kind:
    | "lead_added"
    | "customer_won"
    | "quote_sent"
    | "quote_accepted"
    | "quote_lost"
    | "job_taken"
    | "job_completed"
    | "milestone"
    | "task_done"
    | "invoice_sent"
    | "payment_recorded";
  reference: string | null;
  party: string | null;
  detail: string | null;
  currency: string | null;
  amountMinor: number | null;
};

/** A result: this day or week so far, and yesterday or last week. */
export type ActivityMetric = {
  key: string;
  label: string;
  kind: "count" | "money";
  current: number;
  previous: number;
  money?: MoneyFigure;
};

export type ReportActivity = {
  metrics: ActivityMetric[];
  items: ActivityItem[];
};

export type PerformanceReport = {
  id: string;
  authorName: string;
  mine: boolean;
  teamKey: TeamKey;
  period: Period;
  /** The day, or the Monday of the week. */
  periodStart: string;
  newCount: number;
  completedCount: number;
  overdueCount: number;
  blockers: string | null;
  notes: string | null;
  summary: string | null;
  plan: string | null;
  activity: ReportActivity | null;
  department: Department | null;
  jobUpdates: JobUpdate[] | null;
  openingActive: number | null;
  closingActive: number | null;
  kpiTarget: string | null;
  kpiActual: string | null;
  kpiAction: string | null;
  createdAt: string;
};

/** What a report would say right now, with the teams this person may report for. */
export type ReportPreview = {
  period: Period;
  periodStart: string;
  through: string;
  teamKey: TeamKey;
  teams: TeamKey[];
  /** The department the form starts on. */
  department: Department;
  openingActive: number;
  newCount: number;
  completedCount: number;
  closingActive: number;
  overdueCount: number;
  activity: ReportActivity;
  submitted: PerformanceReport | null;
};

/** Who has and has not reported for the current day or week. */
export type RosterSlice = {
  periodStart: string;
  expected: number;
  reported: number;
  missing: Array<{ userId: string; name: string; teams: TeamKey[] }>;
};
export type Roster = {
  /** Only the super admin gets the roster. */
  manager: boolean;
  daily?: RosterSlice;
  weekly?: RosterSlice;
};

async function read<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      message?: string;
    } | null;
    throw new Error(body?.message ?? "The request could not be completed");
  }
  return (await response.json()) as T;
}

export const getPreview = (period: Period, teamKey?: TeamKey) =>
  authenticatedFetch(
    `${performanceUrl}/preview?${new URLSearchParams({
      period,
      ...(teamKey ? { teamKey } : {}),
    })}`,
  ).then((response) => read<ReportPreview>(response));

export const getRoster = () =>
  authenticatedFetch(`${performanceUrl}/roster`).then((response) =>
    read<Roster>(response),
  );

export const listReports = (filter: {
  teamKey: string;
  period: string;
  blockers: string;
}) =>
  authenticatedFetch(
    `${performanceUrl}?${new URLSearchParams(
      Object.entries(filter).filter(([, value]) => value),
    )}`,
  ).then((response) => read<PerformanceReport[]>(response));

export const submitReport = (input: {
  period: Period;
  teamKey?: TeamKey;
  department: Department;
  jobUpdates?: JobUpdateInput[];
  summary?: string;
  kpiTarget?: string;
  kpiActual?: string;
  kpiAction?: string;
  blockers?: string;
  plan?: string;
}) =>
  authenticatedFetch(performanceUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  }).then((response) => read<PerformanceReport>(response));

/** Money per currency, in minor units, for the period and the one before. */
export type MoneyFigure = Array<{
  currency: string;
  current: number;
  previous: number;
}>;

/** One person's results for the period and the period before. */
export type PersonPerformance = {
  userId: string;
  name: string;
  roles: string[];
  teams: TeamKey[];
  mine: boolean;
  metrics: Record<string, { current: number; previous: number }>;
  money: Record<string, MoneyFigure>;
};

export type TeamPerformance = {
  from: string;
  to: string;
  previousFrom: string;
  previousTo: string;
  /** True for the super admin, who sees everyone; others see themselves. */
  manager: boolean;
  teams: Array<{
    teamKey: TeamKey;
    metrics: Array<{ key: string; label: string; kind: "count" | "money" }>;
  }>;
  people: PersonPerformance[];
};

export const getTeamPerformance = (from: string, to: string) =>
  authenticatedFetch(
    `${performanceUrl}/team?${new URLSearchParams({ from, to })}`,
  ).then((response) => read<TeamPerformance>(response));
