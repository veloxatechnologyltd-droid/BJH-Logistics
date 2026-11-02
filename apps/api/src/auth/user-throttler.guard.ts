import { Injectable } from "@nestjs/common";
import { ThrottlerGuard } from "@nestjs/throttler";
import { clientAddress } from "./client-ip-throttler.guard";

interface SignedInRequest {
  ip?: string;
  headers?: Record<string, string | string[] | undefined>;
  authUser?: { userId: string };
}

/**
 * Limits one signed-in person rather than one address, so an office sharing a
 * connection is not throttled together. Put it after the identity guard on the
 * routes that are expensive (model calls, uploads, search); an unsigned request
 * falls back to its address.
 */
@Injectable()
export class UserThrottlerGuard extends ThrottlerGuard {
  protected override async getTracker(
    request: SignedInRequest,
  ): Promise<string> {
    return request.authUser
      ? `user:${request.authUser.userId}`
      : clientAddress(request);
  }
}
