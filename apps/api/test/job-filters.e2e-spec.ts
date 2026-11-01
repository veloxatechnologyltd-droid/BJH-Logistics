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
import {
  beginTestDatabase,
  endTestDatabase,
  testPostgresPool,
} from "./postgres-test-database";

let application: INestApplication;
let baseUrl: string;
let companyA: string;
let companyB: string;
const files: Record<string, string> = {};

type Listed = {
  fileNumber: string;
  currentEtaAt: string | null;
  leadUserId: string | null;
  leadEmail?: string | null;
};

function call(path: string, token: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  if (init.body) headers.set("content-type", "application/json");
  return fetch(`${baseUrl}${path}`, { ...init, headers });
}
const post = (path: string, token: string, body: unknown) =>
  call(path, token, { method: "POST", body: JSON.stringify(body) });

async function list(query: string, token = TEST_SUPER_ADMIN_TOKEN) {
  const response = await call(`/api/v1/jobs?${query}`, token);
  assert.equal(response.status, 200, await response.clone().text());
  return (await response.json()) as Listed[];
}
const numbers = (jobs: Listed[]) => jobs.map((job) => job.fileNumber).sort();

async function open(name: string, companyId: string, serviceLine: string) {
  const response = await post("/api/v1/jobs", TEST_SUPER_ADMIN_TOKEN, {
    customerCompanyId: companyId,
    serviceLine,
  });
  const job = (await response.json()) as { id: string; fileNumber: string };
  files[name] = job.fileNumber;
  return job.id;
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
  companyA = randomUUID();
  companyB = randomUUID();
  for (const [id, name] of [
    [companyA, "Filter North Ltd"],
    [companyB, "Filter South Ltd"],
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

  const seaImport = await open("seaImport", companyA, "sea_import");
  await open("airExport", companyB, "air_export");
  const oldClosed = await open("oldClosed", companyA, "air_import");
  const recentClosed = await open("recentClosed", companyB, "sea_export");

  await post(`/api/v1/jobs/${seaImport}/eta`, TEST_SUPER_ADMIN_TOKEN, {
    etaAt: "2026-12-10T08:00:00.000Z",
    source: "Carrier notice",
  });
  for (const id of [oldClosed, recentClosed]) {
    const closed = await post(
      `/api/v1/jobs/${id}/status`,
      TEST_SUPER_ADMIN_TOKEN,
      {
        status: "cancelled",
        reason: "Client withdrew",
      },
    );
    assert.equal(closed.status, 201, await closed.clone().text());
  }
  // One finished long ago, as years of history will be.
  await testPostgresPool.query(
    `UPDATE app.job SET closed_at = now() - interval '200 days'
     WHERE job_id = $1::uuid`,
    [oldClosed],
  );
  // The super admin overrides the invoice rule so the job has a lead to filter on.
  const lead = await post(
    `/api/v1/jobs/${seaImport}/team`,
    TEST_SUPER_ADMIN_TOKEN,
    {
      userId: TEST_MATCHING_USER_ID,
      overrideReason: "Synthetic test job",
    },
  );
  assert.equal(lead.status, 201, await lead.clone().text());
});

after(async () => {
  await application?.close();
  await endTestDatabase();
});

test("status, service and customer filters combine", async () => {
  assert.deepEqual(numbers(await list("status=open")), [
    files.airExport,
    files.seaImport,
  ]);
  assert.deepEqual(numbers(await list("serviceLine=sea_import,air_import")), [
    files.oldClosed,
    files.seaImport,
  ]);
  assert.deepEqual(
    numbers(await list(`customerCompanyId=${companyB}&status=cancelled`)),
    [files.recentClosed],
  );
});

test("the board's window leaves out jobs finished long ago", async () => {
  const since = new Date(Date.now() - 30 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  assert.deepEqual(numbers(await list(`closedSince=${since}`)), [
    files.airExport,
    files.recentClosed,
    files.seaImport,
  ]);
});

test("opened and ETA date ranges filter by day", async () => {
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86_400_000)
    .toISOString()
    .slice(0, 10);
  assert.equal((await list(`openedFrom=${today}&openedTo=${today}`)).length, 4);
  assert.deepEqual(await list(`openedTo=${yesterday}`), []);
  const withEta = await list("etaFrom=2026-12-10&etaTo=2026-12-10");
  assert.deepEqual(numbers(withEta), [files.seaImport]);
  assert.equal(withEta[0].currentEtaAt, "2026-12-10T08:00:00.000Z");
  assert.deepEqual(await list("etaFrom=2026-12-11"), []);
});

test("my jobs are the ones I lead or assist, and staff see the lead", async () => {
  const mine = await list("assignedTo=me", TEST_MATCHING_TOKEN);
  assert.deepEqual(numbers(mine), [files.seaImport]);
  assert.equal(mine[0].leadUserId, TEST_MATCHING_USER_ID);
  assert.equal(mine[0].leadEmail, "air-import@example.test");
  assert.deepEqual(numbers(await list(`assignedTo=${TEST_MATCHING_USER_ID}`)), [
    files.seaImport,
  ]);
  // Filters never widen what a rep may see: export jobs stay hidden.
  assert.deepEqual(
    numbers(await list("serviceLine=air_export", TEST_MATCHING_TOKEN)),
    [],
  );
});

test("customers keep to their own jobs and never see who works them", async () => {
  const own = await list("", TEST_CUSTOMER_A_TOKEN);
  assert.deepEqual(numbers(own), [files.oldClosed, files.seaImport]);
  assert.ok(own.every((job) => job.leadUserId === null && !job.leadEmail));
  assert.deepEqual(
    numbers(await list(`customerCompanyId=${companyB}`, TEST_CUSTOMER_A_TOKEN)),
    [],
  );
});

test("bad filters are refused with a clear message", async () => {
  for (const [query, message] of [
    [
      "status=finished",
      "status must be one or more of open, in_progress, on_hold, ready_to_close, closed, cancelled",
    ],
    [
      "serviceLine=rail",
      "serviceLine must be one or more of sea_import, sea_export, air_import, air_export, warehousing, road_transport",
    ],
    ["openedFrom=2026-02-30", "openedFrom must be a date (YYYY-MM-DD)"],
    ["assignedTo=someone", "assignedTo must be me or a valid ID"],
    ["customerCompanyId=x", "customerCompanyId must be a valid ID"],
  ]) {
    const response = await call(
      `/api/v1/jobs?${query}`,
      TEST_SUPER_ADMIN_TOKEN,
    );
    assert.equal(response.status, 400, query);
    assert.equal(
      ((await response.json()) as { message: string }).message,
      message,
    );
  }
});
