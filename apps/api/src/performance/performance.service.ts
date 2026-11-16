import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
} from "@nestjs/common";
import {
  parseContract,
  performancePeriods,
  performanceReportInputSchema,
  teamKeys,
} from "@bjh/contracts";
import type { PerformancePeriod, TeamKey } from "@bjh/contracts";
import {
  STAFF_AUTH_DIRECTORY,
  staffDisplayName,
} from "../auth/staff-admin.port";
import type { StaffAuthDirectory } from "../auth/staff-admin.port";
import { DatabasePort } from "../database/database.port";
import type {
  PerformanceReportRecord,
  StaffRoleKey,
} from "../database/database.port";
import { teamsFor } from "../team-chat/team-chat.service";

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

export interface ReportPreview {
  period: PerformancePeriod;
  periodStart: string;
  /** The last day the counts cover: today. */
  through: string;
  teamKey: TeamKey;
  /** The teams this person may report for. */
  teams: TeamKey[];
  newCount: number;
  completedCount: number;
  overdueCount: number;
  /** Already submitted for this period: it cannot be sent twice. */
  submitted: ShownReport | null;
  /** For a weekly report: this week's daily reports, oldest first. */
  dailies: ShownReport[];
}

/** One person's month, built from their daily and weekly reports. */
export interface MonthlyPerson {
  userId: string;
  name: string;
  teams: TeamKey[];
  mine: boolean;
  dailyCount: number;
  weeklyCount: number;
  /** Their tasks over the month (to today, for the current month). */
  newCount: number;
  completedCount: number;
  overdueCount: number;
  /** Every blocker and note they reported, oldest first. */
  entries: Array<{
    period: PerformancePeriod;
    periodStart: string;
    blockers: string | null;
    notes: string | null;
  }>;
}

export interface MonthlyReport {
  month: string;
  from: string;
  through: string;
  manager: boolean;
  people: MonthlyPerson[];
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

/** "2026-11" -> the first and last day of that month, through today at most. */
export function monthRange(
  month: unknown,
  now: Date = new Date(),
): { month: string; from: string; to: string; through: string } {
  const value =
    month === undefined || month === "" ? isoDay(now).slice(0, 7) : month;
  if (typeof value !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) {
    throw new BadRequestException("month must look like 2026-11");
  }
  const [year, index] = value.split("-").map(Number);
  const from = `${value}-01`;
  const to = isoDay(new Date(Date.UTC(year, index, 0)));
  const today = isoDay(now);
  if (from > today) {
    throw new BadRequestException("That month has not started yet");
  }
  return { month: value, from, to, through: to < today ? to : today };
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
    const { teams, teamKey } = this.team(actor, teamInput);
    const { start, through } = reportPeriod(period);
    const [counts, existing, dailies] = await Promise.all([
      this.database.countTasksForReport(actor.userId, start, through),
      this.database.findPerformanceReport(actor.userId, period, start),
      period === "weekly"
        ? this.database.listPerformanceReports({
            teams: null,
            period: "daily",
            authorUserIds: [actor.userId],
            from: start,
            to: through,
          })
        : Promise.resolve([]),
    ]);
    return {
      period,
      periodStart: start,
      through,
      teamKey,
      teams,
      ...counts,
      submitted: existing
        ? (await this.show([existing], actor.userId))[0]
        : null,
      dailies: (await this.show(dailies, actor.userId)).reverse(),
    };
  }

  /**
   * A month, generated from the daily and weekly reports sent in it. The super
   * admin sees every team member, including those who sent nothing; everyone
   * else sees only themselves.
   */
  async monthly(
    actor: PerformanceActor,
    monthInput: unknown,
  ): Promise<MonthlyReport> {
    const { month, from, to, through } = monthRange(monthInput);
    const manager = actor.roles.includes("super_admin");
    const rolesByUser = new Map<string, StaffRoleKey[]>();
    if (manager) {
      for (const assignment of await this.database.listStaffRoleAssignments()) {
        if (assignment.revokedAt || assignment.roleKey === "super_admin")
          continue;
        rolesByUser.set(assignment.userId, [
          ...(rolesByUser.get(assignment.userId) ?? []),
          assignment.roleKey,
        ]);
      }
    } else {
      rolesByUser.set(actor.userId, actor.roles);
    }
    const reports = await this.database.listPerformanceReports({
      teams: null,
      authorUserIds: manager ? undefined : [actor.userId],
      from,
      to,
    });
    // Someone who reported then lost their role still shows for that month.
    for (const report of reports) {
      if (!rolesByUser.has(report.authorUserId)) {
        rolesByUser.set(report.authorUserId, []);
      }
    }
    const ids = [...rolesByUser.keys()];
    const [names, counts] = await Promise.all([
      this.names(ids),
      Promise.all(
        ids.map((id) => this.database.countTasksForReport(id, from, through)),
      ),
    ]);
    const people = ids.map((userId, index): MonthlyPerson => {
      const own = reports
        .filter((report) => report.authorUserId === userId)
        .reverse();
      return {
        userId,
        name: names.get(userId) ?? "Staff member",
        teams: [
          ...new Set([
            ...teamsFor(rolesByUser.get(userId) ?? []),
            ...own.map((report) => report.teamKey),
          ]),
        ],
        mine: userId === actor.userId,
        dailyCount: own.filter((report) => report.period === "daily").length,
        weeklyCount: own.filter((report) => report.period === "weekly").length,
        ...counts[index],
        entries: own
          .filter((report) => report.blockers || report.notes)
          .map((report) => ({
            period: report.period,
            periodStart: report.periodStart,
            blockers: report.blockers,
            notes: report.notes,
          })),
      };
    });
    people.sort((a, b) => a.name.localeCompare(b.name));
    return { month, from, through, manager, people };
  }

  async submit(actor: PerformanceActor, input: unknown): Promise<ShownReport> {
    const parsed = parseContract(performanceReportInputSchema, input);
    if (!parsed.success) throw new BadRequestException(parsed.message);
    const { teamKey } = this.team(actor, parsed.data.teamKey);
    const { start, through } = reportPeriod(parsed.data.period);
    const counts = await this.database.countTasksForReport(
      actor.userId,
      start,
      through,
    );
    const saved = await this.database.createPerformanceReport({
      authorUserId: actor.userId,
      teamKey,
      period: parsed.data.period,
      periodStart: start,
      ...counts,
      blockers: parsed.data.blockers,
      notes: parsed.data.notes,
    });
    if (saved === "duplicate") {
      throw new ConflictException(
        parsed.data.period === "daily"
          ? "You have already sent today's report"
          : "You have already sent this week's report",
      );
    }
    return (await this.show([saved], actor.userId))[0];
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
