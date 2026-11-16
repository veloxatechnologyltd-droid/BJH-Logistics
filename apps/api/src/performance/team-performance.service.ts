import { Inject, Injectable } from "@nestjs/common";
import { staffRoleLabels } from "@bjh/contracts";
import type { TeamKey } from "@bjh/contracts";
import {
  STAFF_AUTH_DIRECTORY,
  staffDisplayName,
} from "../auth/staff-admin.port";
import type { StaffAuthDirectory } from "../auth/staff-admin.port";
import { DatabasePort } from "../database/database.port";
import type { StaffRoleKey } from "../database/database.port";
import { teamsFor } from "../team-chat/team-chat.service";
import { performanceMetrics, performanceWindow } from "./performance-metrics";
import type { PerformanceActor } from "./performance.service";

export interface PersonPerformance {
  userId: string;
  name: string;
  /** Readable role names, e.g. "Import rep". */
  roles: string[];
  teams: TeamKey[];
  mine: boolean;
  /** Every metric of the person's teams, zero when they did none. */
  metrics: Record<string, { current: number; previous: number }>;
  /** Money recorded as received, per currency, in minor units (Finance). */
  collected: Array<{ currency: string; current: number; previous: number }>;
}

export interface TeamPerformanceColumns {
  teamKey: TeamKey;
  metrics: Array<{ key: string; label: string }>;
}

export interface TeamPerformance {
  from: string;
  to: string;
  previousFrom: string;
  previousTo: string;
  /** Only the super admin sees everyone; others see just their own numbers. */
  manager: boolean;
  teams: TeamPerformanceColumns[];
  people: PersonPerformance[];
}

const TEAM_ORDER: TeamKey[] = [
  "sales",
  "customer_service",
  "operations",
  "finance",
];

/**
 * How each staff member is performing (Evans, 2026-11-16): leads added, quotes
 * issued, payments recorded and so on, counted from the records that name the
 * person, for any period, next to the period before. The super admin sees
 * every account; everyone else sees only their own.
 */
@Injectable()
export class TeamPerformanceService {
  constructor(
    @Inject(DatabasePort) private readonly database: DatabasePort,
    @Inject(STAFF_AUTH_DIRECTORY) private readonly auth: StaffAuthDirectory,
  ) {}

  async team(
    actor: PerformanceActor,
    query: { from?: unknown; to?: unknown },
  ): Promise<TeamPerformance> {
    const period = performanceWindow(query.from, query.to);
    const manager = actor.roles.includes("super_admin");

    // Staff with a team. The super admin reads the numbers and is not one of them.
    const rolesByUser = new Map<string, StaffRoleKey[]>();
    for (const assignment of await this.database.listStaffRoleAssignments()) {
      if (assignment.revokedAt || assignment.roleKey === "super_admin")
        continue;
      if (!manager && assignment.userId !== actor.userId) continue;
      rolesByUser.set(assignment.userId, [
        ...(rolesByUser.get(assignment.userId) ?? []),
        assignment.roleKey,
      ]);
    }
    const userIds = [...rolesByUser.keys()];
    const [{ counts, collected }, names] = await Promise.all([
      this.database.staffPerformance(userIds, {
        start: period.start,
        end: period.end,
        previousStart: period.previousStart,
      }),
      this.names(userIds),
    ]);

    const people = userIds.map((userId): PersonPerformance => {
      const roles = rolesByUser.get(userId) ?? [];
      const teams = teamsFor(roles);
      const metrics: PersonPerformance["metrics"] = {};
      for (const metric of performanceMetrics) {
        if (metric.team === "all" || teams.includes(metric.team)) {
          metrics[metric.key] = { current: 0, previous: 0 };
        }
      }
      for (const row of counts) {
        if (row.userId === userId && metrics[row.metric]) {
          metrics[row.metric] = {
            current: row.current,
            previous: row.previous,
          };
        }
      }
      return {
        userId,
        name: names.get(userId) ?? "Staff member",
        roles: roles.map((role) => staffRoleLabels[role] ?? role),
        teams,
        mine: userId === actor.userId,
        metrics,
        collected: collected
          .filter((row) => row.userId === userId)
          .map(({ currency, current, previous }) => ({
            currency,
            current,
            previous,
          }))
          .sort((a, b) => a.currency.localeCompare(b.currency)),
      };
    });
    people.sort(
      (a, b) =>
        TEAM_ORDER.indexOf(a.teams[0]) - TEAM_ORDER.indexOf(b.teams[0]) ||
        a.name.localeCompare(b.name),
    );

    const present = TEAM_ORDER.filter((team) =>
      people.some((person) => person.teams.includes(team)),
    );
    return {
      from: period.from,
      to: period.to,
      previousFrom: period.previousFrom,
      previousTo: period.previousTo,
      manager,
      teams: present.map((teamKey) => ({
        teamKey,
        metrics: performanceMetrics
          .filter((m) => m.team === teamKey || m.team === "all")
          .map(({ key, label }) => ({ key, label })),
      })),
      people,
    };
  }

  /** Display names (never emails) for staff accounts that still exist. */
  private async names(userIds: string[]): Promise<Map<string, string>> {
    const users = await Promise.all(userIds.map((id) => this.auth.getUser(id)));
    return new Map(
      userIds.flatMap((id, index) =>
        users[index] ? [[id, staffDisplayName(users[index])] as const] : [],
      ),
    );
  }
}
