import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Inject,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import {
  DepartmentStaffGuard,
  SupabaseIdentityGuard,
} from "../auth/auth.guards";
import type { AuthenticatedRequest } from "../auth/auth.guards";
import { UserThrottlerGuard } from "../auth/user-throttler.guard";
import { PushService } from "./push.service";

/** A staff member turning notifications on or off for their own browser. Customers are refused. */
@Controller("api/v1/push")
@UseGuards(SupabaseIdentityGuard, DepartmentStaffGuard)
export class PushController {
  constructor(@Inject(PushService) private readonly push: PushService) {}

  @Get("key")
  key() {
    return this.push.publicKey();
  }

  @Post("subscriptions")
  @UseGuards(UserThrottlerGuard)
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  subscribe(
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
    @Headers("user-agent") userAgent: string | undefined,
  ) {
    return this.push.subscribe(
      request.authUser!.userId,
      body,
      userAgent ?? null,
    );
  }

  @Delete("subscriptions")
  @UseGuards(UserThrottlerGuard)
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  unsubscribe(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    return this.push.unsubscribe(request.authUser!.userId, body);
  }
}
