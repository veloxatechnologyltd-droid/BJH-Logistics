import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";

export const STAFF_AUTH_DIRECTORY = Symbol("STAFF_AUTH_DIRECTORY");

export interface StaffDirectoryUser {
  id: string;
  email: string | null;
  createdAt: string;
  invitedAt: string | null;
  suspended: boolean;
  suspendedRoles: StaffRoleKey[];
}

import type { StaffRoleKey } from "../database/database.port";

export interface StaffAuthDirectory {
  listUsers(page: number, perPage: number): Promise<StaffDirectoryUser[]>;
  getUser(userId: string): Promise<StaffDirectoryUser | null>;
  /** Creates an account with an admin-chosen, temporary password. */
  createUser(email: string, password: string): Promise<StaffDirectoryUser>;
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
    return data.users.map((user) => this.toUser(user));
  }

  async getUser(userId: string): Promise<StaffDirectoryUser | null> {
    const { data, error } =
      await this.requireClient().auth.admin.getUserById(userId);
    if (error) {
      if (error.status === 404) return null;
      throw this.providerUnavailable();
    }
    return data.user ? this.toUser(data.user) : null;
  }

  async createUser(
    email: string,
    password: string,
  ): Promise<StaffDirectoryUser> {
    const { data, error } = await this.requireClient().auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      app_metadata: { bjh_must_change_password: true },
    });
    if (error || !data.user) throw this.providerUnavailable();
    return this.toUser(data.user);
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
  }): StaffDirectoryUser {
    return {
      id: user.id,
      email: user.email ?? null,
      createdAt: user.created_at,
      invitedAt: user.invited_at ?? null,
      suspended: Array.isArray(user.app_metadata?.bjh_suspended_roles),
      suspendedRoles: Array.isArray(user.app_metadata?.bjh_suspended_roles)
        ? (user.app_metadata.bjh_suspended_roles as StaffRoleKey[])
        : [],
    };
  }
}
