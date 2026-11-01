import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  DepartmentStaffGuard,
  JobScopeGuard,
  SupabaseIdentityGuard,
} from "../auth/auth.guards";
import type { AuthenticatedRequest } from "../auth/auth.guards";
import { JobAssignmentsService } from "./job-assignments.service";

function scopeOf(request: AuthenticatedRequest) {
  return {
    companyIds: request.allowedCompanyIds,
    serviceLines: request.allowedServiceLines,
  };
}

/** Who works a job: staff only; customers deal with customer service, not the team. */
@Controller("api/v1/jobs/:id/team")
@UseGuards(SupabaseIdentityGuard, DepartmentStaffGuard, JobScopeGuard)
export class JobAssignmentsController {
  constructor(
    @Inject(JobAssignmentsService)
    private readonly assignments: JobAssignmentsService,
  ) {}

  @Get()
  team(@Param("id") id: string, @Req() request: AuthenticatedRequest) {
    return this.assignments.team(id, scopeOf(request));
  }

  @Post()
  assign(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.assignments.assign(
      id,
      body,
      request.authUser!.userId,
      request.staffRoles ?? [],
      scopeOf(request),
    );
  }

  @Delete(":assignmentId")
  remove(
    @Param("id") id: string,
    @Param("assignmentId") assignmentId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.assignments.remove(
      id,
      assignmentId,
      request.authUser!.userId,
      request.staffRoles ?? [],
      scopeOf(request),
    );
  }
}
