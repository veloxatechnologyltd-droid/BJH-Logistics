import "reflect-metadata";
import assert from "node:assert/strict";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { after, before, test } from "node:test";
import { AddressInfo } from "node:net";
import { DatabasePort } from "../src/database/database.port";
import { STAFF_AUTH_DIRECTORY } from "../src/auth/staff-admin.port";
import type {
  StaffAuthDirectory,
  StaffDirectoryUser,
} from "../src/auth/staff-admin.port";
import { SupabaseAuthVerifier } from "../src/auth/supabase-auth-verifier";
import {
  beginTestDatabase,
  endTestDatabase,
  testPostgresPool,
} from "./postgres-test-database";
import { POSTGRES_POOL } from "../src/database/postgres-database.service";

const adminId = "50000000-0000-4000-8000-000000000001";
const staffId = "50000000-0000-4000-8000-000000000002";
const invitedId = "50000000-0000-4000-8000-000000000003";
const adminToken = "test-admin-token";
const staffToken = "test-staff-token";

let application: INestApplication;
let baseUrl: string;
let createdAccount: { email: string; password: string } | null;
const originalWebOrigin = process.env.WEB_ORIGIN;

const users = new Map<string, StaffDirectoryUser>([
  [
    adminId,
    {
      id: adminId,
      email: "admin@example.test",
      createdAt: "2026-09-28T10:00:00.000Z",
      invitedAt: null,
      suspended: false,
      suspendedRoles: [],
    },
  ],
  [
    staffId,
    {
      id: staffId,
      email: "staff@example.test",
      createdAt: "2026-09-28T10:00:00.000Z",
      invitedAt: null,
      suspended: false,
      suspendedRoles: [],
    },
  ],
]);

const directory: StaffAuthDirectory = {
  async listUsers(page, perPage) {
    return [...users.values()].slice((page - 1) * perPage, page * perPage);
  },
  async getUser(userId) {
    return users.get(userId) ?? null;
  },
  async createUser(email, password) {
    createdAccount = { email, password };
    const user = {
      id: invitedId,
      email,
      createdAt: "2026-09-28T10:00:00.000Z",
      invitedAt: null,
      suspended: false,
      suspendedRoles: [],
    };
    users.set(invitedId, user);
    return user;
  },
  async setPassword() {},
  async setSuspended(userId, suspended, roles = []) {
    const user = users.get(userId);
    if (user) users.set(userId, { ...user, suspended, suspendedRoles: roles });
  },
};

before(async () => {
  createdAccount = null;
  await beginTestDatabase();
  process.env.WEB_ORIGIN = "http://127.0.0.1:3002";
  const { AppModule } = await import("../src/app.module");
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(POSTGRES_POOL)
    .useValue(testPostgresPool)
    .overrideProvider(SupabaseAuthVerifier)
    .useValue({
      async verify(token: string) {
        if (token === adminToken)
          return { userId: adminId, email: "admin@example.test" };
        if (token === staffToken)
          return { userId: staffId, email: "staff@example.test" };
        throw new Error("Invalid token");
      },
    })
    .overrideProvider(STAFF_AUTH_DIRECTORY)
    .useValue(directory)
    .compile();
  application = module.createNestApplication({ logger: false });
  await application.init();
  await application.get(DatabasePort).claimInitialSuperAdmin(adminId);
  await application.listen(0, "127.0.0.1");
  const address = application.getHttpServer().address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await application?.close();
  if (originalWebOrigin === undefined) delete process.env.WEB_ORIGIN;
  else process.env.WEB_ORIGIN = originalWebOrigin;
  await endTestDatabase();
});

function call(path: string, token?: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (token) headers.set("authorization", `Bearer ${token}`);
  return fetch(`${baseUrl}${path}`, { ...init, headers });
}

test("staff administration requires a super_admin role", async () => {
  assert.equal((await call("/api/v1/admin/staff")).status, 401);
  assert.equal((await call("/api/v1/admin/staff", staffToken)).status, 403);
});

test("super admin creates an account directly with a password and role", async () => {
  const response = await call("/api/v1/admin/staff", adminToken, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: " new@example.test ",
      password: "secure-example-password",
      roleKey: "export_rep",
    }),
  });
  assert.equal(response.status, 201);
  assert.equal(createdAccount?.email, "new@example.test");
  assert.equal(createdAccount?.password, "secure-example-password");
  const data = (await response.json()) as {
    assignment: { roleKey: string; assignedBy: string };
  };
  assert.equal(data.assignment.roleKey, "export_rep");
  assert.equal(data.assignment.assignedBy, adminId);
});

test("super admin can assign and revoke roles while preserving history", async () => {
  const assigned = await call(
    `/api/v1/admin/staff/${staffId}/roles`,
    adminToken,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ roleKey: "import_rep" }),
    },
  );
  assert.equal(assigned.status, 201);
  const revoked = await call(
    `/api/v1/admin/staff/${staffId}/roles/import_rep`,
    adminToken,
    { method: "DELETE" },
  );
  assert.equal(revoked.status, 200);
  const list = await call("/api/v1/admin/staff", adminToken);
  const data = (await list.json()) as {
    users: Array<{
      id: string;
      assignments: Array<{ roleKey: string; revokedAt: string | null }>;
    }>;
  };
  const staff = data.users.find((user) => user.id === staffId);
  assert.equal(staff?.assignments.length, 1);
  assert.equal(staff?.assignments[0].roleKey, "import_rep");
  assert.ok(staff?.assignments[0].revokedAt);
});

test("admin API rejects unsupported roles and protects the last super admin", async () => {
  const invalid = await call(
    `/api/v1/admin/staff/${staffId}/roles`,
    adminToken,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ roleKey: "finance_admin" }),
    },
  );
  assert.equal(invalid.status, 400);
  const revokeLastAdmin = await call(
    `/api/v1/admin/staff/${adminId}/roles/super_admin`,
    adminToken,
    { method: "DELETE" },
  );
  assert.equal(revokeLastAdmin.status, 409);
});
