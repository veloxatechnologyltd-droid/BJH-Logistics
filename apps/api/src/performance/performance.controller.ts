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
