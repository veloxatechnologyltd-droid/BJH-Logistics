import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  legacyRoleReplacement,
  legacyStaffRoleKeys,
  parseContract,
  passwordProblem,
  staffCreateInputSchema,
  staffRoleInputSchema,
  staffRoleKeys,
  type LegacyStaffRoleKey,
  type StaffCreateInput,
  type StaffRoleInput,
} from "@bjh/contracts";
import { DatabasePort, StaffRoleKey } from "../database/database.port";
import type { AuthenticatedUser } from "./supabase-auth-verifier";
import { STAFF_AUTH_DIRECTORY } from "./staff-admin.port";
import type {
  StaffAuthDirectory,
  StaffDirectoryUser,
} from "./staff-admin.port";

// Legacy roles can still be revoked, though no longer assigned.
const staffRoles: StaffRoleKey[] = [...staffRoleKeys, ...legacyStaffRoleKeys];

/** A suspended account may have been suspended under a legacy role: restore its replacement. */
function currentRoles(roles: StaffRoleKey[]): StaffRoleKey[] {
  const current = roles.map(
    (role) => legacyRoleReplacement[role as LegacyStaffRoleKey] ?? role,
  );
  return [...new Set(current)];
}
const pageSize = 100;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const deleteRefusals = {
  self: "You cannot delete your own account",
  super_admin: "The super admin account cannot be deleted",
  customer:
    "This is a customer account: remove it under Customer accounts instead",
} as const;
type DeleteRefusal = keyof typeof deleteRefusals;

@Injectable()
export class AdminStaffService {
  constructor(
    @Inject(DatabasePort) private readonly database: DatabasePort,
    @Inject(STAFF_AUTH_DIRECTORY) private readonly auth: StaffAuthDirectory,
  ) {}

  async list(pageValue: string | undefined) {
    const page = pageValue === undefined ? 1 : Number(pageValue);
    if (!Number.isInteger(page) || page < 1) {
      throw new BadRequestException("page must be a positive integer");
    }
    const [users, assignments] = await Promise.all([
      this.auth.listUsers(page, pageSize),
      this.database.listStaffRoleAssignments(),
    ]);
    const assignmentUsers = new Map<string, typeof assignments>();
    for (const assignment of assignments) {
      const userAssignments = assignmentUsers.get(assignment.userId) ?? [];
      userAssignments.push(assignment);
      assignmentUsers.set(assignment.userId, userAssignments);
    }
    return {
      users: users.map((user) => ({
        ...user,
        assignments: assignmentUsers.get(user.id) ?? [],
      })),
      hasMore: users.length === pageSize,
      page,
    };
  }

