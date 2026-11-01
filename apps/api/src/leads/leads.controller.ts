import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  DepartmentStaffGuard,
  SupabaseIdentityGuard,
} from "../auth/auth.guards";
import type { AuthenticatedRequest } from "../auth/auth.guards";
import { LeadsService } from "./leads.service";

/** Leads are internal sales records: any active staff member, never customers. */
@Controller("api/v1/leads")
@UseGuards(SupabaseIdentityGuard, DepartmentStaffGuard)
export class LeadsController {
  constructor(@Inject(LeadsService) private readonly leads: LeadsService) {}

  @Get()
  list() {
    return this.leads.list();
  }

  @Get("summary")
  summary() {
    return this.leads.summary();
  }

  @Get(":id/activities")
  activities(@Param("id") id: string) {
    return this.leads.activities(id);
  }

  @Post(":id/activities")
  addActivity(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.leads.addActivity(id, body, request.authUser!.userId);
  }

  @Post()
  create(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    return this.leads.create(body, request.authUser!.userId);
  }

  @Patch(":id")
  update(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.leads.update(id, body, request.authUser!.userId);
  }
}
