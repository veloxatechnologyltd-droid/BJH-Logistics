import {
  Controller,
  Get,
  Header,
  Inject,
  Param,
  UseGuards,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { ClientIpThrottlerGuard } from "../auth/client-ip-throttler.guard";
import { TrackingService } from "./tracking.service";

/**
 * Open to anyone, with no sign-in: the tracking number is the only key. The
 * visitor's browser calls this directly (not through a server on the site), so
 * the limit counts each visitor's own address and a guesser is slowed down.
 * The browser may read it from any origin because it carries no credentials.
 */
@Controller("api/v1/track")
@UseGuards(ClientIpThrottlerGuard)
export class TrackingController {
  constructor(
    @Inject(TrackingService) private readonly tracking: TrackingService,
  ) {}

  @Get(":number")
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Header("Cache-Control", "no-store")
  @Header("Access-Control-Allow-Origin", "*")
  @Header("Cross-Origin-Resource-Policy", "cross-origin")
  find(@Param("number") number: string) {
    return this.tracking.find(number);
  }
}
