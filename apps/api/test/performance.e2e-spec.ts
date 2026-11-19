import "reflect-metadata";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import type { INestApplication } from "@nestjs/common";
import { after, before, test } from "node:test";
import {
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

// Who is who here: TEST_MATCHING is an import rep (Operations team);
// TEST_UNASSIGNED is given the customer service role (its own team); the super admin belongs
// to every team.
const IMPORT_REP = TEST_MATCHING_TOKEN;
const DESK = TEST_UNASSIGNED_TOKEN;
const ADMIN = TEST_SUPER_ADMIN_TOKEN;

let application: INestApplication;
let baseUrl: string;

type Report = {
  id: string;
  teamKey: string;
  period: string;
  periodStart: string;
  newCount: number;
  completedCount: number;
  overdueCount: number;
  blockers: string | null;
  notes: string | null;
  summary: string | null;
  plan: string | null;
  activity: {
    metrics: Array<{ key: string; current: number }>;
    items: Array<{ kind: string; detail: string | null }>;
  } | null;
  authorName: string;
  mine: boolean;
};
type Preview = {
  period: string;
  periodStart: string;
  teamKey: string;
  teams: string[];
  newCount: number;
  completedCount: number;
  overdueCount: number;
  activity: NonNullable<Report["activity"]>;
  submitted: Report | null;
};
const SUMMARY = "Followed up two shipments";
// A job update for a client not opened as a job yet (a prospect).
const UPDATE = {
  client: "Synthetic Prospect Ltd",
  workDone: "Sent the rate request",
  nextAction: "Call back with the rate",
  status: "in_progress",
};
const DAILY = {
  period: "daily",
  department: "operations",
  jobUpdates: [UPDATE],
};
const WEEKLY = {
  period: "weekly",
  department: "operations",
  summary: SUMMARY,
  kpiTarget: "95% delivered on time",
  kpiActual: "90%",
  kpiAction: "Book trucks a day earlier",
  plan: "Clear the overdue file, Kofi, by Friday",
};

function call(path: string, token: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  if (init.body) headers.set("content-type", "application/json");
  return fetch(`${baseUrl}${path}`, { ...init, headers });
}
const post = (path: string, token: string, body: unknown = {}) =>
  call(path, token, { method: "POST", body: JSON.stringify(body) });
const listFor = async (token: string, query = "") =>
  (await (await call(`/api/v1/performance${query}`, token)).json()) as Report[];

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
    "customer_service_rep",
    TEST_SUPER_ADMIN_ID,
  );
});

after(async () => {
  await application?.close();
  await endTestDatabase();
});

test("the numbers come from the person's own tasks, and a client cannot set them", async () => {
  // Two tasks for the import rep: one overdue and open, one done today.
  const overdue = await post("/api/v1/tasks", ADMIN, {
    title: "Overdue call",
    assignedUserId: TEST_MATCHING_USER_ID,
    dueDate: "2020-01-01",
  });
  assert.equal(overdue.status, 201);
  const quick = await post("/api/v1/tasks", ADMIN, {
    title: "Quick job",
    assignedUserId: TEST_MATCHING_USER_ID,
  });
  const quickTask = (await quick.json()) as { id: string };
  assert.equal(
    (await post(`/api/v1/tasks/${quickTask.id}/complete`, IMPORT_REP)).status,
    201,
  );
  // A task for someone else must not count.
  await post("/api/v1/tasks", ADMIN, {
    title: "Not theirs",
    assignedUserId: TEST_SUPER_ADMIN_ID,
  });

  const preview = (await (
    await call("/api/v1/performance/preview?period=daily", IMPORT_REP)
  ).json()) as Preview;
  assert.equal(preview.teamKey, "operations");
  assert.deepEqual(preview.teams, ["operations"]);
  assert.equal(preview.newCount, 2);
  assert.equal(preview.completedCount, 1);
  assert.equal(preview.overdueCount, 1);
  assert.equal(preview.submitted, null);
  // What the system recorded: the finished task, as a result and as an item.
  assert.deepEqual(
    preview.activity.metrics.map((m) => m.key),
    ["jobs_taken", "jobs_completed", "milestones", "tasks_done"],
    "the Operations results only",
  );
  assert.equal(
    preview.activity.metrics.find((m) => m.key === "tasks_done")?.current,
    1,
  );
  assert.deepEqual(
    preview.activity.items.map((item) => [item.kind, item.detail]),
    [["task_done", "Quick job"]],
  );

  // A daily report needs at least one job update.
  assert.equal(
    (
      await post("/api/v1/performance", IMPORT_REP, {
        ...DAILY,
        jobUpdates: [],
      })
    ).status,
    400,
  );

  const sent = await post("/api/v1/performance", IMPORT_REP, {
    ...DAILY,
    summary: `  ${SUMMARY}  `,
    blockers: "  Waiting on the customs release  ",
    plan: "Call the shipping line",
    notes: "Chased two documents",
    // Counts sent by a client are ignored.
    newCount: 99,
    completedCount: 99,
    overdueCount: 99,
  });
  assert.equal(sent.status, 201);
  const report = (await sent.json()) as Report;
  assert.equal(report.newCount, 2);
  assert.equal(report.completedCount, 1);
  assert.equal(report.overdueCount, 1);
  assert.equal(report.teamKey, "operations");
  assert.equal(report.blockers, "Waiting on the customs release");
  assert.equal(report.summary, SUMMARY);
  assert.equal(report.plan, "Call the shipping line");
  assert.deepEqual(
    report.activity,
    preview.activity,
    "the recorded activity is kept with the report",
  );
  assert.equal(report.mine, true);
  assert.ok(report.authorName);
  assert.equal(report.periodStart, preview.periodStart);

  const again = await post("/api/v1/performance", IMPORT_REP, {
    ...DAILY,
  });
  assert.equal(again.status, 201, "a person may add another report");
  const second = (await again.json()) as Report;
  const after = (await (
    await call("/api/v1/performance/preview?period=daily", IMPORT_REP)
  ).json()) as Preview;
  assert.equal(after.submitted?.id, second.id, "the latest one is shown");
});

