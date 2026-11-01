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
  StaffRolesGuard,
  SupabaseIdentityGuard,
  financeRoles,
} from "../auth/auth.guards";
import type { AuthenticatedRequest } from "../auth/auth.guards";
import { JobChargesService } from "./job-charges.service";

function scopeOf(request: AuthenticatedRequest) {
  return {
    companyIds: request.allowedCompanyIds,
    serviceLines: request.allowedServiceLines,
  };
}

/** Internal job costing: staff only, within the caller's service lines. */
@Controller("api/v1/jobs/:id/charges")
@UseGuards(
  SupabaseIdentityGuard,
  DepartmentStaffGuard,
  JobScopeGuard,
  StaffRolesGuard(financeRoles),
)
export class JobChargesController {
  constructor(
    @Inject(JobChargesService) private readonly charges: JobChargesService,
  ) {}

  @Get()
  list(@Param("id") id: string, @Req() request: AuthenticatedRequest) {
    return this.charges.list(id, scopeOf(request));
  }

  @Post()
  create(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.charges.create(
      id,
      body,
      request.authUser!.userId,
      scopeOf(request),
    );
  }

  @Post("import-from-quote")
  importFromQuote(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.charges.importFromQuote(
      id,
      body,
      request.authUser!.userId,
      scopeOf(request),
    );
  }

  @Delete(":chargeId")
  remove(
    @Param("id") id: string,
    @Param("chargeId") chargeId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.charges.remove(
      id,
      chargeId,
      request.authUser!.userId,
      scopeOf(request),
    );
  }

  @Post(":chargeId/actuals")
  recordActual(
    @Param("id") id: string,
    @Param("chargeId") chargeId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.charges.recordActual(
      id,
      chargeId,
      body,
      request.authUser!.userId,
      scopeOf(request),
    );
  }
}
