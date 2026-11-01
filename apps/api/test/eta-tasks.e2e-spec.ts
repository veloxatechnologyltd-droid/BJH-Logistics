import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { after, before, test } from "node:test";
import {
  TEST_CUSTOMER_A_ID,
  TEST_CUSTOMER_A_TOKEN,
  TEST_CUSTOMER_B_ID,
  TEST_CUSTOMER_B_TOKEN,
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

let application: INestApplication;
let baseUrl: string;
let seaJobId: string;
let otherSeaJobId: string;

function call(path: string, token: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  if (init.body) headers.set("content-type", "application/json");
  return fetch(`${baseUrl}${path}`, { ...init, headers });
}

function post(path: string, token: string, body: unknown) {
  return call(path, token, { method: "POST", body: JSON.stringify(body) });
}

async function openJob(
  companyId: string,
  serviceLine: string,
): Promise<string> {
  const response = await call("/api/v1/jobs", TEST_SUPER_ADMIN_TOKEN, {
    method: "POST",
    body: JSON.stringify({ customerCompanyId: companyId, serviceLine }),
  });
  return ((await response.json()) as { id: string }).id;
}

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
  const companyA = randomUUID();
  const companyB = randomUUID();
  for (const [id, name] of [
    [companyA, "Northstar Synthetic Ltd"],
    [companyB, "Southwind Synthetic Ltd"],
  ]) {
    await database.createCustomer({
      id,
      companyName: name,
      createdAt: new Date().toISOString(),
      contacts: [],
    });
  }
  await database.grantCustomerMembership(
    companyA,
    TEST_CUSTOMER_A_ID,
    TEST_SUPER_ADMIN_ID,
  );
  await database.grantCustomerMembership(
    companyB,
    TEST_CUSTOMER_B_ID,
    TEST_SUPER_ADMIN_ID,
  );
  seaJobId = await openJob(companyA, "sea_import");
  otherSeaJobId = await openJob(companyB, "sea_import");
});

after(async () => {
  await application?.close();
  await endTestDatabase();
});

let firstEtaId: string;

test("a rep records an ETA and corrections keep the full history", async () => {
  const first = await post(
    `/api/v1/jobs/${seaJobId}/eta`,
    TEST_MATCHING_TOKEN,
    {
      etaAt: "2026-10-05T06:00:00Z",
      source: "  Carrier notice  ",
      note: "Vessel schedule",
    },
  );
  assert.equal(first.status, 201);
  const event = (await first.json()) as Record<string, unknown>;
  assert.equal(event.etaAt, "2026-10-05T06:00:00.000Z");
  assert.equal(event.source, "Carrier notice");
  assert.equal(event.recordedBy, TEST_MATCHING_USER_ID);
  firstEtaId = String(event.id);

  const correction = await post(
    `/api/v1/jobs/${seaJobId}/eta`,
    TEST_SUPER_ADMIN_TOKEN,
    {
      etaAt: "2026-10-08T06:00:00Z",
      source: "Carrier delay notice",
      correctionOf: firstEtaId,
    },
  );
  assert.equal(correction.status, 201);

  const eta = (await (
    await call(`/api/v1/jobs/${seaJobId}/eta`, TEST_MATCHING_TOKEN)
  ).json()) as {
    current: { etaAt: string; correctionOf: string | null };
    history: Array<{ id: string; etaAt: string }>;
  };
  assert.equal(eta.history.length, 2);
  assert.equal(eta.history[0].id, firstEtaId);
  assert.equal(eta.history[0].etaAt, "2026-10-05T06:00:00.000Z");
  assert.equal(eta.current.etaAt, "2026-10-08T06:00:00.000Z");
  assert.equal(eta.current.correctionOf, firstEtaId);

  const empty = (await (
    await call(`/api/v1/jobs/${otherSeaJobId}/eta`, TEST_SUPER_ADMIN_TOKEN)
  ).json()) as { current: unknown; history: unknown[] };
  assert.equal(empty.current, null);
  assert.deepEqual(empty.history, []);

  const foreign = await post(
    `/api/v1/jobs/${otherSeaJobId}/eta`,
    TEST_SUPER_ADMIN_TOKEN,
    {
      etaAt: "2026-10-09T06:00:00Z",
      source: "x",
      correctionOf: firstEtaId,
    },
  );
  assert.equal(foreign.status, 404);
});

test("invalid ETA requests are rejected", async () => {
  const cases: Array<[unknown, string]> = [
    [[], "An ETA object is required"],
    [{ source: "x" }, "etaAt is required"],
    [{ etaAt: "soon", source: "x" }, "etaAt must be a date and time"],
    [{ etaAt: "2026-10-05T06:00:00Z" }, "source is required"],
    [
      { etaAt: "2026-10-05T06:00:00Z", source: "x", correctionOf: "nope" },
      "correctionOf must be a valid ID",
    ],
  ];
  for (const [body, message] of cases) {
    const response = await post(
      `/api/v1/jobs/${seaJobId}/eta`,
      TEST_SUPER_ADMIN_TOKEN,
      body,
    );
    assert.equal(response.status, 400, message);
    assert.equal(
      ((await response.json()) as { message: string }).message,
      message,
    );
  }
});

