import {
  Body,
  Controller,
  HttpCode,
  Inject,
  Post,
  UseGuards,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { ClientIpThrottlerGuard } from "./client-ip-throttler.guard";
import { PasswordResetService } from "./password-reset.service";

/** Open to anyone who is not signed in, so it is limited per address and per visitor. */
@Controller("api/v1/auth/password-reset")
@UseGuards(ClientIpThrottlerGuard)
export class PasswordResetController {
  constructor(
    @Inject(PasswordResetService)
    private readonly reset: PasswordResetService,
  ) {}

  @Post()
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  request(@Body() body: unknown) {
    return this.reset.request(body);
  }
}
