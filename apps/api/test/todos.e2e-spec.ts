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
  TEST_UNASSIGNED_TOKEN,
  TEST_UNASSIGNED_USER_ID,
  createTestApplication,
} from "./test-application";
import { DatabasePort } from "../src/database/database.port";
import { beginTestDatabase, endTestDatabase } from "./postgres-test-database";

// Who is who here: TEST_MATCHING is an import rep, TEST_UNASSIGNED an export
// rep (a different person, with their own role), the super admin sees all.
const IMPORT_REP = TEST_MATCHING_TOKEN;
const EXPORT_REP = TEST_UNASSIGNED_TOKEN;
const ADMIN = TEST_SUPER_ADMIN_TOKEN;

let application: INestApplication;
let baseUrl: string;
let seaJobId: string;

type Task = {
  id: string;
  jobId: string | null;
  title: string;
  status: string;
  assignedUserId: string | null;
  assignedUserName: string | null;
  assignedRole: string | null;
};

function call(path: string, token: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  if (init.body) headers.set("content-type", "application/json");
  return fetch(`${baseUrl}${path}`, { ...init, headers });
}
const post = (path: string, token: string, body: unknown = {}) =>
  call(path, token, { method: "POST", body: JSON.stringify(body) });
const tasksOf = async (token: string, query = "") =>
  (await (await call(`/api/v1/tasks${query}`, token)).json()) as Task[];

before(async () => {
  await beginTestDatabase();
  const started = await createTestApplication();
  application = started.application;
  baseUrl = started.baseUrl;
  const database = application.get(DatabasePort);
  await database.assignStaffRole(
    TEST_MATCHING_USER_ID,
    "import_rep",
    TEST_SUPER_ADMIN_ID,
  );
  await database.assignStaffRole(
    TEST_UNASSIGNED_USER_ID,
    "export_rep",
    TEST_SUPER_ADMIN_ID,
  );
  const companyId = randomUUID();
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
  const job = await call("/api/v1/jobs", ADMIN, {
    method: "POST",
    body: JSON.stringify({
      customerCompanyId: companyId,
      serviceLine: "sea_import",
    }),
  });
  seaJobId = ((await job.json()) as { id: string }).id;
});

after(async () => {
  await application?.close();
  await endTestDatabase();
});

let todoId: string;

test("a to-do belongs to a named person, with an optional reminder", async () => {
  const remindAt = new Date(Date.now() + 3_600_000).toISOString();
  const created = await post("/api/v1/tasks", ADMIN, {
    title: "Call the customs broker",
    assignedUserId: TEST_MATCHING_USER_ID,
    dueDate: "2099-01-05",
    remindAt,
  });
  assert.equal(created.status, 201);
  const todo = (await created.json()) as Task;
  todoId = todo.id;
  assert.equal(todo.jobId, null);
  assert.equal(todo.assignedUserId, TEST_MATCHING_USER_ID);
  assert.equal(todo.assignedRole, null);
  assert.ok(todo.assignedUserName, "the person's name is shown");

  // The reminder pops up for the assigned person, and for nobody else.
  const mine = (await (
    await call("/api/v1/staff-notifications", IMPORT_REP)
  ).json()) as { upcoming: Array<{ title: string }> };
  assert.deepEqual(
    mine.upcoming.map((notice) => notice.title),
    ["Task: Call the customs broker"],
  );
  const theirs = (await (
    await call("/api/v1/staff-notifications", EXPORT_REP)
  ).json()) as { upcoming: unknown[] };
  assert.equal(theirs.upcoming.length, 0);
});