test("a weekly report starts on a Monday and is separate from the daily one", async () => {
  const sent = await post("/api/v1/performance", IMPORT_REP, {
    ...WEEKLY,
  });
  assert.equal(sent.status, 201);
  const report = (await sent.json()) as Report;
  assert.equal(report.blockers, null, "no blockers when none are given");
  assert.equal(new Date(`${report.periodStart}T00:00:00Z`).getUTCDay(), 1);
});

test("reports are visible to the author's team and the super admin only", async () => {
  const own = await listFor(IMPORT_REP);
  assert.deepEqual(own.map((r) => r.period).sort(), [
    "daily",
    "daily",
    "weekly",
  ]);
  assert.equal(
    (await listFor(ADMIN)).length,
    3,
    "the super admin sees every team",
  );
  assert.deepEqual(
    await listFor(DESK),
    [],
    "customer service does not see Operations reports",
  );
  assert.deepEqual(
    (await listFor(ADMIN, "?period=weekly")).map((r) => r.period),
    ["weekly"],
  );
  assert.deepEqual(await listFor(ADMIN, "?teamKey=finance"), []);
});

test("a person reports only for their own team", async () => {
  const wrongTeam = await post("/api/v1/performance", DESK, {
    ...DAILY,
    teamKey: "operations",
  });
  assert.equal(wrongTeam.status, 403);
  const own = await post("/api/v1/performance", DESK, {
    ...DAILY,
  });
  assert.equal(own.status, 201);
  assert.equal(((await own.json()) as Report).teamKey, "customer_service");
  // The Operations rep still cannot see it; the super admin can.
  assert.equal((await listFor(IMPORT_REP)).length, 3);
  assert.equal((await listFor(DESK)).length, 1);
  assert.equal((await listFor(ADMIN)).length, 4);

  // The super admin is in every team, so must say which one.
  const unnamed = await post("/api/v1/performance", ADMIN, {
    ...DAILY,
  });
  assert.equal(unnamed.status, 400);
  const named = await post("/api/v1/performance", ADMIN, {
    ...DAILY,
    teamKey: "finance",
  });
  assert.equal(named.status, 201);
});

