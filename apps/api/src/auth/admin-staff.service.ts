import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  parseContract,
  staffCreateInputSchema,
  staffRoleInputSchema,
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

const staffRoles: StaffRoleKey[] = [
  "super_admin",
  "air_import_rep",
  "air_export_rep",
  "sea_import_rep",
  "sea_export_rep",
];
const pageSize = 100;

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
    const user = await this.auth.createUser(email, input.password);
    const assignment = await this.assignRole(user, input.roleKey, actor.userId);
    return { user, assignment };
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
      for (const roleKey of user.suspendedRoles) {
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
    if (password.length < 12) {
      throw new BadRequestException("Password must be at least 12 characters");
    }
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
