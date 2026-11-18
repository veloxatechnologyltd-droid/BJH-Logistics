import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  parseContract,
  performancePeriods,
  performanceReportInputSchema,
  serviceLinesForRoles,
  teamKeys,
} from "@bjh/contracts";
import type {
  PerformanceDepartment,
  PerformanceJobUpdateInput,
  PerformancePeriod,
  TeamKey,
} from "@bjh/contracts";
import {
  STAFF_AUTH_DIRECTORY,
  staffDisplayName,
} from "../auth/staff-admin.port";
import type { StaffAuthDirectory } from "../auth/staff-admin.port";
import { DatabasePort } from "../database/database.port";
import type {
  PerformanceJobUpdate,
  PerformanceReportRecord,
  ReportActivity,
  ReportTaskCounts,
  StaffRoleKey,
} from "../database/database.port";
import { teamsFor } from "../team-chat/team-chat.service";
import { performanceMetrics } from "./performance-metrics";

/** The signed-in staff member writing or reading reports. */
export interface PerformanceActor {
  userId: string;
  roles: StaffRoleKey[];
}

export interface ShownReport extends PerformanceReportRecord {
  /** The author's display name, never an email. */
  authorName: string;
  mine: boolean;
}

/** The department a team's people usually report as; they may pick another. */
const departmentForTeam: Record<TeamKey, PerformanceDepartment> = {
  sales: "sales_marketing",
  customer_service: "customer_service",
  operations: "operations",
  finance: "finance",
};

export interface ReportPreview extends ReportTaskCounts {
  period: PerformancePeriod;
  periodStart: string;
  /** The last day the counts cover: today. */
  through: string;
  teamKey: TeamKey;
  /** The teams this person may report for. */
  teams: TeamKey[];
  /** The department the form starts on. */
  department: PerformanceDepartment;
  /** What the system recorded for this person so far in the period. */
  activity: ReportActivity;
  /** The latest report already sent for this period; another may follow. */
  submitted: ShownReport | null;
}

/** Who has and has not reported for the current day or week. */
export interface ReportRosterSlice {
  periodStart: string;
  expected: number;
  reported: number;
  missing: Array<{ userId: string; name: string; teams: TeamKey[] }>;
}

export interface ReportRoster {
  /** Only the super admin gets the roster; others see just their own reports. */
  manager: boolean;
  daily?: ReportRosterSlice;
  weekly?: ReportRosterSlice;
}

/** Ghana is on UTC, so the UTC date is the local day. */
const isoDay = (date: Date) => date.toISOString().slice(0, 10);

/** The report's period: today, or the Monday of this week through today. */
export function reportPeriod(
  period: PerformancePeriod,
  now: Date = new Date(),
): { start: string; through: string } {
  const through = isoDay(now);
  if (period === "daily") return { start: through, through };
  const sinceMonday = (now.getUTCDay() + 6) % 7;
  const monday = new Date(now.getTime() - sinceMonday * 86_400_000);
  return { start: isoDay(monday), through };
}

/**
 * Daily and weekly performance reports (Evans, 2026-11-16). The counts come
 * from the person's own tasks and are computed here, never typed in. Reports are
 * visible to the super admin and to people in the author's team.
 */
@Injectable()
export class PerformanceService {
  constructor(
    @Inject(DatabasePort) private readonly database: DatabasePort,
    @Inject(STAFF_AUTH_DIRECTORY) private readonly auth: StaffAuthDirectory,
  ) {}

  /** What the report would say now, so the person sees the numbers first. */
  async preview(
    actor: PerformanceActor,
    periodInput: unknown,
    teamInput: unknown,
  ): Promise<ReportPreview> {
    const period = this.period(periodInput);
    // The preview opens on the person's first team; they may switch.
    const { teams, teamKey } = this.team(
      actor,
      teamInput || teamsFor(actor.roles)[0],
    );
    const { start, through } = reportPeriod(period);
    const [counts, existing, activity] = await Promise.all([
      this.database.countTasksForReport(actor.userId, start, through),
      this.database.findPerformanceReport(actor.userId, period, start),
      this.activity(actor.userId, teamKey, period),
    ]);
    return {
      period,
      periodStart: start,
      through,
      teamKey,
      teams,
      department: departmentForTeam[teamKey],
      ...counts,
      activity,
      submitted: existing
        ? (await this.show([existing], actor.userId))[0]
        : null,
    };
  }

