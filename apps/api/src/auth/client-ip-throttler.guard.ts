import { Injectable } from "@nestjs/common";
import { ThrottlerGuard } from "@nestjs/throttler";

/**
 * The address a request counts against. Behind Render every request arrives
 * from Render's front door, so the socket address is the same for everyone.
 * Render's traffic passes through Cloudflare, which writes the visitor's real
 * address into `CF-Connecting-IP` and replaces any copy the caller sent.
 * `CLIENT_IP_HEADER` names that header; it stays unset locally and in tests,
 * where the socket address is the right answer, because a caller who can reach
 * the API directly could forge the header.
 */
interface AddressedRequest {
  ip?: string;
  headers?: Record<string, string | string[] | undefined>;
}

export function clientAddress(
  request: AddressedRequest,
  environment: NodeJS.ProcessEnv = process.env,
): string {
  const name = environment.CLIENT_IP_HEADER?.trim().toLowerCase();
  const value = name ? request.headers?.[name] : undefined;
  const address = (Array.isArray(value) ? value[0] : value)?.trim();
  return address || request.ip || "unknown";
}

@Injectable()
export class ClientIpThrottlerGuard extends ThrottlerGuard {
  protected override async getTracker(
    request: AddressedRequest,
  ): Promise<string> {
    return clientAddress(request);
  }
}
