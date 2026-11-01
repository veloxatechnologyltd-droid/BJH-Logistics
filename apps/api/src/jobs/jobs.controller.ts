import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  DepartmentStaffGuard,
  JobScopeGuard,
  SupabaseIdentityGuard,
} from "../auth/auth.guards";
import type { AuthenticatedRequest } from "../auth/auth.guards";
import { JobsService } from "./jobs.service";

function scopeOf(request: AuthenticatedRequest) {
  return {
    companyIds: request.allowedCompanyIds,
    serviceLines: request.allowedServiceLines,
  };
}

@Controller("api/v1/jobs")
@UseGuards(SupabaseIdentityGuard)
export class JobsController {
  constructor(@Inject(JobsService) private readonly jobs: JobsService) {}

  @Post()
  @UseGuards(DepartmentStaffGuard)
  create(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    return this.jobs.create(
      body,
      request.authUser!.userId,
      request.staffRoles!,
    );
  }

  @Get()
  @UseGuards(JobScopeGuard)
  list(
    @Query() query: Record<string, unknown>,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.jobs.list(query, request.authUser!.userId, scopeOf(request));
  }

  @Get(":id")
  @UseGuards(JobScopeGuard)
  get(@Param("id") id: string, @Req() request: AuthenticatedRequest) {
    return this.jobs.get(id, scopeOf(request));
  }

  @Get(":id/milestones")
  @UseGuards(JobScopeGuard)
  timeline(@Param("id") id: string, @Req() request: AuthenticatedRequest) {
    return this.jobs.getTimeline(id, scopeOf(request));
  }

  @Post(":id/milestones")
  @UseGuards(DepartmentStaffGuard, JobScopeGuard)
  recordMilestone(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.jobs.recordMilestone(
      id,
      body,
      request.authUser!.userId,
      scopeOf(request),
    );
  }

  @Get(":id/status-history")
  @UseGuards(JobScopeGuard)
  statusHistory(@Param("id") id: string, @Req() request: AuthenticatedRequest) {
    return this.jobs.getStatusHistory(id, scopeOf(request));
  }

  @Put(":id/voyage")
  @UseGuards(DepartmentStaffGuard, JobScopeGuard)
  updateVoyage(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.jobs.updateVoyage(id, body, scopeOf(request));
  }

  @Post(":id/status")
  @UseGuards(DepartmentStaffGuard, JobScopeGuard)
  changeStatus(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.jobs.changeStatus(
      id,
      body,
      request.authUser!.userId,
      scopeOf(request),
    );
  }
}