test("only the person, its creator and the super admin see a to-do", async () => {
  assert.ok(
    (await tasksOf(IMPORT_REP, "?assignedUserId=me")).some(
      (t) => t.id === todoId,
    ),
  );
  assert.ok((await tasksOf(ADMIN)).some((t) => t.id === todoId));
  assert.equal(
    (await tasksOf(EXPORT_REP)).some((t) => t.id === todoId),
    false,
    "another staff member does not see it",
  );
  assert.equal(
    (
      await tasksOf(EXPORT_REP, `?assignedUserId=${TEST_MATCHING_USER_ID}`)
    ).some((t) => t.id === todoId),
    false,
    "asking for that person's tasks does not reveal it",
  );
  // A to-do created by someone stays visible to its creator.
  const byExport = await post("/api/v1/tasks", EXPORT_REP, {
    title: "Ask the import rep for the BL",
    assignedUserId: TEST_MATCHING_USER_ID,
  });
  assert.equal(byExport.status, 201);
  const made = (await byExport.json()) as Task;
  assert.ok((await tasksOf(EXPORT_REP)).some((t) => t.id === made.id));
  assert.ok((await tasksOf(IMPORT_REP)).some((t) => t.id === made.id));
});

test("a to-do cannot be finished by someone who cannot see it", async () => {
  const stranger = await post(`/api/v1/tasks/${todoId}/complete`, EXPORT_REP);
  assert.equal(stranger.status, 404, "its existence is not revealed");
  const customer = await post(
    `/api/v1/tasks/${todoId}/complete`,
    TEST_CUSTOMER_A_TOKEN,
  );
  assert.ok([401, 403, 404].includes(customer.status));

  const done = await post(`/api/v1/tasks/${todoId}/complete`, IMPORT_REP, {
    note: "Spoke to the broker",
  });
  assert.equal(done.status, 201);
  assert.equal(((await done.json()) as Task).status, "done");
  const again = await post(`/api/v1/tasks/${todoId}/complete`, IMPORT_REP);
  assert.equal(again.status, 409);
  assert.equal(
    (await tasksOf(IMPORT_REP, "?assignedUserId=me")).some(
      (t) => t.id === todoId,
    ),
    false,
    "done tasks leave the open list",
  );
});

test("a to-do needs an active staff member, a person and a future reminder", async () => {
  const cases: Array<[unknown, number, string]> = [
    [
      { title: "x", assignedRole: "import_rep" },
      400,
      "a role alone is not enough",
    ],
    [{ title: "x" }, 400, "nobody named"],
    [{ title: "x", assignedUserId: "nope" }, 400, "not an ID"],
    [
      { title: "x", assignedUserId: TEST_CUSTOMER_A_ID },
      400,
      "a customer is not staff",
    ],
    [{ title: "x", assignedUserId: randomUUID() }, 400, "unknown person"],
    [
      {
        title: "x",
        assignedUserId: TEST_MATCHING_USER_ID,
        remindAt: new Date(Date.now() - 60_000).toISOString(),
      },
      400,
      "a reminder in the past",
    ],
  ];
  for (const [body, status, why] of cases) {
    const response = await post("/api/v1/tasks", ADMIN, body);
    assert.equal(response.status, status, why);
  }
  const customer = await post("/api/v1/tasks", TEST_CUSTOMER_A_TOKEN, {
    title: "x",
    assignedUserId: TEST_MATCHING_USER_ID,
  });
  assert.ok(
    [401, 403].includes(customer.status),
    "customers cannot add to-dos",
  );
  const customerList = await call("/api/v1/tasks", TEST_CUSTOMER_A_TOKEN);
  assert.ok([401, 403].includes(customerList.status));
});

test("a job task can be given to a person and is shown with their name", async () => {
  const created = await post(`/api/v1/jobs/${seaJobId}/tasks`, ADMIN, {
    title: "Chase the bill of lading",
    kind: "missing_documents",
    assignedUserId: TEST_MATCHING_USER_ID,
  });
  assert.equal(created.status, 201);
  const task = (await created.json()) as Task;
  assert.equal(task.jobId, seaJobId);
  assert.equal(task.assignedUserId, TEST_MATCHING_USER_ID);
  assert.ok(task.assignedUserName);
  const onJob = (await (
    await call(`/api/v1/jobs/${seaJobId}/tasks`, ADMIN)
  ).json()) as Task[];
  assert.deepEqual(
    onJob.map((item) => item.title),
    ["Chase the bill of lading"],
  );
  // Job tasks never leak into "someone else's" view of to-dos, only by job access.
  const filtered = await tasksOf(
    ADMIN,
    `?assignedUserId=${TEST_MATCHING_USER_ID}`,
  );
  assert.ok(filtered.some((item) => item.id === task.id));
});
