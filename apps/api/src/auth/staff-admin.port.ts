import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";

export const STAFF_AUTH_DIRECTORY = Symbol("STAFF_AUTH_DIRECTORY");

export interface StaffDirectoryUser {
  id: string;
  email: string | null;
  /** The name the super admin gave the person; null until one is set. */
  name?: string | null;
  createdAt: string;
  invitedAt: string | null;
  suspended: boolean;
  suspendedRoles: StaffRoleKey[];
}

import type { StaffRoleKey } from "../database/database.port";

/**
 * How a person is shown to others: their name, or, until one is set, their
 * email's first part tidied up ("john.evans@…" becomes "John Evans"). Never
 * the whole address.
 */
export function staffDisplayName(
  user: { name?: string | null; email?: string | null } | null | undefined,
): string {
  const name = user?.name?.trim();
  if (name) return name;
  const local = user?.email?.split("@")[0] ?? "";
  const words = local
    .split(/[._\-+\s]+/)
    .map((word) => word.replace(/\d+$/, ""))
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());
  return words.join(" ") || "Staff member";
}

export interface StaffAuthDirectory {
  listUsers(page: number, perPage: number): Promise<StaffDirectoryUser[]>;
  getUser(userId: string): Promise<StaffDirectoryUser | null>;
  /** Creates an account with an admin-chosen, temporary password. */
  createUser(
    email: string,
    password: string,
    name?: string,
  ): Promise<StaffDirectoryUser>;
  /** Sets the name others see; an empty name clears it. */
  setName(userId: string, name: string): Promise<void>;
  /**
   * A temporary password (set by the admin) must be replaced at the next
   * sign-in; the user's own password clears that requirement.
   */
  setPassword(
    userId: string,
    password: string,
    temporary: boolean,
  ): Promise<void>;
  setSuspended(
    userId: string,
    suspended: boolean,
    roleKeys?: StaffRoleKey[],
  ): Promise<void>;
  /**
   * Sign-in stops working at once. Without `keepHistory` the account is erased;
   * with it the account is anonymised and hidden but its row stays, so records
   * that point at it remain valid.
   */
  deleteUser(userId: string, keepHistory: boolean): Promise<void>;
  /**
   * A one-time code that lets the owner of `email` choose a new password, made
   * without sending anything. Null when there is no such account or it is
   * suspended. The code is a credential: only ever put it in an email.
   */
  createRecoveryCode(email: string): Promise<string | null>;
}

@Injectable()
export class SupabaseStaffAuthDirectory implements StaffAuthDirectory {
  private readonly client: SupabaseClient | undefined;

  constructor() {
    const url = (
      process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
    )
      ?.trim()
      .replace(/\/$/, "");
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
    if (url && serviceRoleKey) {
      this.client = createClient(url, serviceRoleKey, {
        auth: {
          autoRefreshToken: false,
          detectSessionInUrl: false,
          persistSession: false,
        },
      });
    }
  }

  async listUsers(
    page: number,
    perPage: number,
  ): Promise<StaffDirectoryUser[]> {
    const client = this.requireClient();
    const { data, error } = await client.auth.admin.listUsers({
      page,
      perPage,
    });
    if (error) throw this.providerUnavailable();
    return data.users
      .filter((user) => !user.deleted_at)
      .map((user) => this.toUser(user));
  }

  async getUser(userId: string): Promise<StaffDirectoryUser | null> {
    const { data, error } =
      await this.requireClient().auth.admin.getUserById(userId);
    if (error) {
      if (error.status === 404) return null;
      throw this.providerUnavailable();
    }
    return data.user && !data.user.deleted_at ? this.toUser(data.user) : null;
  }

  async createUser(
    email: string,
    password: string,
    name?: string,
  ): Promise<StaffDirectoryUser> {
    const { data, error } = await this.requireClient().auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      ...(name ? { user_metadata: { full_name: name } } : {}),
      app_metadata: { bjh_must_change_password: true },
    });
    if (error || !data.user) throw this.providerUnavailable();
    return this.toUser(data.user);
  }

  async setName(userId: string, name: string): Promise<void> {
    const client = this.requireClient();
    const { data, error: lookupError } =
      await client.auth.admin.getUserById(userId);
    if (lookupError || !data.user) throw this.providerUnavailable();
    const { error } = await client.auth.admin.updateUserById(userId, {
      user_metadata: { ...data.user.user_metadata, full_name: name || null },
    });
    if (error) throw this.providerUnavailable();
  }

  async setPassword(
    userId: string,
    password: string,
    temporary: boolean,
  ): Promise<void> {
    const client = this.requireClient();
    const { data, error: lookupError } =
      await client.auth.admin.getUserById(userId);
    if (lookupError || !data.user) throw this.providerUnavailable();
    const appMetadata = { ...data.user.app_metadata };
    // Supabase merges app_metadata on update: only null removes a key.
    appMetadata.bjh_must_change_password = temporary ? true : null;
    const { error } = await client.auth.admin.updateUserById(userId, {
      password,
      app_metadata: appMetadata,
    });
    if (error) throw this.providerUnavailable();
  }

  async setSuspended(
    userId: string,
    suspended: boolean,
    roleKeys: StaffRoleKey[] = [],
  ): Promise<void> {
    const client = this.requireClient();
    const { data, error: lookupError } =
      await client.auth.admin.getUserById(userId);
    if (lookupError || !data.user) throw this.providerUnavailable();
    const appMetadata = { ...data.user.app_metadata };
    // Supabase merges app_metadata on update: only null removes a key.
    appMetadata.bjh_suspended_roles = suspended ? roleKeys : null;
    const { error } = await client.auth.admin.updateUserById(userId, {
      app_metadata: appMetadata,
      ban_duration: suspended ? "876000h" : "none",
    });
    if (error) throw this.providerUnavailable();
  }

  async deleteUser(userId: string, keepHistory: boolean): Promise<void> {
    const { error } = await this.requireClient().auth.admin.deleteUser(
      userId,
      keepHistory,
    );
    if (error) throw this.providerUnavailable();
  }

  async createRecoveryCode(email: string): Promise<string | null> {
    const { data, error } = await this.requireClient().auth.admin.generateLink({
      type: "recovery",
      email,
    });
    if (error) {
      if (error.status === 404 || error.code === "user_not_found") return null;
      throw this.providerUnavailable();
    }
    if (!data.user || this.toUser(data.user).suspended) return null;
    return data.properties.email_otp;
  }

  private requireClient(): SupabaseClient {
    if (!this.client) throw this.providerUnavailable();
    return this.client;
  }

  private providerUnavailable(): ServiceUnavailableException {
    return new ServiceUnavailableException(
      "Staff account service is unavailable",
    );
  }

  private toUser(user: {
    id: string;
    email?: string;
    created_at: string;
    invited_at?: string;
    app_metadata?: Record<string, unknown>;
    user_metadata?: Record<string, unknown>;
  }): StaffDirectoryUser {
    const name = user.user_metadata?.full_name;
    return {
      id: user.id,
      email: user.email ?? null,
      name: typeof name === "string" && name.trim() ? name.trim() : null,
      createdAt: user.created_at,
      invitedAt: user.invited_at ?? null,
      suspended: Array.isArray(user.app_metadata?.bjh_suspended_roles),
      suspendedRoles: Array.isArray(user.app_metadata?.bjh_suspended_roles)
        ? (user.app_metadata.bjh_suspended_roles as StaffRoleKey[])
        : [],
    };
  }
}