test("invalid requests are rejected and customers are refused", async () => {
  for (const body of [
    { period: "monthly" },
    {},
    { ...DAILY, teamKey: "marketing" },
    { ...DAILY, department: "marketing" },
    { ...DAILY, department: undefined },
    { ...DAILY, notes: "x".repeat(2001) },
    { ...DAILY, summary: "x".repeat(4001) },
    { ...DAILY, jobUpdates: [{ ...UPDATE, client: undefined }] },
    { ...DAILY, jobUpdates: [{ ...UPDATE, workDone: "  " }] },
    { ...DAILY, jobUpdates: [{ ...UPDATE, nextAction: undefined }] },
    { ...DAILY, jobUpdates: [{ ...UPDATE, status: "maybe" }] },
    { ...DAILY, jobUpdates: [{ ...UPDATE, followUpDate: "2026-02-30" }] },
    { ...DAILY, jobUpdates: Array(21).fill(UPDATE) },
    { ...WEEKLY, summary: undefined },
    { ...WEEKLY, kpiActual: "  " },
    { ...WEEKLY, plan: undefined },
  ]) {
    const response = await post("/api/v1/performance", IMPORT_REP, body);
    assert.equal(response.status, 400, JSON.stringify(body).slice(0, 40));
  }
  assert.equal(
    (await call("/api/v1/performance?teamKey=nope", ADMIN)).status,
    400,
  );
  assert.equal(
    (await call("/api/v1/performance/preview?period=yearly", ADMIN)).status,
    400,
  );
  for (const [path, method] of [
    ["/api/v1/performance", "GET"],
    ["/api/v1/performance/preview?period=daily", "GET"],
    ["/api/v1/performance", "POST"],
  ] as const) {
    const response = await call(path, TEST_CUSTOMER_A_TOKEN, {
      method,
      body: method === "POST" ? JSON.stringify({ period: "daily" }) : undefined,
    });
    assert.ok([401, 403].includes(response.status), `${method} ${path}`);
  }
});

type Roster = {
  manager: boolean;
  daily?: Slice;
  weekly?: Slice;
};
type Slice = {
  periodStart: string;
  expected: number;
  reported: number;
  missing: Array<{ userId: string; name: string; teams: string[] }>;
};

test("the super admin sees who still owes a report; others do not", async () => {
  const roster = (await (
    await call("/api/v1/performance/roster", ADMIN)
  ).json()) as Roster;
  assert.equal(roster.manager, true);
  const daily = roster.daily!;
  const weekly = roster.weekly!;
  // Both sent today's report; only the import rep sent this week's.
  const dailyMissing = daily.missing.map((person) => person.userId);
  const weeklyMissing = weekly.missing.map((person) => person.userId);
  assert.ok(!dailyMissing.includes(TEST_MATCHING_USER_ID));
  assert.ok(!dailyMissing.includes(TEST_UNASSIGNED_USER_ID));
  assert.ok(!weeklyMissing.includes(TEST_MATCHING_USER_ID));
  assert.ok(weeklyMissing.includes(TEST_UNASSIGNED_USER_ID));
  // The super admin reads the reports and is not asked to send one.
  assert.ok(!dailyMissing.includes(TEST_SUPER_ADMIN_ID));
  assert.ok(!weeklyMissing.includes(TEST_SUPER_ADMIN_ID));
  assert.equal(daily.expected - daily.reported, daily.missing.length);
  assert.equal(weekly.expected - weekly.reported, weekly.missing.length);
  const person = weekly.missing.find(
    (entry) => entry.userId === TEST_UNASSIGNED_USER_ID,
  )!;
  assert.deepEqual(person.teams, ["customer_service"]);
  assert.ok(person.name);

  // Everyone else gets no roster, and no names.
  for (const token of [IMPORT_REP, DESK]) {
    const other = (await (
      await call("/api/v1/performance/roster", token)
    ).json()) as Roster;
    assert.deepEqual(other, { manager: false });
  }
  const customer = await call(
    "/api/v1/performance/roster",
    TEST_CUSTOMER_A_TOKEN,
  );
  assert.ok([401, 403].includes(customer.status));

  // Once customer service sends the weekly report, they leave the list.
  assert.equal(
    (
      await post("/api/v1/performance", DESK, {
        ...WEEKLY,
      })
    ).status,
    201,
  );
  const after = (await (
    await call("/api/v1/performance/roster", ADMIN)
  ).json()) as Roster;
  assert.ok(
    !after.weekly!.missing.some((p) => p.userId === TEST_UNASSIGNED_USER_ID),
  );
});

