import {
  Body,
  Controller,
  Get,
  Inject,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { SupabaseIdentityGuard } from "./auth.guards";
import type { AuthenticatedRequest } from "./auth.guards";
import { AuthService } from "./auth.service";
import { ClientIpThrottlerGuard } from "./client-ip-throttler.guard";

@Controller("api/v1/auth")
@UseGuards(ClientIpThrottlerGuard)
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Get("bootstrap-status")
  bootstrapStatus() {
    return this.auth.bootstrapStatus();
  }

  @Post("bootstrap-super-admin")
  @UseGuards(SupabaseIdentityGuard)
  bootstrapSuperAdmin(@Req() request: AuthenticatedRequest) {
    return this.auth.bootstrapSuperAdmin(request.authUser!);
  }

  // Every page load asks who is signed in, and staff on one office connection
  // (or behind one proxy address) share a bucket, so this ceiling sits far
  // above the 30 a minute that protects the bootstrap routes.
  @Get("session")
  @Throttle({ default: { limit: 600, ttl: 60_000 } })
  @UseGuards(SupabaseIdentityGuard)
  getSession(@Req() request: AuthenticatedRequest) {
    return this.auth.getSession(request.authUser!);
  }

  // Open to an account that still has to replace an admin-set password, so it
  // sits outside the role guards (which refuse such an account).
  @Post("password")
  @UseGuards(SupabaseIdentityGuard)
  changePassword(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    return this.auth.changeOwnPassword(request.authUser!, body);
  }
}