  async create(body: unknown, actor: AuthenticatedUser) {
    const input = this.readCreateInput(body);
    const email = input.email.trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new BadRequestException("A valid email address is required");
    }
    this.validatePassword(input.password);
    const user = await this.auth.createUser(
      email,
      input.password,
      input.name || undefined,
    );
    const assignment = await this.assignRole(user, input.roleKey, actor.userId);
    return { user, assignment };
  }

  async setName(userId: string, body: unknown) {
    const user = await this.auth.getUser(userId);
    if (!user) throw new NotFoundException("Staff account was not found");
    const name =
      body &&
      typeof body === "object" &&
      typeof (body as Record<string, unknown>).name === "string"
        ? (body as Record<string, string>).name.trim()
        : "";
    if (name.length > 80) {
      throw new BadRequestException("Name must be 80 characters or fewer");
    }
    await this.auth.setName(userId, name);
    return { user: { ...user, name: name || null } };
  }

  async setPassword(userId: string, body: unknown) {
    const user = await this.auth.getUser(userId);
    if (!user) throw new NotFoundException("Staff account was not found");
    const password =
      body &&
      typeof body === "object" &&
      typeof (body as Record<string, unknown>).password === "string"
        ? (body as Record<string, string>).password
        : "";
    this.validatePassword(password);
    await this.auth.setPassword(userId, password, true);
    return { user, passwordChanged: true };
  }

  async setSuspended(
    userId: string,
    suspended: boolean,
    actor: AuthenticatedUser,
  ) {
    const user = await this.auth.getUser(userId);
    if (!user) throw new NotFoundException("Staff account was not found");
    if (user.suspended === suspended) {
      throw new ConflictException(
        suspended
          ? "Staff account is already suspended"
          : "Staff account is already active",
      );
    }

    if (!suspended) {
      const restored: StaffRoleKey[] = [];
      for (const roleKey of currentRoles(user.suspendedRoles)) {
        const assignment = await this.database.assignStaffRole(
          userId,
          roleKey,
          actor.userId,
        );
        if (
          assignment === "super_admin_exists" ||
          assignment === "already_active"
        ) {
          for (const restoredRole of restored) {
            await this.database.revokeStaffRole(
              userId,
              restoredRole,
              actor.userId,
            );
          }
          throw new ConflictException("Staff roles could not be restored");
        }
        restored.push(roleKey);
      }
      try {
        await this.auth.setSuspended(userId, false);
      } catch (error) {
        for (const roleKey of restored) {
          await this.database.revokeStaffRole(userId, roleKey, actor.userId);
        }
        throw error;
      }
      return { user: await this.auth.getUser(userId), suspended: false };
    }

    const roleKeys = await this.database.getActiveStaffRoles(userId);
    await this.auth.setSuspended(userId, true, roleKeys);
    const revoked: StaffRoleKey[] = [];
    try {
      for (const roleKey of [
        ...roleKeys.filter((role) => role === "super_admin"),
        ...roleKeys.filter((role) => role !== "super_admin"),
      ]) {
        const result = await this.database.revokeStaffRole(
          userId,
          roleKey,
          actor.userId,
        );
        if (result === "last_super_admin") {
          throw new ConflictException(
            "The last super_admin account cannot be suspended",
          );
        }
        if (result === "revoked") revoked.push(roleKey);
      }
    } catch (error) {
      for (const roleKey of revoked) {
        await this.database.assignStaffRole(userId, roleKey, actor.userId);
      }
      await this.auth.setSuspended(userId, false);
      throw error;
    }
    return { user: await this.auth.getUser(userId), suspended: true };
  }

  async assign(userId: string, body: unknown, actor: AuthenticatedUser) {
    const input = this.readRoleInput(body);
    const user = await this.auth.getUser(userId);
    if (!user) throw new NotFoundException("Staff account was not found");
    if (user.suspended) {
      throw new ConflictException(
        "Reactivate the staff account before assigning roles",
      );
    }
    const assignment = await this.assignRole(user, input.roleKey, actor.userId);
    return { user, assignment };
  }

  async revoke(userId: string, roleValue: string, actor: AuthenticatedUser) {
    const roleKey = this.parseRole(roleValue);
    const user = await this.auth.getUser(userId);
    if (!user) throw new NotFoundException("Staff account was not found");
    const result = await this.database.revokeStaffRole(
      userId,
      roleKey,
      actor.userId,
    );
    if (result === "last_super_admin") {
      throw new ConflictException(
        "The last super_admin role cannot be revoked",
      );
    }
    if (result === "not_found") {
      throw new NotFoundException("The active staff role was not found");
    }
    return { user, roleKey, revoked: true };
  }

  /** Deletes one account; says why in a 409 when it cannot be deleted. */
  async remove(userId: string, actor: AuthenticatedUser) {
    const reason = await this.deleteAccount(userId, actor.userId);
    if (reason === "not_found") {
      throw new NotFoundException("Staff account was not found");
    }
    if (reason) throw new ConflictException(deleteRefusals[reason]);
    return { deleted: true };
  }

  /** Deletes several; one that cannot be deleted does not stop the rest. */
  async removeMany(body: unknown, actor: AuthenticatedUser) {
    const userIds =
      body && typeof body === "object"
        ? (body as Record<string, unknown>).userIds
        : undefined;
    if (
      !Array.isArray(userIds) ||
      userIds.length === 0 ||
      userIds.length > 50 ||
      userIds.some((id) => typeof id !== "string" || !uuidPattern.test(id))
    ) {
      throw new BadRequestException(
        "userIds must list between 1 and 50 account ids",
      );
    }
    const deleted: string[] = [];
    const failed: { userId: string; reason: string }[] = [];
    for (const userId of new Set(userIds as string[])) {
      const reason = await this.deleteAccount(userId, actor.userId);
      if (!reason) deleted.push(userId);
      else
        failed.push({
          userId,
          reason:
            reason === "not_found"
              ? "Account no longer exists"
              : deleteRefusals[reason],
        });
    }
    return { deleted, failed };
  }

  private async deleteAccount(
    userId: string,
    actorId: string,
  ): Promise<DeleteRefusal | "not_found" | null> {
    if (userId === actorId) return "self";
    const user = await this.auth.getUser(userId);
    if (!user) return "not_found";
    const roleKeys = await this.database.getActiveStaffRoles(userId);
    if (roleKeys.includes("super_admin")) return "super_admin";
    const memberships = await this.database.listActiveCustomerMemberships();
    if (memberships.some((membership) => membership.userId === userId)) {
      return "customer";
    }
    const history = await this.database.releaseStaffAccountForDeletion(userId);
    if (history === "has_history") {
      // The account row stays so its records keep their place: take its access away.
      for (const roleKey of roleKeys) {
        await this.database.revokeStaffRole(userId, roleKey, actorId);
      }
    }
    await this.auth.deleteUser(userId, history === "has_history");
    return null;
  }

  private async assignRole(
    user: StaffDirectoryUser,
    roleKey: StaffRoleKey,
    actorId: string,
  ) {
    const assignment = await this.database.assignStaffRole(
      user.id,
      roleKey,
      actorId,
    );
    if (assignment === "super_admin_exists") {
      throw new ConflictException("An active super_admin role already exists");
    }
    if (assignment === "already_active") {
      throw new ConflictException("This staff role is already active");
    }
    return assignment;
  }

  private readRoleInput(body: unknown): StaffRoleInput {
    const result = parseContract(staffRoleInputSchema, body);
    if (!result.success) throw new BadRequestException(result.message);
    return result.data;
  }

  private readCreateInput(body: unknown): StaffCreateInput {
    const result = parseContract(staffCreateInputSchema, body);
    if (!result.success) throw new BadRequestException(result.message);
    return result.data;
  }

  private validatePassword(password: string) {
    const problem = passwordProblem(password);
    if (problem) throw new BadRequestException(problem);
  }

  private parseRole(value: unknown): StaffRoleKey {
    if (
      typeof value !== "string" ||
      !staffRoles.includes(value as StaffRoleKey)
    ) {
      throw new BadRequestException("roleKey is not a supported staff role");
    }
    return value as StaffRoleKey;
  }
}