test("reports with blockers can be listed on their own", async () => {
  const withBlockers = await listFor(ADMIN, "?blockers=yes");
  assert.equal(withBlockers.length, 1);
  assert.equal(withBlockers[0].blockers, "Waiting on the customs release");
  assert.ok((await listFor(ADMIN)).length > 1);
  // The team rule still applies: customer service cannot see Operations blockers.
  assert.deepEqual(await listFor(DESK, "?blockers=yes"), []);
  assert.equal(
    (await call("/api/v1/performance?blockers=maybe", ADMIN)).status,
    400,
  );
});

test("a daily report carries the person's job updates, checked against their jobs", async () => {
  const database = application.get(DatabasePort);
  const company = randomUUID();
  await database.createCustomer({
    id: company,
    companyName: "Synthetic Cocoa Exporters Ltd",
    createdAt: new Date().toISOString(),
    contacts: [],
  });
  const importJob = await database.createJob(
    {
      customerCompanyId: company,
      serviceLine: "sea_import",
      quoteRequestId: null,
    },
    TEST_SUPER_ADMIN_ID,
    2026,
  );
  const exportJob = await database.createJob(
    {
      customerCompanyId: company,
      serviceLine: "sea_export",
      quoteRequestId: null,
    },
    TEST_SUPER_ADMIN_ID,
    2026,
  );
  const jobUpdate = {
    jobId: importJob.id,
    client: "Synthetic Cocoa Exporters Ltd · BL SYNTH0001",
    workDone: "Collected the release",
    agreedDeadline: "20/11/2026 17:00",
    nextAction: "Deliver to the warehouse",
    nextActionUserId: TEST_UNASSIGNED_USER_ID,
    followUpDate: "2026-11-20",
    evidence: "Release order 4411",
    status: "in_progress",
  };

  const sent = await post("/api/v1/performance", IMPORT_REP, {
    ...DAILY,
    jobUpdates: [jobUpdate, { ...UPDATE, status: "blocked" }],
    blockers: "Waiting on the shipping line",
  });
  assert.equal(sent.status, 201);
  const report = (await sent.json()) as Report & {
    department: string;
    jobUpdates: Array<Record<string, unknown>>;
  };
  assert.equal(report.department, "operations");
  assert.equal(report.jobUpdates.length, 2, "several jobs in one report");
  assert.equal(report.jobUpdates[0].jobReference, importJob.fileNumber);
  assert.equal(report.jobUpdates[0].workDone, "Collected the release");
  assert.ok(report.jobUpdates[0].nextActionName, "the person's name is kept");
  assert.equal(report.jobUpdates[1].jobId, null);
  assert.equal(report.jobUpdates[1].status, "blocked");

  // An import rep cannot report on an export job, nor an unknown one.
  for (const jobId of [exportJob.id, randomUUID()]) {
    const refused = await post("/api/v1/performance", IMPORT_REP, {
      ...DAILY,
      jobUpdates: [{ ...jobUpdate, jobId }],
    });
    assert.equal(refused.status, 404);
  }
  // The next action goes to staff, not to a customer.
  const toCustomer = await post("/api/v1/performance", IMPORT_REP, {
    ...DAILY,
    jobUpdates: [{ ...jobUpdate, nextActionUserId: randomUUID() }],
  });
  assert.equal(toCustomer.status, 400);
});

test("a weekly review carries the workload totals and the department figure", async () => {
  const preview = (await (
    await call("/api/v1/performance/preview?period=weekly", IMPORT_REP)
  ).json()) as Preview & {
    department: string;
    openingActive: number;
    closingActive: number;
  };
  assert.equal(preview.department, "operations");
  assert.equal(typeof preview.openingActive, "number");
  // The overdue task is still open.
  assert.ok(preview.closingActive >= 1);
  const sent = await post("/api/v1/performance", IMPORT_REP, {
    ...WEEKLY,
    department: "documentation",
    // Counts sent by a client are ignored.
    openingActive: 99,
    closingActive: 99,
  });
  assert.equal(sent.status, 201);
  const report = (await sent.json()) as Report & {
    department: string;
    openingActive: number;
    closingActive: number;
    kpiTarget: string;
    kpiActual: string;
    kpiAction: string;
    jobUpdates: unknown;
  };
  assert.equal(report.department, "documentation", "the person may pick");
  assert.equal(report.openingActive, preview.openingActive);
  assert.equal(report.closingActive, preview.closingActive);
  assert.equal(report.kpiTarget, "95% delivered on time");
  assert.equal(report.kpiActual, "90%");
  assert.equal(report.kpiAction, "Book trucks a day earlier");
  assert.equal(report.jobUpdates, null);
});
