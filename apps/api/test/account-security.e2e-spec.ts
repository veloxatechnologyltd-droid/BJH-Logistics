import "reflect-metadata";
import assert from "node:assert/strict";
import type { INestApplication } from "@nestjs/common";
import { after, before, test } from "node:test";
import {
  TEST_MATCHING_TOKEN,
  TEST_MATCHING_USER_ID,
  TEST_SUPER_ADMIN_AAL2_TOKEN,
  TEST_SUPER_ADMIN_ID,
  TEST_SUPER_ADMIN_PENDING_PASSWORD_TOKEN,
  TEST_SUPER_ADMIN_TOKEN,
  createTestApplication,
  testPasswordWrites,
} from "./test-application";
import { DatabasePort } from "../src/database/database.port";
import { beginTestDatabase, endTestDatabase } from "./postgres-test-database";

let application: INestApplication;
let baseUrl: string;

function call(path: string, token: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  if (init.body) headers.set("content-type", "application/json");
  return fetch(`${baseUrl}${path}`, { ...init, headers });
}
const message = async (response: Response) =>
  ((await response.json()) as { message: string }).message;

before(async () => {
  await beginTestDatabase();
  const started = await createTestApplication();
  application = started.application;
  baseUrl = started.baseUrl;
  await application
    .get(DatabasePort)
    .assignStaffRole(
      TEST_MATCHING_USER_ID,
      "sea_import_rep",
      TEST_SUPER_ADMIN_ID,
    );
});

after(async () => {
  await application.close();
  await endTestDatabase();
});

test("passwords the admin sets are temporary", async () => {
  testPasswordWrites.length = 0;
  const created = await call("/api/v1/admin/staff", TEST_SUPER_ADMIN_TOKEN, {
    method: "POST",
    body: JSON.stringify({
      email: "new-rep@example.test",
      password: "admin-chosen-password",
      roleKey: "air_import_rep",
    }),
  });
  assert.equal(created.status, 201);
  const reset = await call(
    `/api/v1/admin/staff/${TEST_MATCHING_USER_ID}/password`,
    TEST_SUPER_ADMIN_TOKEN,
    {
      method: "PATCH",
      body: JSON.stringify({ password: "another-admin-password" }),
    },
  );
  assert.equal(reset.status, 200);
  assert.deepEqual(
    testPasswordWrites.map((write) => write.temporary),
    [true, true],
  );
});

test("an account on a temporary password can do nothing but replace it", async () => {
  const session = await call(
    "/api/v1/auth/session",
    TEST_SUPER_ADMIN_PENDING_PASSWORD_TOKEN,
  );
  assert.equal(session.status, 200);
  assert.equal(
    ((await session.json()) as { mustChangePassword: boolean })
      .mustChangePassword,
    true,
  );

  for (const path of [
    "/api/v1/customers",
    "/api/v1/jobs",
    "/api/v1/admin/staff",
  ]) {
    const denied = await call(path, TEST_SUPER_ADMIN_PENDING_PASSWORD_TOKEN);
    assert.equal(denied.status, 403, path);
    assert.equal(
      await message(denied),
      "Choose a new password before continuing",
    );
  }

  const short = await call(
    "/api/v1/auth/password",
    TEST_SUPER_ADMIN_PENDING_PASSWORD_TOKEN,
    { method: "POST", body: JSON.stringify({ password: "short" }) },
  );
  assert.equal(short.status, 400);

  testPasswordWrites.length = 0;
  const changed = await call(
    "/api/v1/auth/password",
    TEST_SUPER_ADMIN_PENDING_PASSWORD_TOKEN,
    { method: "POST", body: JSON.stringify({ password: "my-own-password-1" }) },
  );
  assert.equal(changed.status, 201);
  assert.deepEqual(testPasswordWrites, [
    { userId: TEST_SUPER_ADMIN_ID, temporary: false },
  ]);
});

test("changing your own password needs a signed-in account", async () => {
  const anonymous = await fetch(`${baseUrl}/api/v1/auth/password`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: "my-own-password-1" }),
  });
  assert.equal(anonymous.status, 401);
});

test("super admin two-factor is off unless switched on", async () => {
  const session = await call("/api/v1/auth/session", TEST_SUPER_ADMIN_TOKEN);
  assert.equal(
    ((await session.json()) as { twoFactorRequired: boolean })
      .twoFactorRequired,
    false,
  );
  assert.equal(
    (await call("/api/v1/admin/staff", TEST_SUPER_ADMIN_TOKEN)).status,
    200,
  );
});

test("with two-factor switched on, the super admin needs a second step", async () => {
  process.env.SUPER_ADMIN_MFA_REQUIRED = "true";
  try {
    const session = await call("/api/v1/auth/session", TEST_SUPER_ADMIN_TOKEN);
    assert.equal(session.status, 200);
    assert.equal(
      ((await session.json()) as { twoFactorRequired: boolean })
        .twoFactorRequired,
      true,
    );
    const denied = await call("/api/v1/admin/staff", TEST_SUPER_ADMIN_TOKEN);
    assert.equal(denied.status, 403);
    assert.equal(await message(denied), "Two-factor sign-in is required");

    assert.equal(
      (await call("/api/v1/admin/staff", TEST_SUPER_ADMIN_AAL2_TOKEN)).status,
      200,
    );
    // Other staff are not asked for a second step.
    assert.equal((await call("/api/v1/jobs", TEST_MATCHING_TOKEN)).status, 200);
  } finally {
    delete process.env.SUPER_ADMIN_MFA_REQUIRED;
  }
});