let taskId: string;

test("staff create tasks for a department and list that department's open work", async () => {
  const created = await post(
    `/api/v1/jobs/${seaJobId}/tasks`,
    TEST_MATCHING_TOKEN,
    {
      kind: "missing_documents",
      title: "  Chase packing list  ",
      assignedRole: "import_rep",
      dueDate: "2026-10-02",
    },
  );
  assert.equal(created.status, 201);
  const task = (await created.json()) as Record<string, unknown>;
  assert.equal(task.title, "Chase packing list");
  assert.equal(task.kind, "missing_documents");
  assert.equal(task.status, "open");
  assert.equal(task.dueDate, "2026-10-02");
  assert.equal(task.createdBy, TEST_MATCHING_USER_ID);
  taskId = String(task.id);

  await post(`/api/v1/jobs/${seaJobId}/tasks`, TEST_SUPER_ADMIN_TOKEN, {
    title: "Air desk follow-up",
    assignedRole: "export_rep",
  });
  await post(`/api/v1/jobs/${otherSeaJobId}/tasks`, TEST_SUPER_ADMIN_TOKEN, {
    title: "Other company task",
    assignedRole: "import_rep",
  });

  const mine = (await (
    await call("/api/v1/tasks?assignedRole=import_rep", TEST_MATCHING_TOKEN)
  ).json()) as Array<{ title: string; fileNumber: string }>;
  assert.deepEqual(
    mine.map((item) => item.title),
    ["Chase packing list", "Other company task"],
  );

  const forJob = (await (
    await call(`/api/v1/jobs/${seaJobId}/tasks`, TEST_SUPER_ADMIN_TOKEN)
  ).json()) as Array<{ title: string }>;
  assert.deepEqual(forJob.map((item) => item.title).sort(), [
    "Air desk follow-up",
    "Chase packing list",
  ]);
});

test("completing a task records who and when, once", async () => {
  const done = await post(
    `/api/v1/jobs/${seaJobId}/tasks/${taskId}/complete`,
    TEST_MATCHING_TOKEN,
    { note: "  Received by email  " },
  );
  assert.equal(done.status, 201);
  const task = (await done.json()) as Record<string, unknown>;
  assert.equal(task.status, "done");
  assert.equal(task.completedBy, TEST_MATCHING_USER_ID);
  assert.equal(task.completionNote, "Received by email");
  assert.ok(task.completedAt);

  const again = await post(
    `/api/v1/jobs/${seaJobId}/tasks/${taskId}/complete`,
    TEST_MATCHING_TOKEN,
    {},
  );
  assert.equal(again.status, 409);
  const wrongJob = await post(
    `/api/v1/jobs/${otherSeaJobId}/tasks/${taskId}/complete`,
    TEST_SUPER_ADMIN_TOKEN,
    {},
  );
  assert.equal(wrongJob.status, 404);

  const open = (await (
    await call("/api/v1/tasks?assignedRole=import_rep", TEST_MATCHING_TOKEN)
  ).json()) as Array<{ title: string }>;
  assert.deepEqual(
    open.map((item) => item.title),
    ["Other company task"],
  );
  const all = (await (
    await call(
      "/api/v1/tasks?assignedRole=import_rep&status=all",
      TEST_MATCHING_TOKEN,
    )
  ).json()) as Array<{ title: string; status: string }>;
  assert.equal(all.length, 2);
  assert.equal(all[all.length - 1].status, "done");
});

test("invalid task requests and filters are rejected", async () => {
  const cases: Array<[unknown, string]> = [
    [[], "A task object is required"],
    [{ assignedRole: "import_rep" }, "title is required"],
    [
      { title: "x" },
      "assignedRole must be one of " +
        [
          "super_admin",
          "import_rep",
          "export_rep",
          "customer_service_rep",
          "sales_rep",
          "finance_rep",
        ].join(", "),
    ],
    [
      { title: "x", assignedRole: "import_rep", kind: "chore" },
      "kind must be one of task, missing_documents, damage, delay, other",
    ],
    [
      { title: "x", assignedRole: "import_rep", dueDate: "2026-13-45" },
      "dueDate must be a date (YYYY-MM-DD)",
    ],
  ];
  for (const [body, message] of cases) {
    const response = await post(
      `/api/v1/jobs/${seaJobId}/tasks`,
      TEST_SUPER_ADMIN_TOKEN,
      body,
    );
    assert.equal(response.status, 400, message);
    assert.equal(
      ((await response.json()) as { message: string }).message,
      message,
    );
  }
  const badRole = await call(
    "/api/v1/tasks?assignedRole=cook",
    TEST_SUPER_ADMIN_TOKEN,
  );
  assert.equal(badRole.status, 400);
  const badStatus = await call(
    "/api/v1/tasks?status=maybe",
    TEST_SUPER_ADMIN_TOKEN,
  );
  assert.equal(badStatus.status, 400);
});

