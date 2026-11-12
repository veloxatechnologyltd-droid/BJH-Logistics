import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  StaffRolesGuard,
  SupabaseIdentityGuard,
  leadGenerationRoles,
} from "../auth/auth.guards";
import type { AuthenticatedRequest } from "../auth/auth.guards";
import { SalesService } from "./sales.service";

/** The sales hub is for sales, customer service and the super admin, as the campaigns are (L3). */
@Controller("api/v1/sales")
@UseGuards(SupabaseIdentityGuard, StaffRolesGuard(leadGenerationRoles))
export class SalesController {
  constructor(@Inject(SalesService) private readonly sales: SalesService) {}

  @Get("overview")
  overview() {
    return this.sales.overview();
  }

  @Get("pool")
  pool(@Query() query: Record<string, unknown>) {
    return this.sales.pool(query);
  }

  @Post("pool/dismiss")
  @HttpCode(200)
  dismiss(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    return this.sales.dismiss(body, request.authUser!.userId);
  }

  @Post("drafts")
  createDrafts(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    return this.sales.createDrafts(body, request.authUser!.userId);
  }

  @Get("drafts")
  drafts(@Query() query: Record<string, unknown>) {
    return this.sales.drafts(query);
  }

  /** Before ":id/...", so "approve" is not read as a draft ID. */
  @Post("drafts/approve")
  @HttpCode(200)
  approveMany(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    return this.sales.approveMany(body, request.authUser!.userId);
  }

  @Patch("drafts/:id")
  editDraft(@Param("id") id: string, @Body() body: unknown) {
    return this.sales.editDraft(id, body);
  }

  @Post("drafts/:id/approve")
  @HttpCode(200)
  approve(@Param("id") id: string, @Req() request: AuthenticatedRequest) {
    return this.sales.approve(id, request.authUser!.userId);
  }

  @Post("drafts/:id/reject")
  @HttpCode(200)
  reject(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.sales.reject(id, body, request.authUser!.userId);
  }
}
