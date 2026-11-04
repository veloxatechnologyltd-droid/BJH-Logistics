import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { after, before, test } from "node:test";
import {
  TEST_CUSTOMER_A_ID,
  TEST_CUSTOMER_A_TOKEN,
  TEST_MATCHING_TOKEN,
  TEST_MATCHING_USER_ID,
  TEST_SUPER_ADMIN_ID,
  TEST_SUPER_ADMIN_TOKEN,
  createTestApplication,
} from "./test-application";
import { DatabasePort } from "../src/database/database.port";
import type { ActivityRecord } from "../src/database/database.port";
import { beginTestDatabase, endTestDatabase } from "./postgres-test-database";

let application: INestApplication;
let baseUrl: string;
let companyId: string;
let jobId: string;

function call(path: string, token?: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (token) headers.set("authorization", `Bearer ${token}`);
  if (init.body) headers.set("content-type", "application/json");
  return fetch(`${baseUrl}${path}`, { ...init, headers });
}

async function readLog(query = ""): Promise<ActivityRecord[]> {
  const response = await call(
    `/api/v1/admin/activity${query}`,
    TEST_SUPER_ADMIN_TOKEN,
  );
  assert.equal(response.status, 200);
  return ((await response.json()) as { entries: ActivityRecord[] }).entries;
}

/** Entries are written just after the response, so wait for them. */
async function waitForLog(
  query: string,
  predicate: (entries: ActivityRecord[]) => boolean,
): Promise<ActivityRecord[]> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const entries = await readLog(query);
    if (predicate(entries)) return entries;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return readLog(query);
}

before(async () => {
  await beginTestDatabase();
  const started = await createTestApplication();
  application = started.application;
  baseUrl = started.baseUrl;
  const database = application.get(DatabasePort);
  await database.assignStaffRole(
    TEST_MATCHING_USER_ID,
    "sea_import_rep",
    TEST_SUPER_ADMIN_ID,
  );
  companyId = randomUUID();
  await database.createCustomer({
    id: companyId,
    companyName: "Northstar Synthetic Ltd",
    createdAt: new Date().toISOString(),
    contacts: [],
  });
  await database.grantCustomerMembership(
    companyId,
    TEST_CUSTOMER_A_ID,
    TEST_SUPER_ADMIN_ID,
  );
});

after(async () => {
  await application?.close();
  await endTestDatabase();
});

test("user actions are logged with actor, route, entity and outcome", async () => {
  const created = await call("/api/v1/jobs", TEST_MATCHING_TOKEN, {
    method: "POST",
    body: JSON.stringify({
      customerCompanyId: companyId,
      serviceLine: "sea_import",
    }),
  });
  assert.equal(created.status, 201);
  jobId = ((await created.json()) as { id: string }).id;
  await call(`/api/v1/jobs/${jobId}/milestones`, TEST_MATCHING_TOKEN, {
    method: "POST",
    body: JSON.stringify({
      milestoneKey: "cargo_arrived",
      note: "secret-note-text",
    }),
  });
  await call(
    `/api/v1/jobs?search=confidential-search-term`,
    TEST_MATCHING_TOKEN,
  );

  const entries = await waitForLog(
    `?actor=${TEST_MATCHING_USER_ID}`,
    (list) => list.length >= 3,
  );
  const routes = entries.map(
    (entry) => `${entry.method} ${entry.route} ${entry.statusCode}`,
  );
  assert.ok(routes.includes("POST /api/v1/jobs 201"), routes.join("\n"));
  assert.ok(routes.includes("POST /api/v1/jobs/:id/milestones 201"));
  assert.ok(routes.includes("GET /api/v1/jobs 200"));
  const milestone = entries.find((entry) =>
    entry.route.endsWith("/milestones"),
  )!;
  assert.equal(milestone.actorUserId, TEST_MATCHING_USER_ID);
  assert.equal(milestone.entityId, jobId);
  assert.equal(milestone.actorEmail, "air-import@example.test");
  assert.equal(milestone.actorName, "Air Import");
  assert.ok(
    entries.every((entry) => entry.actorUserId === TEST_MATCHING_USER_ID),
  );
});

test("request bodies and query strings are never stored", async () => {
  const everything = JSON.stringify(
    await waitForLog("", (list) => list.length >= 3),
  );
  assert.equal(everything.includes("secret-note-text"), false);
  assert.equal(everything.includes("confidential-search-term"), false);
});

test("denied attempts are logged too, and filters narrow the log", async () => {
  const denied = await call(
    `/api/v1/jobs/${jobId}/milestones`,
    TEST_CUSTOMER_A_TOKEN,
    {
      method: "POST",
      body: JSON.stringify({ milestoneKey: "cargo_arrived" }),
    },
  );
  assert.equal(denied.status, 403);
  const byActor = await waitForLog(
    `?actor=${TEST_CUSTOMER_A_ID}`,
    (list) => list.length >= 1,
  );
  assert.equal(byActor[0].statusCode, 403);
  assert.equal(byActor[0].entityId, jobId);

  const byEntity = await readLog(`?entity=${jobId}`);
  assert.ok(byEntity.length >= 2);
  assert.ok(byEntity.every((entry) => entry.entityId === jobId));
  assert.deepEqual(
    await readLog(`?from=${encodeURIComponent("2999-01-01T00:00:00Z")}`),
    [],
  );
});

test("only the super admin can read the log; bad filters are rejected", async () => {
  assert.equal(
    (await call("/api/v1/admin/activity", TEST_MATCHING_TOKEN)).status,
    403,
  );
  assert.equal(
    (await call("/api/v1/admin/activity", TEST_CUSTOMER_A_TOKEN)).status,
    403,
  );
  assert.equal((await call("/api/v1/admin/activity")).status, 401);
  for (const query of [
    "?actor=nope",
    "?entity=nope",
    "?from=yesterday",
    "?page=0",
  ]) {
    assert.equal(
      (await call(`/api/v1/admin/activity${query}`, TEST_SUPER_ADMIN_TOKEN))
        .status,
      400,
      query,
    );
  }
});

test("unauthenticated requests are not attributed to anyone", async () => {
  const before = (await readLog()).length;
  await call("/api/health");
  await call("/api/v1/jobs");
  await new Promise((resolve) => setTimeout(resolve, 150));
  const entries = await readLog();
  const newest = entries.filter((entry) => entry.route === "/api/health");
  assert.equal(newest.length, 0);
  assert.ok(entries.length >= before);
});