test("access boundaries: other departments, customers and closed jobs", async () => {
  const wrongDepartmentTask = await post(
    `/api/v1/jobs/${seaJobId}/tasks`,
    TEST_UNASSIGNED_TOKEN,
    { title: "x", assignedRole: "import_rep" },
  );
  assert.equal(wrongDepartmentTask.status, 404);
  const wrongDepartmentEta = await post(
    `/api/v1/jobs/${seaJobId}/eta`,
    TEST_UNASSIGNED_TOKEN,
    { etaAt: "2026-10-05T06:00:00Z", source: "x" },
  );
  assert.equal(wrongDepartmentEta.status, 404);
  const wrongDepartmentList = await call(
    `/api/v1/jobs/${seaJobId}/tasks`,
    TEST_UNASSIGNED_TOKEN,
  );
  assert.equal(wrongDepartmentList.status, 404);

  // Tasks are internal: customers cannot read or create them, or list tasks.
  const customerTasks = await call(
    `/api/v1/jobs/${seaJobId}/tasks`,
    TEST_CUSTOMER_A_TOKEN,
  );
  assert.equal(customerTasks.status, 403);
  const customerCreate = await post(
    `/api/v1/jobs/${seaJobId}/tasks`,
    TEST_CUSTOMER_A_TOKEN,
    { title: "x", assignedRole: "import_rep" },
  );
  assert.equal(customerCreate.status, 403);
  const customerList = await call("/api/v1/tasks", TEST_CUSTOMER_A_TOKEN);
  assert.equal(customerList.status, 403);

  // A department only sees tasks on its own service lines.
  const airDesk = (await (
    await call("/api/v1/tasks?status=all", TEST_UNASSIGNED_TOKEN)
  ).json()) as unknown[];
  assert.deepEqual(airDesk, []);

  // ETA is readable by the owning customer but not written by them or others.
  const customerEta = await call(
    `/api/v1/jobs/${seaJobId}/eta`,
    TEST_CUSTOMER_A_TOKEN,
  );
  assert.equal(customerEta.status, 200);
  const customerEtaWrite = await post(
    `/api/v1/jobs/${seaJobId}/eta`,
    TEST_CUSTOMER_A_TOKEN,
    { etaAt: "2026-10-05T06:00:00Z", source: "x" },
  );
  assert.equal(customerEtaWrite.status, 403);
  const otherCustomerEta = await call(
    `/api/v1/jobs/${seaJobId}/eta`,
    TEST_CUSTOMER_B_TOKEN,
  );
  assert.equal(otherCustomerEta.status, 404);
  const anonymous = await fetch(`${baseUrl}/api/v1/jobs/${seaJobId}/eta`);
  assert.equal(anonymous.status, 401);

  // A follow-up raised before closing can still be finished afterwards.
  const followUp = (await (
    await post(`/api/v1/jobs/${otherSeaJobId}/tasks`, TEST_SUPER_ADMIN_TOKEN, {
      title: "Agree damage claim",
      kind: "damage",
      assignedRole: "super_admin",
    })
  ).json()) as { id: string };

  // Closed jobs are read-only until reopened.
  const cancelled = await post(
    `/api/v1/jobs/${otherSeaJobId}/status`,
    TEST_SUPER_ADMIN_TOKEN,
    { status: "cancelled", reason: "Customer withdrew" },
  );
  assert.equal(cancelled.status, 201);
  const etaOnCancelled = await post(
    `/api/v1/jobs/${otherSeaJobId}/eta`,
    TEST_SUPER_ADMIN_TOKEN,
    { etaAt: "2026-10-05T06:00:00Z", source: "x" },
  );
  assert.equal(etaOnCancelled.status, 409);
  const taskOnCancelled = await post(
    `/api/v1/jobs/${otherSeaJobId}/tasks`,
    TEST_SUPER_ADMIN_TOKEN,
    { title: "x", assignedRole: "import_rep" },
  );
  assert.equal(taskOnCancelled.status, 409);
  const finished = await post(
    `/api/v1/jobs/${otherSeaJobId}/tasks/${followUp.id}/complete`,
    TEST_SUPER_ADMIN_TOKEN,
    { note: "Claim agreed with customer" },
  );
  assert.equal(finished.status, 201);
  assert.equal(((await finished.json()) as { status: string }).status, "done");
});
