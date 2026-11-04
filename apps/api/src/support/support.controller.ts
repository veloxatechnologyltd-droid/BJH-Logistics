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
import { Throttle } from "@nestjs/throttler";
import {
  StaffCompanyReadGuard,
  SuperAdminGuard,
  SupabaseIdentityGuard,
} from "../auth/auth.guards";
import type { AuthenticatedRequest } from "../auth/auth.guards";
import { UserThrottlerGuard } from "../auth/user-throttler.guard";
import { SupportService } from "./support.service";

/** Report a problem, ask for a feature or ask a question: staff and customers. */
@Controller("api/v1/support")
@UseGuards(SupabaseIdentityGuard)
export class SupportController {
  constructor(
    @Inject(SupportService) private readonly support: SupportService,
  ) {}

  /** Ten a minute per person: enough for anyone, not enough to flood the inbox. */
  @Post()
  @UseGuards(StaffCompanyReadGuard, UserThrottlerGuard)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  create(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    return this.support.create(
      {
        userId: request.authUser!.userId,
        email: request.authUser!.email ?? null,
        companyIds: request.allowedCompanyIds,
      },
      body,
    );
  }

  /** The signed-in person's own requests and their status. */
  @Get("mine")
  @UseGuards(StaffCompanyReadGuard)
  mine(@Req() request: AuthenticatedRequest) {
    return this.support.mine(request.authUser!.userId);
  }

  @Get()
  @UseGuards(SuperAdminGuard)
  all() {
    return this.support.all();
  }

  @Patch(":id")
  @UseGuards(SuperAdminGuard)
  setStatus(@Param("id") id: string, @Body() body: unknown) {
    return this.support.setStatus(id, body);
  }
}
