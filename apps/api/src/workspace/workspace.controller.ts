import { Controller, Get, Inject, Req, UseGuards } from "@nestjs/common";
import {
  DepartmentStaffGuard,
  JobScopeGuard,
  SupabaseIdentityGuard,
} from "../auth/auth.guards";
import type { AuthenticatedRequest } from "../auth/auth.guards";
import { DatabasePort } from "../database/database.port";

/**
 * The numbers beside the staff menu. Every open staff tab asks for them every
 * minute, so they are counted in the database: the menu used to download the
 * whole request, quote and message lists to count them, which used up the
 * hosted database's transfer allowance (2026-11-22).
 */
@Controller("api/v1/workspace")
@UseGuards(SupabaseIdentityGuard, DepartmentStaffGuard, JobScopeGuard)
export class WorkspaceController {
  constructor(@Inject(DatabasePort) private readonly database: DatabasePort) {}

  @Get("badges")
  async badges(@Req() request: AuthenticatedRequest) {
    const roles = request.staffRoles ?? [];
    const counts = await this.database.countWorkspaceBadges(
      request.allowedServiceLines ?? null,
    );
    // Client chat is customer service's (as the chat threads are).
    const chat =
      roles.includes("super_admin") || roles.includes("customer_service_rep");
    return { ...counts, chatUnread: chat ? counts.chatUnread : 0 };
  }
}
