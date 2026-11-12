import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  DepartmentStaffGuard,
  StaffRolesGuard,
  SupabaseIdentityGuard,
  quoteDeskRoles,
} from "../auth/auth.guards";
import type { AuthenticatedRequest } from "../auth/auth.guards";
import { LeadsService } from "./leads.service";

/** Leads are internal sales records: any active staff member, never customers. */
@Controller("api/v1/leads")
@UseGuards(SupabaseIdentityGuard, DepartmentStaffGuard)
export class LeadsController {
  constructor(@Inject(LeadsService) private readonly leads: LeadsService) {}

  /** `?pipeline=manual` or `generated` keeps the two kinds of lead apart. */
  @Get()
  list(@Query("pipeline") pipeline?: string) {
    return this.leads.list(pipeline);
  }

  @Get("summary")
  summary(@Query("pipeline") pipeline?: string) {
    return this.leads.summary(pipeline);
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

  /** Before a quote for a lead: whoever may prepare quotes. */
  @Post(":id/customer")
  @UseGuards(StaffRolesGuard(quoteDeskRoles))
  toCustomer(@Param("id") id: string) {
    return this.leads.toCustomer(id);
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
