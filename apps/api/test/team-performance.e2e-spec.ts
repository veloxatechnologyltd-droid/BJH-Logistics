import "reflect-metadata";
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
import {
  beginTestDatabase,
  endTestDatabase,
  testPostgresPool,
} from "./postgres-test-database";

// TEST_UNASSIGNED is made a sales rep, TEST_MATCHING an import rep
// (Operations); the super admin reads everyone's numbers.
const SALES = TEST_UNASSIGNED_TOKEN;
const IMPORT_REP = TEST_MATCHING_TOKEN;
const ADMIN = TEST_SUPER_ADMIN_TOKEN;

let application: INestApplication;
let baseUrl: string;
const today = new Date().toISOString().slice(0, 10);

type Person = {
  userId: string;
  name: string;
  roles: string[];
  teams: string[];
  mine: boolean;
  metrics: Record<string, { current: number; previous: number }>;
  collected: unknown[];
};
type Team = {
  from: string;
  to: string;
  previousFrom: string;
  manager: boolean;
  teams: Array<{ teamKey: string; metrics: Array<{ key: string }> }>;
  people: Person[];
};

function call(path: string, token: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  if (init.body) headers.set("content-type", "application/json");
  return fetch(`${baseUrl}${path}`, { ...init, headers });
}
const post = (path: string, token: string, body: unknown = {}) =>
  call(path, token, { method: "POST", body: JSON.stringify(body) });
const team = async (token: string, from = today, to = today) =>
  (await (
    await call(`/api/v1/performance/team?from=${from}&to=${to}`, token)
  ).json()) as Team;
const person = (result: Team, userId: string) =>
  result.people.find((entry) => entry.userId === userId);

before(async () => {
  await beginTestDatabase();
  const started = await createTestApplication();
  application = started.application;
  baseUrl = started.baseUrl;
  const database = application.get(DatabasePort);
  await database.assignStaffRole(
    TEST_UNASSIGNED_USER_ID,
    "sales_rep",
    TEST_SUPER_ADMIN_ID,
  );
  await database.assignStaffRole(
    TEST_MATCHING_USER_ID,
    "import_rep",
    TEST_SUPER_ADMIN_ID,
  );
});

after(async () => {
  await application?.close();
  await endTestDatabase();
});

test("each person's work is counted from what they actually did", async () => {
  // Sales: two leads and one follow-up.
  const leadIds: string[] = [];
  for (const name of ["First Synthetic Ltd", "Second Synthetic Ltd"]) {
    const lead = await post("/api/v1/leads", SALES, { companyName: name });
    assert.equal(lead.status, 201, await lead.clone().text());
    leadIds.push(((await lead.json()) as { id: string }).id);
  }
  assert.equal(
    (
      await post(`/api/v1/leads/${leadIds[0]}/activities`, SALES, {
        kind: "call",
        note: "Spoke to the manager",
      })
    ).status,
    201,
  );
  // Operations: one task finished.
  const task = await post("/api/v1/tasks", ADMIN, {
    title: "Chase the BL",
    assignedUserId: TEST_MATCHING_USER_ID,
  });
  const taskId = ((await task.json()) as { id: string }).id;
  assert.equal(
    (await post(`/api/v1/tasks/${taskId}/complete`, IMPORT_REP)).status,
    201,
  );

  const result = await team(ADMIN);
  assert.equal(result.manager, true);
  assert.equal(result.from, today);
  const sales = person(result, TEST_UNASSIGNED_USER_ID)!;
  assert.deepEqual(sales.teams, ["sales"]);
  assert.equal(sales.metrics.leads_added.current, 2);
  assert.equal(sales.metrics.lead_followups.current, 1);
  assert.equal(sales.metrics.leads_won.current, 0);
  assert.equal(sales.metrics.tasks_done.current, 0);
  assert.equal(
    sales.metrics.quotes_issued,
    undefined,
    "only their team's numbers",
  );
  const ops = person(result, TEST_MATCHING_USER_ID)!;
  assert.equal(ops.metrics.tasks_done.current, 1);
  assert.equal(ops.metrics.leads_added, undefined);
  assert.ok(ops.roles.length > 0 && ops.name);
  assert.equal(
    person(result, TEST_SUPER_ADMIN_ID),
    undefined,
    "the super admin is the reader, not a row",
  );
  assert.deepEqual(
    result.teams.map((entry) => entry.teamKey),
    ["sales", "operations"],
  );
});

test("a won lead counts, and the previous period is reported beside the current one", async () => {
  // One lead was added yesterday and won today.
  await testPostgresPool.query(
    `UPDATE app.lead SET created_at = created_at - interval '1 day'
     WHERE lead_id = (SELECT lead_id FROM app.lead
                      WHERE company_name = 'First Synthetic Ltd')`,
  );
  const company = await testPostgresPool.query(
    `INSERT INTO app.customer_company (company_name)
     VALUES ('First Synthetic Ltd') RETURNING company_id`,
  );
  await testPostgresPool.query(
    `UPDATE app.lead SET stage = 'won', stage_changed_at = clock_timestamp(),
       customer_company_id = $1
     WHERE company_name = 'First Synthetic Ltd'`,
    [company.rows[0].company_id],
  );
  const sales = person(await team(ADMIN), TEST_UNASSIGNED_USER_ID)!;
  assert.deepEqual(sales.metrics.leads_added, { current: 1, previous: 1 });
  assert.deepEqual(sales.metrics.leads_won, { current: 1, previous: 0 });

  // A period with nothing in it shows zeros, not missing people.
  const empty = person(
    await team(ADMIN, "2020-01-01", "2020-01-31"),
    TEST_UNASSIGNED_USER_ID,
  )!;
  assert.equal(empty.metrics.leads_added.current, 0);
});

test("staff see only their own numbers; customers see nothing", async () => {
  for (const [token, userId] of [
    [SALES, TEST_UNASSIGNED_USER_ID],
    [IMPORT_REP, TEST_MATCHING_USER_ID],
  ]) {
    const own = await team(token);
    assert.equal(own.manager, false);
    assert.deepEqual(
      own.people.map((entry) => entry.userId),
      [userId],
    );
    assert.equal(own.people[0].mine, true);
  }
  const customer = await call(
    "/api/v1/performance/team",
    TEST_CUSTOMER_A_TOKEN,
  );
  assert.ok([401, 403].includes(customer.status));
});

test("bad periods are refused", async () => {
  for (const query of [
    "from=2026-11-16",
    "from=2026-11-17&to=2026-11-16",
    "from=2020-01-01&to=2026-11-16",
    "from=nope&to=nope",
  ]) {
    const response = await call(`/api/v1/performance/team?${query}`, ADMIN);
    assert.equal(response.status, 400, query);
  }
});
