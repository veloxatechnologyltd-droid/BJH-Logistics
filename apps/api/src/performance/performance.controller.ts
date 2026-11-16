import {
  Body,
  Controller,
  Get,
  Inject,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  DepartmentStaffGuard,
  SupabaseIdentityGuard,
} from "../auth/auth.guards";
import type { AuthenticatedRequest } from "../auth/auth.guards";
import { TeamPerformanceService } from "./team-performance.service";
import { PerformanceService } from "./performance.service";
import type { PerformanceActor } from "./performance.service";

function actorOf(request: AuthenticatedRequest): PerformanceActor {
  return {
    userId: request.authUser!.userId,
    roles: request.staffRoles ?? [],
  };
}

/** Daily and weekly performance reports: staff only. */
@Controller("api/v1/performance")
@UseGuards(SupabaseIdentityGuard, DepartmentStaffGuard)
export class PerformanceController {
  constructor(
    @Inject(PerformanceService)
    private readonly performance: PerformanceService,
    @Inject(TeamPerformanceService)
    private readonly teamPerformance: TeamPerformanceService,
  ) {}

  /** The numbers a report would carry right now. */
  @Get("preview")
  preview(
    @Query("period") period: unknown,
    @Query("teamKey") teamKey: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.performance.preview(actorOf(request), period, teamKey);
  }

  /**
   * How each staff member performed in a period, from their own work. The super
   * admin sees everyone; everyone else sees only themselves.
   */
  @Get("team")
  team(
    @Query("from") from: unknown,
    @Query("to") to: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.teamPerformance.team(actorOf(request), { from, to });
  }

  /** A month generated from the daily and weekly reports (?month=2026-11). */
  @Get("monthly")
  monthly(
    @Query("month") month: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.performance.monthly(actorOf(request), month);
  }

  /** Who still owes a report today and this week (super admin only). */
  @Get("roster")
  roster(@Req() request: AuthenticatedRequest) {
    return this.performance.roster(actorOf(request));
  }

  @Get()
  list(
    @Query("teamKey") teamKey: unknown,
    @Query("period") period: unknown,
    @Query("blockers") blockers: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.performance.list(actorOf(request), {
      teamKey,
      period,
      blockers,
    });
  }

  @Post()
  submit(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    return this.performance.submit(actorOf(request), body);
  }
}
