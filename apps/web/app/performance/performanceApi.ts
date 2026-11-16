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
};

/** What a report would say right now, with the teams this person may report for. */
export type ReportPreview = {
  period: Period;
  periodStart: string;
  through: string;
  teamKey: TeamKey;
  teams: TeamKey[];
  newCount: number;
  completedCount: number;
  overdueCount: number;
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

export const getPreview = (period: Period) =>
  authenticatedFetch(`${performanceUrl}/preview?period=${period}`).then(
    (response) => read<ReportPreview>(response),
  );

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
  blockers?: string;
  notes?: string;
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
