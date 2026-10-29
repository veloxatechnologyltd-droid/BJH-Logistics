import { Controller, Get, Inject, Query, Req, UseGuards } from "@nestjs/common";
import {
  DepartmentStaffGuard,
  JobScopeGuard,
  SupabaseIdentityGuard,
} from "../auth/auth.guards";
import type { AuthenticatedRequest } from "../auth/auth.guards";
import { ReportsService } from "./reports.service";

function scopeOf(request: AuthenticatedRequest) {
  return {
    companyIds: request.allowedCompanyIds,
    serviceLines: request.allowedServiceLines,
  };
}

/** Date-filtered report data; staff see only companies and service lines in their API scope. */
@Controller("api/v1/reports")
@UseGuards(SupabaseIdentityGuard, DepartmentStaffGuard, JobScopeGuard)
export class ReportsController {
  constructor(
    @Inject(ReportsService) private readonly reports: ReportsService,
  ) {}

  @Get()
  report(
    @Query() query: Record<string, unknown>,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.reports.report(query, scopeOf(request));
  }
}
