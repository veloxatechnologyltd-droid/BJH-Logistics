import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Post,
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
import { JobDetailsService } from "./job-details.service";

function scopeOf(request: AuthenticatedRequest) {
  return {
    companyIds: request.allowedCompanyIds,
    serviceLines: request.allowedServiceLines,
  };
}

@Controller("api/v1/jobs/:id")
@UseGuards(SupabaseIdentityGuard)
export class JobDetailsController {
  constructor(
    @Inject(JobDetailsService) private readonly details: JobDetailsService,
  ) {}

  @Get("parties")
  @UseGuards(JobScopeGuard)
  listParties(@Param("id") id: string, @Req() request: AuthenticatedRequest) {
    return this.details.listParties(id, scopeOf(request));
  }

  @Post("parties")
  @UseGuards(DepartmentStaffGuard, JobScopeGuard)
  addParty(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.details.addParty(
      id,
      body,
      request.authUser!.userId,
      scopeOf(request),
    );
  }

  @Delete("parties/:partyId")
  @UseGuards(DepartmentStaffGuard, JobScopeGuard)
  removeParty(
    @Param("id") id: string,
    @Param("partyId") partyId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.details.removeParty(
      id,
      partyId,
      request.authUser!.userId,
      scopeOf(request),
    );
  }

  @Get("references")
  @UseGuards(JobScopeGuard)
  listReferences(
    @Param("id") id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.details.listReferences(id, scopeOf(request));
  }

  @Post("references")
  @UseGuards(DepartmentStaffGuard, JobScopeGuard)
  addReference(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.details.addReference(
      id,
      body,
      request.authUser!.userId,
      scopeOf(request),
    );
  }

  @Delete("references/:referenceId")
  @UseGuards(DepartmentStaffGuard, JobScopeGuard)
  removeReference(
    @Param("id") id: string,
    @Param("referenceId") referenceId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.details.removeReference(
      id,
      referenceId,
      request.authUser!.userId,
      scopeOf(request),
    );
  }

  @Get("eta")
  @UseGuards(JobScopeGuard)
  getEta(@Param("id") id: string, @Req() request: AuthenticatedRequest) {
    return this.details.getEta(id, scopeOf(request));
  }

  @Post("eta")
  @UseGuards(DepartmentStaffGuard, JobScopeGuard)
  recordEta(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.details.recordEta(
      id,
      body,
      request.authUser!.userId,
      scopeOf(request),
    );
  }

  @Get("reminders")
  @UseGuards(DepartmentStaffGuard, JobScopeGuard)
  listReminders(@Param("id") id: string, @Req() request: AuthenticatedRequest) {
    return this.details.listReminders(
      id,
      request.authUser!.userId,
      scopeOf(request),
    );
  }

  @Post("reminders")
  @UseGuards(DepartmentStaffGuard, JobScopeGuard)
  remind(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.details.remind(
      id,
      body,
      request.authUser!.userId,
      scopeOf(request),
    );
  }

  @Get("tasks")
  @UseGuards(DepartmentStaffGuard, JobScopeGuard)
  listTasks(@Param("id") id: string, @Req() request: AuthenticatedRequest) {
    return this.details.listTasks(id, scopeOf(request));
  }

  @Post("tasks")
  @UseGuards(DepartmentStaffGuard, JobScopeGuard)
  createTask(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.details.createTask(
      id,
      body,
      request.authUser!.userId,
      scopeOf(request),
    );
  }

  @Post("tasks/:taskId/complete")
  @UseGuards(DepartmentStaffGuard, JobScopeGuard)
  completeTask(
    @Param("id") id: string,
    @Param("taskId") taskId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.details.completeTask(
      id,
      taskId,
      body,
      request.authUser!.userId,
      scopeOf(request),
    );
  }
}

/** Who may see every to-do that belongs to no job. */
function viewerOf(request: AuthenticatedRequest) {
  return {
    userId: request.authUser!.userId,
    seeAll: request.staffRoles?.includes("super_admin") ?? false,
  };
}

/**
 * Open work across every job the caller can see, plus to-dos that are theirs
 * (a department's or a person's task list).
 */
@Controller("api/v1/tasks")
@UseGuards(SupabaseIdentityGuard)
export class TasksController {
  constructor(
    @Inject(JobDetailsService) private readonly details: JobDetailsService,
  ) {}

  @Get()
  @UseGuards(DepartmentStaffGuard, JobScopeGuard)
  list(
    @Query("assignedRole") assignedRole: string | undefined,
    @Query("assignedUserId") assignedUserId: string | undefined,
    @Query("status") status: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.details.listOpenTasks(
      { assignedRole, assignedUserId, status },
      scopeOf(request),
      viewerOf(request),
    );
  }

  /** A to-do that belongs to no job, for one named person. */
  @Post()
  @UseGuards(DepartmentStaffGuard, JobScopeGuard)
  create(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    return this.details.createTodo(body, request.authUser!.userId);
  }

  @Post(":taskId/complete")
  @UseGuards(DepartmentStaffGuard, JobScopeGuard)
  complete(
    @Param("taskId") taskId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.details.completeTodo(taskId, body, viewerOf(request));
  }
}
