import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  DepartmentStaffGuard,
  SupabaseIdentityGuard,
} from "../auth/auth.guards";
import type { AuthenticatedRequest } from "../auth/auth.guards";
import { StaffNotificationsService } from "./staff-notifications.service";

/** The signed-in staff member's own notices and reminders. */
@Controller("api/v1")
@UseGuards(SupabaseIdentityGuard, DepartmentStaffGuard)
export class StaffNotificationsController {
  constructor(
    @Inject(StaffNotificationsService)
    private readonly notices: StaffNotificationsService,
  ) {}

  @Get("staff-notifications")
  list(@Req() request: AuthenticatedRequest) {
    return this.notices.list(request.authUser!.userId);
  }

  @Post("staff-notifications/:id/dismiss")
  dismiss(@Param("id") id: string, @Req() request: AuthenticatedRequest) {
    return this.notices.dismiss(id, request.authUser!.userId);
  }

  @Post("staff-notifications/:id/snooze")
  snooze(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.notices.snooze(id, body, request.authUser!.userId);
  }

  @Post("quote-requests/:id/reminders")
  remind(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.notices.remind(id, body, request.authUser!.userId);
  }
}
