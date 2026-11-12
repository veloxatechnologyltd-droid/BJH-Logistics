import {
  Body,
  Controller,
  Delete,
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
  CrmAccessGuard,
  StaffRolesGuard,
  SupabaseIdentityGuard,
  leadGenerationRoles,
} from "../auth/auth.guards";
import type { AuthenticatedRequest } from "../auth/auth.guards";
import { CampaignsService } from "./campaigns.service";

/** Campaigns, runs and prospects are internal sales records: sales, customer service and the super admin. */
@Controller("api/v1/campaigns")
@UseGuards(
  SupabaseIdentityGuard,
  StaffRolesGuard(leadGenerationRoles),
  CrmAccessGuard,
)
export class CampaignsController {
  constructor(
    @Inject(CampaignsService) private readonly campaigns: CampaignsService,
  ) {}

  @Get()
  list() {
    return this.campaigns.list();
  }

  /** Before ":id", so "config" is not read as a campaign ID. */
  @Get("config")
  config() {
    return this.campaigns.config();
  }

  @Post()
  create(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    return this.campaigns.create(body, request.authUser!.userId);
  }

  @Get(":id")
  get(@Param("id") id: string) {
    return this.campaigns.get(id);
  }

  @Patch(":id")
  update(@Param("id") id: string, @Body() body: unknown) {
    return this.campaigns.update(id, body);
  }

  @Delete(":id")
  remove(@Param("id") id: string) {
    return this.campaigns.remove(id);
  }

  @Get(":id/runs")
  runs(@Param("id") id: string) {
    return this.campaigns.runs(id);
  }

  @Post(":id/runs")
  startRun(@Param("id") id: string, @Req() request: AuthenticatedRequest) {
    return this.campaigns.startRun(id, request.authUser!.userId);
  }

  @Get(":id/runs/:runId")
  run(@Param("id") id: string, @Param("runId") runId: string) {
    return this.campaigns.run(id, runId);
  }

  @Post(":id/runs/:runId/cancel")
  @HttpCode(200)
  cancelRun(@Param("id") id: string, @Param("runId") runId: string) {
    return this.campaigns.cancelRun(id, runId);
  }

  @Get(":id/prospects")
  prospects(@Param("id") id: string, @Query() query: Record<string, unknown>) {
    return this.campaigns.prospects(id, query);
  }

  @Get(":id/prospects/:prospectId")
  prospect(@Param("id") id: string, @Param("prospectId") prospectId: string) {
    return this.campaigns.prospect(id, prospectId);
  }

  @Post(":id/prospects/promote")
  @HttpCode(200)
  promote(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.campaigns.promote(id, body, request.authUser!.userId);
  }
}