  async submit(actor: PerformanceActor, input: unknown): Promise<ShownReport> {
    const parsed = parseContract(performanceReportInputSchema, input);
    if (!parsed.success) throw new BadRequestException(parsed.message);
    const report = parsed.data;
    const daily = report.period === "daily";
    const { teamKey } = this.team(actor, report.teamKey);
    const { start, through } = reportPeriod(report.period);
    const jobUpdates = daily
      ? await this.jobUpdates(actor, report.jobUpdates)
      : null;
    const [counts, activity] = await Promise.all([
      this.database.countTasksForReport(actor.userId, start, through),
      this.activity(actor.userId, teamKey, report.period),
    ]);
    const saved = await this.database.createPerformanceReport({
      authorUserId: actor.userId,
      teamKey,
      period: report.period,
      periodStart: start,
      newCount: counts.newCount,
      completedCount: counts.completedCount,
      overdueCount: counts.overdueCount,
      openingActive: daily ? null : counts.openingActive,
      closingActive: daily ? null : counts.closingActive,
      department: report.department,
      jobUpdates,
      blockers: report.blockers,
      notes: report.notes,
      summary: report.summary,
      plan: report.plan,
      kpiTarget: daily ? null : report.kpiTarget,
      kpiActual: daily ? null : report.kpiActual,
      kpiAction: daily ? null : report.kpiAction,
      activity,
    });
    return (await this.show([saved], actor.userId))[0];
  }

  /**
   * Job updates as they are stored: each system job must be one the person may
   * see, and its file number is copied in; the next action goes to an active
   * staff member, whose display name is copied in.
   */
  private async jobUpdates(
    actor: PerformanceActor,
    updates: PerformanceJobUpdateInput[],
  ): Promise<PerformanceJobUpdate[]> {
    const scope = actor.roles.includes("super_admin")
      ? {}
      : { serviceLines: serviceLinesForRoles(actor.roles) };
    const people = [
      ...new Set(updates.flatMap((u) => u.nextActionUserId ?? [])),
    ];
    for (const userId of people) {
      if ((await this.database.getActiveStaffRoles(userId)).length === 0) {
        throw new BadRequestException(
          "The next action must go to an active staff member",
        );
      }
    }
    const names = await this.names(people);
    return Promise.all(
      updates.map(async (update) => {
        let jobReference: string | null = null;
        if (update.jobId) {
          const job = await this.database.findJob(update.jobId, scope);
          if (!job) throw new NotFoundException("Job not found");
          jobReference = job.fileNumber;
        }
        return {
          ...update,
          jobReference,
          nextActionName: update.nextActionUserId
            ? (names.get(update.nextActionUserId) ?? "Staff member")
            : null,
        };
      }),
    );
  }

