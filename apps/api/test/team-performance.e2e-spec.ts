import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
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

// TEST_UNASSIGNED sells and runs shipments (sales and import rep);
// TEST_MATCHING writes the quotes (customer service). The super admin reads.
const SELLER = TEST_UNASSIGNED_TOKEN;
const QUOTER = TEST_MATCHING_TOKEN;
const ADMIN = TEST_SUPER_ADMIN_TOKEN;

let application: INestApplication;
let baseUrl: string;
let companyId: string;
const today = new Date().toISOString().slice(0, 10);

type Money = Array<{ currency: string; current: number; previous: number }>;
type Person = {
  userId: string;
  teams: string[];
  mine: boolean;
  metrics: Record<string, { current: number; previous: number }>;
  money: Record<string, Money>;
};
type Team = {
  manager: boolean;
  teams: Array<{
    teamKey: string;
    metrics: Array<{ key: string; kind: string }>;
  }>;
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
  result.people.find((entry) => entry.userId === userId)!;
const ghs = (money: Money | undefined) =>
  money?.find((row) => row.currency === "GHS")?.current ?? 0;

before(async () => {
  await beginTestDatabase();
  const started = await createTestApplication();
  application = started.application;
  baseUrl = started.baseUrl;
  const database = application.get(DatabasePort);
  for (const [userId, role] of [
    [TEST_UNASSIGNED_USER_ID, "sales_rep"],
    [TEST_UNASSIGNED_USER_ID, "import_rep"],
    [TEST_MATCHING_USER_ID, "customer_service_rep"],
  ] as const) {
    await database.assignStaffRole(userId, role, TEST_SUPER_ADMIN_ID);
  }
  companyId = randomUUID();
  await database.createCustomer({
    id: companyId,
    companyName: "Won Synthetic Ltd",
    createdAt: new Date().toISOString(),
    contacts: [],
  });
});

after(async () => {
  await application?.close();
  await endTestDatabase();
});

test("quotes, their value, acceptance and the money they bring are credited to the right people", async () => {
  // The seller adds two leads; one becomes the customer.
  for (const name of ["Won Synthetic Ltd", "Other Synthetic Ltd"]) {
    const lead = await post("/api/v1/leads", SELLER, { companyName: name });
    assert.equal(lead.status, 201, await lead.clone().text());
  }
  await testPostgresPool.query(
    `UPDATE app.lead SET stage = 'won', stage_changed_at = clock_timestamp(),
       customer_company_id = $1 WHERE company_name = 'Won Synthetic Ltd'`,
    [companyId],
  );

  // The quoter sends a quote: 2 x 450.00 + 120.00; the at-cost line is not counted.
  const created = await post("/api/v1/quotes", QUOTER, {
    customerCompanyId: companyId,
    serviceLine: "sea_import",
    version: {
      currency: "GHS",
      title: "Synthetic clearance quotation",
      procedureSteps: [],
      requiredDocuments: [],
      terms: [],
      lines: [
        {
          description: "Clearing",
          basis: "per_container",
          quantity: 2,
          amountMinor: 45000,
        },
        { description: "Documentation", basis: "fixed", amountMinor: 12000 },
        { description: "Port charges", basis: "at_cost" },
      ],
    },
  });
  assert.equal(created.status, 201, await created.clone().text());
  const quoteId = ((await created.json()) as { id: string }).id;
  assert.equal(
    (await post(`/api/v1/quotes/${quoteId}/issue`, QUOTER)).status,
    201,
  );
  const decided = await post(`/api/v1/quotes/${quoteId}/decision`, QUOTER, {
    versionNumber: 1,
    decision: "accepted",
    clientSignatory: "A. Client",
  });
  assert.equal(decided.status, 201, await decided.clone().text());
  const jobId = ((await decided.json()) as { job: { id: string } }).job.id;

  // Finance invoices that job: 1,200.00.
  await testPostgresPool.query(
    `INSERT INTO app.invoice (job_id, invoice_number, status, currency,
       subtotal_minor, tax_total_minor, total_minor, created_by, issued_by,
       issued_at, customer_company_id, lines)
     VALUES ($1, 'INV-SYN-1', 'issued', 'GHS', 120000, 0, 120000, $2, $2,
       clock_timestamp(), $3,
       '[{"description":"Clearing","amountMinor":120000}]'::jsonb)`,
    [jobId, TEST_SUPER_ADMIN_ID, companyId],
  );

  const result = await team(ADMIN);
  assert.equal(result.manager, true);
  const quoter = person(result, TEST_MATCHING_USER_ID);
  assert.deepEqual(quoter.teams, ["customer_service"]);
  assert.equal(quoter.metrics.quotes_sent.current, 1);
  assert.equal(ghs(quoter.money.value_quoted), 102000);
  assert.equal(quoter.metrics.quotes_accepted.current, 1);
  assert.equal(ghs(quoter.money.value_accepted), 102000);
  assert.equal(quoter.metrics.quotes_lost.current, 0);
  assert.equal(ghs(quoter.money.revenue_quotes), 120000);

  const seller = person(result, TEST_UNASSIGNED_USER_ID);
  assert.deepEqual(seller.teams, ["sales", "operations"]);
  assert.equal(seller.metrics.leads_added.current, 2);
  assert.equal(seller.metrics.customers_won.current, 1);
  assert.equal(ghs(seller.money.revenue_customers), 120000);
  assert.equal(seller.metrics.quotes_sent, undefined, "only their teams");

  assert.equal(
    result.people.some((p) => p.userId === TEST_SUPER_ADMIN_ID),
    false,
    "the super admin reads; they are not a row",
  );
  assert.deepEqual(
    result.teams
      .find((t) => t.teamKey === "customer_service")
      ?.metrics.filter((m) => m.kind === "money")
      .map((m) => m.key),
    ["value_quoted", "value_accepted", "revenue_quotes"],
  );
});

test("shipment work counts, and the period before is reported beside it", async () => {
  const task = await post("/api/v1/tasks", ADMIN, {
    title: "Chase the BL",
    assignedUserId: TEST_UNASSIGNED_USER_ID,
  });
  const taskId = ((await task.json()) as { id: string }).id;
  assert.equal(
    (await post(`/api/v1/tasks/${taskId}/complete`, SELLER)).status,
    201,
  );
  await testPostgresPool.query(
    `UPDATE app.lead SET created_at = created_at - interval '1 day'
     WHERE company_name = 'Other Synthetic Ltd'`,
  );
  const seller = person(await team(ADMIN), TEST_UNASSIGNED_USER_ID);
  assert.equal(seller.metrics.tasks_done.current, 1);
  assert.deepEqual(seller.metrics.leads_added, { current: 1, previous: 1 });

  const empty = person(
    await team(ADMIN, "2020-01-01", "2020-01-31"),
    TEST_UNASSIGNED_USER_ID,
  );
  assert.equal(empty.metrics.leads_added.current, 0);
  assert.deepEqual(empty.money.revenue_customers, []);
});

test("staff see only their own numbers; customers see nothing", async () => {
  for (const [token, userId] of [
    [SELLER, TEST_UNASSIGNED_USER_ID],
    [QUOTER, TEST_MATCHING_USER_ID],
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
