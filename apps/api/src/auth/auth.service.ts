import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
} from "@nestjs/common";
import { DatabasePort } from "../database/database.port";
import { superAdminMfaRequired } from "./auth.guards";
import { STAFF_AUTH_DIRECTORY } from "./staff-admin.port";
import type { StaffAuthDirectory } from "./staff-admin.port";
import type { AuthenticatedUser } from "./supabase-auth-verifier";

@Injectable()
export class AuthService {
  constructor(
    @Inject(DatabasePort) private readonly database: DatabasePort,
    @Inject(STAFF_AUTH_DIRECTORY) private readonly accounts: StaffAuthDirectory,
  ) {}

  async bootstrapStatus(): Promise<{ bootstrapAvailable: boolean }> {
    return {
      bootstrapAvailable:
        this.bootstrapEnabled() && !(await this.database.hasActiveSuperAdmin()),
    };
  }

  async bootstrapSuperAdmin(user: AuthenticatedUser) {
    if (!this.bootstrapEnabled()) {
      throw new ForbiddenException("Super-admin bootstrap is disabled");
    }

    const assigned = await this.database.claimInitialSuperAdmin(user.userId);
    if (!assigned) {
      throw new ConflictException(
        "The initial super_admin account is already set up",
      );
    }

    return {
      userId: user.userId,
      email: user.email,
      roles: ["super_admin"],
    };
  }

  /**
   * Staff get their roles; a customer gets the companies linked to the account.
   * Both say whether a new password or a second sign-in step comes first.
   */
  async getSession(user: AuthenticatedUser) {
    const roles = await this.database.getActiveStaffRoles(user.userId);
    const mustChangePassword = user.mustChangePassword === true;
    if (roles.length > 0) {
      return {
        userId: user.userId,
        email: user.email,
        roles,
        mustChangePassword,
        twoFactorRequired:
          roles.includes("super_admin") &&
          superAdminMfaRequired() &&
          user.aal !== "aal2",
      };
    }
    const memberships = (
      await this.database.listActiveCustomerMemberships()
    ).filter((membership) => membership.userId === user.userId);
    if (memberships.length === 0) {
      throw new ForbiddenException(
        "An active staff role or customer-company membership is required",
      );
    }
    return {
      userId: user.userId,
      email: user.email,
      roles: [] as string[],
      mustChangePassword,
      twoFactorRequired: false,
      companies: memberships.map(({ companyId, companyName }) => ({
        companyId,
        companyName,
      })),
    };
  }

  /**
   * The signed-in user replaces their own password: after an admin set a
   * temporary one, or from a password-reset email link. Clears the
   * must-change requirement; the browser then refreshes its token.
   */
  async changeOwnPassword(user: AuthenticatedUser, body: unknown) {
    const password =
      body &&
      typeof body === "object" &&
      typeof (body as Record<string, unknown>).password === "string"
        ? (body as Record<string, string>).password
        : "";
    if (password.length < 12) {
      throw new BadRequestException("Password must be at least 12 characters");
    }
    await this.accounts.setPassword(user.userId, password, false);
    return { passwordChanged: true };
  }

  private bootstrapEnabled(): boolean {
    return (
      process.env.NODE_ENV !== "production" &&
      process.env.SUPER_ADMIN_BOOTSTRAP_ENABLED === "true"
    );
  }
}
