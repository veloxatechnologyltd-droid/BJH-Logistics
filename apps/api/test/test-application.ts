import { UnauthorizedException } from "@nestjs/common";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { DatabasePort } from "../src/database/database.port";
import {
  DOCUMENT_STORAGE,
  SIGNED_URL_SECONDS,
} from "../src/documents/document-storage.port";
import type { DocumentStorage } from "../src/documents/document-storage.port";
import { POSTGRES_POOL } from "../src/database/postgres-database.service";
import { testPostgresPool } from "./postgres-test-database";
import { SupabaseAuthVerifier } from "../src/auth/supabase-auth-verifier";
import { STAFF_AUTH_DIRECTORY } from "../src/auth/staff-admin.port";
import type {
  StaffAuthDirectory,
  StaffDirectoryUser,
} from "../src/auth/staff-admin.port";

/** In-memory stand-in for private object storage; records what was stored. */
export const testDocumentStorage: DocumentStorage & {
  objects: Map<string, { bytes: Buffer; contentType: string }>;
} = {
  objects: new Map(),
  async put(key, bytes, contentType) {
    this.objects.set(key, { bytes, contentType });
  },
  async get(key) {
    const stored = this.objects.get(key);
    if (!stored) throw new Error("Object not found");
    return stored.bytes;
  },
  async createSignedUrl(key, expiresInSeconds) {
    return `https://storage.test/signed/${key}?expires=${expiresInSeconds || SIGNED_URL_SECONDS}`;
  },
};

export const TEST_SUPER_ADMIN_TOKEN = "test-super-admin-token";
export const TEST_UNASSIGNED_TOKEN = "test-unassigned-user-token";
export const TEST_SUPER_ADMIN_ID = "50000000-0000-4000-8000-000000000001";
export const TEST_UNASSIGNED_USER_ID = "50000000-0000-4000-8000-000000000002";
export const TEST_MATCHING_TOKEN = "test-matching-department-token";
export const TEST_MATCHING_USER_ID = "50000000-0000-4000-8000-000000000006";
export const TEST_CUSTOMER_A_TOKEN = "test-customer-a-token";
export const TEST_CUSTOMER_A_ID = "50000000-0000-4000-8000-000000000003";
export const TEST_CUSTOMER_B_TOKEN = "test-customer-b-token";
export const TEST_CUSTOMER_B_ID = "50000000-0000-4000-8000-000000000004";
/** The super admin signed in on an admin-set password not yet replaced. */
export const TEST_SUPER_ADMIN_PENDING_PASSWORD_TOKEN =
  "test-super-admin-pending-password-token";
/** The super admin after a verified second sign-in step. */
export const TEST_SUPER_ADMIN_AAL2_TOKEN = "test-super-admin-aal2-token";

const testIdentities = new Map([
  [
    TEST_SUPER_ADMIN_TOKEN,
    { userId: TEST_SUPER_ADMIN_ID, email: "admin@example.test" },
  ],
  [
    TEST_UNASSIGNED_TOKEN,
    { userId: TEST_UNASSIGNED_USER_ID, email: "staff@example.test" },
  ],
  [
    TEST_MATCHING_TOKEN,
    { userId: TEST_MATCHING_USER_ID, email: "air-import@example.test" },
  ],
  [
    TEST_CUSTOMER_A_TOKEN,
    { userId: TEST_CUSTOMER_A_ID, email: "customer-a@example.test" },
  ],
  [
    TEST_CUSTOMER_B_TOKEN,
    { userId: TEST_CUSTOMER_B_ID, email: "customer-b@example.test" },
  ],
]);
const testFlaggedIdentities = new Map([
  [
    TEST_SUPER_ADMIN_PENDING_PASSWORD_TOKEN,
    {
      userId: TEST_SUPER_ADMIN_ID,
      email: "admin@example.test",
      mustChangePassword: true,
    },
  ],
  [
    TEST_SUPER_ADMIN_AAL2_TOKEN,
    { userId: TEST_SUPER_ADMIN_ID, email: "admin@example.test", aal: "aal2" },
  ],
]);

/** Every password the fake directory was asked to set, newest last. */
export const testPasswordWrites: Array<{
  userId: string;
  temporary: boolean;
}> = [];

const testUsers = new Map<string, StaffDirectoryUser>(
  [...testIdentities.values()].map((identity) => [
    identity.userId,
    {
      id: identity.userId,
      email: identity.email,
      createdAt: "2026-09-28T10:00:00.000Z",
      invitedAt: null,
      suspended: false,
      suspendedRoles: [],
    },
  ]),
);

const testStaffDirectory: StaffAuthDirectory = {
  async listUsers() {
    return [...testUsers.values()];
  },
  async getUser(userId) {
    return testUsers.get(userId) ?? null;
  },
  async createUser(email) {
    const user = {
      id: "50000000-0000-4000-8000-000000000005",
      email,
      createdAt: "2026-09-28T10:00:00.000Z",
      invitedAt: null,
      suspended: false,
      suspendedRoles: [],
    };
    testUsers.set(user.id, user);
    testPasswordWrites.push({ userId: user.id, temporary: true });
    return user;
  },
  async setPassword(userId, _password, temporary) {
    testPasswordWrites.push({ userId, temporary });
  },
  async setSuspended(userId, suspended, roles = []) {
    const user = testUsers.get(userId);
    if (user)
      testUsers.set(userId, { ...user, suspended, suspendedRoles: roles });
  },
};

export async function createTestApplication(
  options: {
    bootstrapSuperAdmin?: boolean;
    beforeListen?: (application: INestApplication) => void;
  } = {},
): Promise<{ application: INestApplication; baseUrl: string }> {
  const { AppModule } = await import("../src/app.module");
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(SupabaseAuthVerifier)
    .useValue({
      async verify(token: string) {
        const identity =
          testIdentities.get(token) ?? testFlaggedIdentities.get(token);
        if (!identity) {
          throw new UnauthorizedException("Invalid test token");
        }
        return identity;
      },
    })
    .overrideProvider(DOCUMENT_STORAGE)
    .useValue(testDocumentStorage)
    .overrideProvider(POSTGRES_POOL)
    .useValue(testPostgresPool)
    .overrideProvider(STAFF_AUTH_DIRECTORY)
    .useValue(testStaffDirectory)
    .compile();

  const application = module.createNestApplication({ logger: false });
  options.beforeListen?.(application);
  await application.init();
  if (options?.bootstrapSuperAdmin !== false) {
    await application
      .get(DatabasePort)
      .claimInitialSuperAdmin(TEST_SUPER_ADMIN_ID);
  }
  await application.listen(0, "127.0.0.1");
  const address = application.getHttpServer().address() as { port: number };

  return {
    application,
    baseUrl: `http://127.0.0.1:${address.port}`,
  };
}

export function staffFetch(
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${TEST_SUPER_ADMIN_TOKEN}`);
  return fetch(url, { ...init, headers });
}
