import "reflect-metadata";
import assert from "node:assert/strict";
import type { INestApplication } from "@nestjs/common";
import { after, afterEach, before, test } from "node:test";
import {
  TEST_CUSTOMER_A_TOKEN,
  TEST_SUPER_ADMIN_ID,
  TEST_SUPER_ADMIN_TOKEN,
  TEST_UNASSIGNED_TOKEN,
  TEST_UNASSIGNED_USER_ID,
  createTestApplication,
} from "./test-application";
import { DatabasePort } from "../src/database/database.port";
import { beginTestDatabase, endTestDatabase } from "./postgres-test-database";

/** Who can see the CRM: CRM_ACCESS is admin (default), everyone or off. */
let application: INestApplication;
let baseUrl: string;
const originalAccess = process.env.CRM_ACCESS;

function get(path: string, token: string) {
  return fetch(`${baseUrl}${path}`, {
    headers: { authorization: `Bearer ${token}` },
  });
}

async function status(path: string, token: string) {
  return (await get(path, token)).status;
}

async function sessionCrm(token: string) {
  const body = (await (await get("/api/v1/auth/session", token)).json()) as {
    crm?: boolean;
  };
  return body.crm;
}

before(async () => {
  await beginTestDatabase();
  const started = await createTestApplication();
  application = started.application;
  baseUrl = started.baseUrl;
  // The unassigned test user becomes a sales rep: allowed by role, so only
  // CRM_ACCESS decides what they see.
  await application
    .get(DatabasePort)
    .assignStaffRole(TEST_UNASSIGNED_USER_ID, "sales_rep", TEST_SUPER_ADMIN_ID);
});

afterEach(() => {
  if (originalAccess === undefined) delete process.env.CRM_ACCESS;
  else process.env.CRM_ACCESS = originalAccess;
});

after(async () => {
  await application?.close();
  await endTestDatabase();
});

const crmPaths = [
  "/api/v1/campaigns",
  "/api/v1/campaigns/config",
  "/api/v1/sales/messages",
  "/api/v1/sales/overview",
];

test("by default only the super admin sees the CRM", async () => {
  delete process.env.CRM_ACCESS;
  for (const path of crmPaths) {
    assert.equal(await status(path, TEST_SUPER_ADMIN_TOKEN), 200, path);
    assert.equal(await status(path, TEST_UNASSIGNED_TOKEN), 404, path);
    assert.equal(await status(path, TEST_CUSTOMER_A_TOKEN), 403, path);
  }
  assert.equal(await sessionCrm(TEST_SUPER_ADMIN_TOKEN), true);
  assert.equal(await sessionCrm(TEST_UNASSIGNED_TOKEN), false);
});

test("an unrecognised value falls back to the super admin only", async () => {
  process.env.CRM_ACCESS = "maybe";
  assert.equal(await status("/api/v1/campaigns", TEST_SUPER_ADMIN_TOKEN), 200);
  assert.equal(await status("/api/v1/campaigns", TEST_UNASSIGNED_TOKEN), 404);
});

test("everyone opens it to the sales roles; customers stay refused", async () => {
  process.env.CRM_ACCESS = "everyone";
  for (const path of crmPaths) {
    assert.equal(await status(path, TEST_SUPER_ADMIN_TOKEN), 200, path);
    assert.equal(await status(path, TEST_UNASSIGNED_TOKEN), 200, path);
    assert.equal(await status(path, TEST_CUSTOMER_A_TOKEN), 403, path);
  }
  assert.equal(await sessionCrm(TEST_UNASSIGNED_TOKEN), true);
});

test("off hides it from everyone, the super admin included", async () => {
  process.env.CRM_ACCESS = "off";
  for (const path of crmPaths) {
    assert.equal(await status(path, TEST_SUPER_ADMIN_TOKEN), 404, path);
    assert.equal(await status(path, TEST_UNASSIGNED_TOKEN), 404, path);
  }
  assert.equal(await sessionCrm(TEST_SUPER_ADMIN_TOKEN), false);
});

test("the public unsubscribe page does not depend on CRM access", async () => {
  process.env.CRM_ACCESS = "off";
  const response = await fetch(
    `${baseUrl}/api/v1/sales/unsubscribe/${"a".repeat(40)}`,
  );
  // An unknown token is refused as invalid, not hidden as if the route were missing.
  assert.notEqual(response.status, 404);
});
