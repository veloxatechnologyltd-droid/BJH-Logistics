import {
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface AuthenticatedUser {
  userId: string;
  email: string | null;
  /** Set by the admin on a password they chose; cleared when the user picks their own. */
  mustChangePassword?: boolean;
  /** "aal2" once a second factor was verified in this sign-in. */
  aal?: string | null;
}

@Injectable()
export class SupabaseAuthVerifier {
  private readonly projectUrl: string | undefined;
  private readonly client: SupabaseClient | undefined;

  constructor() {
    this.projectUrl = (
      process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
    )?.replace(/\/$/, "");
    const publishableKey =
      process.env.SUPABASE_PUBLISHABLE_KEY ??
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

    if (this.projectUrl && publishableKey) {
      this.client = createClient(this.projectUrl, publishableKey, {
        auth: {
          autoRefreshToken: false,
          detectSessionInUrl: false,
          persistSession: false,
        },
      });
    }
  }

  async verify(accessToken: string): Promise<AuthenticatedUser> {
    if (!this.client || !this.projectUrl) {
      throw new ServiceUnavailableException("Supabase Auth is not configured");
    }

    let verification: Awaited<ReturnType<SupabaseClient["auth"]["getClaims"]>>;
    try {
      verification = await this.client.auth.getClaims(accessToken);
    } catch {
      throw new ServiceUnavailableException(
        "Supabase Auth is unavailable for token verification",
      );
    }

    const { data, error } = verification;
    const claims = data?.claims as Record<string, unknown> | undefined;
    const audience = claims?.aud;
    const hasAuthenticatedAudience =
      audience === "authenticated" ||
      (Array.isArray(audience) && audience.includes("authenticated"));

    if (
      error ||
      !claims ||
      typeof claims.sub !== "string" ||
      claims.iss !== `${this.projectUrl}/auth/v1` ||
      !hasAuthenticatedAudience
    ) {
      throw new UnauthorizedException(
        "Invalid or expired Supabase access token",
      );
    }

    const appMetadata = claims.app_metadata as
      Record<string, unknown> | undefined;
    return {
      userId: claims.sub,
      email: typeof claims.email === "string" ? claims.email : null,
      mustChangePassword: appMetadata?.bjh_must_change_password === true,
      aal: typeof claims.aal === "string" ? claims.aal : null,
    };
  }
}