  /**
   * Who still owes a report for today and for this week. The people expected
   * are staff who belong to a team; the super admin, who reads the reports, is
   * not asked to send one. Only the super admin gets this.
   */
  async roster(actor: PerformanceActor): Promise<ReportRoster> {
    if (!actor.roles.includes("super_admin")) return { manager: false };
    const rolesByUser = new Map<string, StaffRoleKey[]>();
    for (const assignment of await this.database.listStaffRoleAssignments()) {
      if (assignment.revokedAt || assignment.roleKey === "super_admin")
        continue;
      rolesByUser.set(assignment.userId, [
        ...(rolesByUser.get(assignment.userId) ?? []),
        assignment.roleKey,
      ]);
    }
    const slice = async (
      period: PerformancePeriod,
    ): Promise<ReportRosterSlice> => {
      const { start } = reportPeriod(period);
      const sent = new Set(
        (
          await this.database.listPerformanceReports({
            teams: null,
            period,
            periodStart: start,
          })
        ).map((report) => report.authorUserId),
      );
      const missingIds = [...rolesByUser.keys()].filter((id) => !sent.has(id));
      const names = await this.names(missingIds);
      return {
        periodStart: start,
        expected: rolesByUser.size,
        reported: rolesByUser.size - missingIds.length,
        missing: missingIds
          .map((userId) => ({
            userId,
            name: names.get(userId) ?? "Staff member",
            teams: teamsFor(rolesByUser.get(userId) ?? []),
          }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      };
    };
    return {
      manager: true,
      daily: await slice("daily"),
      weekly: await slice("weekly"),
    };
  }

  /** The super admin sees every team; everyone else sees their own teams. */
  async list(
    actor: PerformanceActor,
    query: { teamKey?: unknown; period?: unknown; blockers?: unknown },
  ): Promise<ShownReport[]> {
    const teams = actor.roles.includes("super_admin")
      ? null
      : teamsFor(actor.roles);
    const teamKey =
      query.teamKey === undefined || query.teamKey === ""
        ? undefined
        : this.teamKey(query.teamKey);
    const period =
      query.period === undefined || query.period === ""
        ? undefined
        : this.period(query.period);
    if (
      query.blockers !== undefined &&
      query.blockers !== "" &&
      query.blockers !== "yes"
    ) {
      throw new BadRequestException("blockers must be yes or empty");
    }
    const reports = await this.database.listPerformanceReports({
      teams,
      teamKey,
      period,
      withBlockers: query.blockers === "yes",
    });
    return this.show(reports, actor.userId);
  }

  /**
   * The person's results for the team they report for, today or this week so
   * far, next to yesterday or the whole of last week, and the items behind
   * them, newest first.
   */
  private async activity(
    userId: string,
    teamKey: TeamKey,
    period: PerformancePeriod,
  ): Promise<ReportActivity> {
    const { start, through } = reportPeriod(period);
    const startMs = Date.parse(`${start}T00:00:00.000Z`);
    const bounds = {
      start: new Date(startMs).toISOString(),
      end: new Date(
        Date.parse(`${through}T00:00:00.000Z`) + 86_400_000,
      ).toISOString(),
      previousStart: new Date(
        startMs - (period === "daily" ? 1 : 7) * 86_400_000,
      ).toISOString(),
    };
    const [{ counts, money }, items] = await Promise.all([
      this.database.staffPerformance([userId], bounds),
      this.database.staffActivity(userId, bounds),
    ]);
    return {
      metrics: performanceMetrics
        .filter((metric) => metric.team === teamKey)
        .map(({ key, label, kind }) => {
          if (kind === "count") {
            const row = counts.find((count) => count.metric === key);
            return {
              key,
              label,
              kind,
              current: row?.current ?? 0,
              previous: row?.previous ?? 0,
            };
          }
          const rows = money
            .filter((figure) => figure.metric === key)
            .map(({ currency, current, previous }) => ({
              currency,
              current,
              previous,
            }))
            .sort((a, b) => a.currency.localeCompare(b.currency));
          return {
            key,
            label,
            kind,
            current: rows.reduce((sum, row) => sum + row.current, 0),
            previous: rows.reduce((sum, row) => sum + row.previous, 0),
            money: rows,
          };
        }),
      items,
    };
  }

  private period(value: unknown): PerformancePeriod {
    if (!(performancePeriods as readonly unknown[]).includes(value)) {
      throw new BadRequestException(
        `period must be one of ${performancePeriods.join(", ")}`,
      );
    }
    return value as PerformancePeriod;
  }

  private teamKey(value: unknown): TeamKey {
    if (!(teamKeys as readonly unknown[]).includes(value)) {
      throw new BadRequestException(
        `teamKey must be one of ${teamKeys.join(", ")}`,
      );
    }
    return value as TeamKey;
  }

  /**
   * The team a person reports for: their only team, or the one they name when
   * they belong to several. Nobody reports for a team they are not in.
   */
  private team(
    actor: PerformanceActor,
    requested: unknown,
  ): { teams: TeamKey[]; teamKey: TeamKey } {
    const teams = teamsFor(actor.roles);
    if (teams.length === 0) {
      throw new ForbiddenException("Only a team member can send a report");
    }
    if (requested === undefined || requested === null || requested === "") {
      if (teams.length > 1) {
        throw new BadRequestException("Choose which team this report is for");
      }
      return { teams, teamKey: teams[0] };
    }
    const teamKey = this.teamKey(requested);
    if (!teams.includes(teamKey)) {
      throw new ForbiddenException("You can only report for your own team");
    }
    return { teams, teamKey };
  }

  /** Display names (never emails) for staff accounts that still exist. */
  private async names(userIds: string[]): Promise<Map<string, string>> {
    const ids = [...new Set(userIds)];
    const users = await Promise.all(ids.map((id) => this.auth.getUser(id)));
    return new Map(
      ids.flatMap((id, index) =>
        users[index] ? [[id, staffDisplayName(users[index])] as const] : [],
      ),
    );
  }

  /** Reports with their authors' display names. */
  private async show(
    reports: PerformanceReportRecord[],
    viewerId: string,
  ): Promise<ShownReport[]> {
    const names = await this.names(reports.map((r) => r.authorUserId));
    return reports.map((report) => ({
      ...report,
      authorName: names.get(report.authorUserId) ?? "Staff member",
      mine: report.authorUserId === viewerId,
    }));
  }
}
