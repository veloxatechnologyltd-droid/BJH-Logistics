import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  customerAccountCreateInputSchema,
  parseContract,
} from "@bjh/contracts";
import { DatabasePort } from "../database/database.port";
import type { AuthenticatedUser } from "./supabase-auth-verifier";
import { STAFF_AUTH_DIRECTORY } from "./staff-admin.port";
import type { StaffAuthDirectory } from "./staff-admin.port";

/**
 * Customer accounts are created by the super admin, like staff accounts: an
 * email and a password chosen by the admin, linked to one company. The account
 * has no staff role, so it can only ever see its own companies' records.
 */
@Injectable()
export class AdminCustomerAccountsService {
  constructor(
    @Inject(DatabasePort) private readonly database: DatabasePort,
    @Inject(STAFF_AUTH_DIRECTORY) private readonly auth: StaffAuthDirectory,
  ) {}

  async list() {
    const memberships = await this.database.listActiveCustomerMemberships();
    const byUser = new Map<string, typeof memberships>();
    for (const membership of memberships) {
      byUser.set(membership.userId, [
        ...(byUser.get(membership.userId) ?? []),
        membership,
      ]);
    }
    const accounts = [];
    for (const [userId, companies] of byUser) {
      const user = await this.auth.getUser(userId);
      if (!user) continue;
      accounts.push({
        id: user.id,
        email: user.email,
        createdAt: user.createdAt,
        suspended: user.suspended,
        companies: companies.map(({ companyId, companyName }) => ({
          companyId,
          companyName,
        })),
      });
    }
    return accounts;
  }

  /**
   * Accounts people opened themselves that have no staff role and no company
   * yet: the admin links each to its company (or gives a staff role under
   * staff management) before it can see anything.
   */
  async listPending() {
    const pageSize = 200;
    const users = [];
    for (let page = 1; ; page += 1) {
      const batch = await this.auth.listUsers(page, pageSize);
      users.push(...batch);
      if (batch.length < pageSize) break;
    }
    const [roles, memberships] = await Promise.all([
      this.database.listStaffRoleAssignments(),
      this.database.listActiveCustomerMemberships(),
    ]);
    const placed = new Set([
      ...roles.filter((role) => !role.revokedAt).map((role) => role.userId),
      ...memberships.map((membership) => membership.userId),
    ]);
    return users
      .filter((user) => !placed.has(user.id) && !user.suspended)
      .map(({ id, email, createdAt }) => ({ id, email, createdAt }));
  }

  async create(body: unknown, actor: AuthenticatedUser) {
    const parsed = parseContract(customerAccountCreateInputSchema, body);
    if (!parsed.success) throw new BadRequestException(parsed.message);
    const email = parsed.data.email.toLowerCase();
    if (parsed.data.password.length < 12) {
      throw new BadRequestException("Password must be at least 12 characters");
    }
    const company = await this.database.findCustomer(parsed.data.companyId);
    if (!company) throw new NotFoundException("Customer company was not found");
    const user = await this.auth.createUser(email, parsed.data.password);
    const membership = await this.database.grantCustomerMembership(
      company.id,
      user.id,
      actor.userId,
    );
    if (membership === "already_active") {
      throw new ConflictException(
        "The customer-company membership is already active",
      );
    }
    return {
      user: { id: user.id, email: user.email },
      company: { companyId: company.id, companyName: company.companyName },
    };
  }

  async setPassword(userId: string, body: unknown) {
    await this.requireCustomerAccount(userId);
    const password =
      body &&
      typeof body === "object" &&
      typeof (body as Record<string, unknown>).password === "string"
        ? (body as Record<string, string>).password
        : "";
    if (password.length < 12) {
      throw new BadRequestException("Password must be at least 12 characters");
    }
    await this.auth.setPassword(userId, password, true);
    return { userId, passwordChanged: true };
  }

  /** Suspending blocks sign-in; the company memberships are kept for reactivation. */
  async setSuspended(userId: string, suspended: boolean) {
    const user = await this.requireCustomerAccount(userId);
    if (user.suspended === suspended) {
      throw new ConflictException(
        suspended
          ? "Customer account is already suspended"
          : "Customer account is already active",
      );
    }
    await this.auth.setSuspended(userId, suspended);
    return { userId, suspended };
  }

  private async requireCustomerAccount(userId: string) {
    const user = await this.auth.getUser(userId);
    const memberships = user
      ? await this.database.listCustomerMemberships(userId)
      : [];
    if (!user || memberships.length === 0) {
      throw new NotFoundException("Customer account was not found");
    }
    if ((await this.database.getActiveStaffRoles(userId)).length > 0) {
      throw new ConflictException(
        "This is a staff account: manage it under staff management",
      );
    }
    return user;
  }
}
