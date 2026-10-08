import "reflect-metadata";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { INestApplication } from "@nestjs/common";
import {
  createTestApplication,
  TEST_SUPER_ADMIN_ID,
  TEST_SUPER_ADMIN_TOKEN,
  TEST_UNASSIGNED_TOKEN,
} from "./test-application";
import { beginTestDatabase, endTestDatabase } from "./postgres-test-database";

let application: INestApplication;
let baseUrl: string;
const originalBootstrapEnabled = process.env.SUPER_ADMIN_BOOTSTRAP_ENABLED;

before(async () => {
  await beginTestDatabase();
  process.env.SUPER_ADMIN_BOOTSTRAP_ENABLED = "true";
  const started = await createTestApplication({ bootstrapSuperAdmin: false });
  application = started.application;
  baseUrl = started.baseUrl;
});

after(async () => {
  await application?.close();
  if (originalBootstrapEnabled === undefined) {
    delete process.env.SUPER_ADMIN_BOOTSTRAP_ENABLED;
  } else {
    process.env.SUPER_ADMIN_BOOTSTRAP_ENABLED = originalBootstrapEnabled;
  }
  await endTestDatabase();
});

test("the first authenticated user can claim the only super-admin role", async () => {
  const bootstrapStatus = await fetch(
    `${baseUrl}/api/v1/auth/bootstrap-status`,
  );
  assert.deepEqual(await bootstrapStatus.json(), { bootstrapAvailable: true });

  const protectedWithoutToken = await fetch(`${baseUrl}/api/v1/customers`);
  assert.equal(protectedWithoutToken.status, 401);

  const invalidToken = await fetch(
    `${baseUrl}/api/v1/auth/bootstrap-super-admin`,
    {
      method: "POST",
      headers: { authorization: "Bearer invalid-test-token" },
    },
  );
  assert.equal(invalidToken.status, 401);

  const bootstrapResponse = await fetch(
    `${baseUrl}/api/v1/auth/bootstrap-super-admin`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${TEST_SUPER_ADMIN_TOKEN}` },
    },
  );
  assert.equal(bootstrapResponse.status, 201);
  assert.deepEqual(await bootstrapResponse.json(), {
    userId: TEST_SUPER_ADMIN_ID,
    email: "admin@example.test",
    roles: ["super_admin"],
  });

  const sessionResponse = await fetch(`${baseUrl}/api/v1/auth/session`, {
    headers: { authorization: `Bearer ${TEST_SUPER_ADMIN_TOKEN}` },
  });
  assert.equal(sessionResponse.status, 200);
  assert.deepEqual(await sessionResponse.json(), {
    userId: TEST_SUPER_ADMIN_ID,
    email: "admin@example.test",
    roles: ["super_admin"],
    mustChangePassword: false,
    twoFactorRequired: false,
  });

  const bootstrapClosed = await fetch(
    `${baseUrl}/api/v1/auth/bootstrap-status`,
  );
  assert.deepEqual(await bootstrapClosed.json(), { bootstrapAvailable: false });

  const secondBootstrap = await fetch(
    `${baseUrl}/api/v1/auth/bootstrap-super-admin`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${TEST_UNASSIGNED_TOKEN}` },
    },
  );
  assert.equal(secondBootstrap.status, 409);

  const unassignedAccess = await fetch(`${baseUrl}/api/v1/customers`, {
    headers: { authorization: `Bearer ${TEST_UNASSIGNED_TOKEN}` },
  });
  assert.equal(unassignedAccess.status, 403);

  const superAdminAccess = await fetch(`${baseUrl}/api/v1/customers`, {
    headers: { authorization: `Bearer ${TEST_SUPER_ADMIN_TOKEN}` },
  });
  assert.equal(superAdminAccess.status, 200);
});
