import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { after, before, test } from "node:test";
import {
  TEST_CUSTOMER_A_ID,
  TEST_CUSTOMER_A_TOKEN,
  TEST_CUSTOMER_B_ID,
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
let companyA: string;
let companyB: string;

function call(path: string, token: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  if (init.body) headers.set("content-type", "application/json");
  return fetch(`${baseUrl}${path}`, { ...init, headers });
}

function post(path: string, token: string, body: unknown) {
  return call(path, token, { method: "POST", body: JSON.stringify(body) });
}

before(async () => {
  await beginTestDatabase();
  const started = await createTestApplication();
  application = started.application;
  baseUrl = started.baseUrl;
  const database = application.get(DatabasePort);
  await database.assignStaffRole(
    TEST_MATCHING_USER_ID,
    "customer_service_rep",
    TEST_SUPER_ADMIN_ID,
  );
  await database.assignStaffRole(
    TEST_UNASSIGNED_USER_ID,
    "export_rep",
    TEST_SUPER_ADMIN_ID,
  );
  companyA = randomUUID();
  companyB = randomUUID();
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
});

after(async () => {
  await application?.close();
  await endTestDatabase();
});

const content = () => ({
  currency: "GHS",
  title: "Synthetic clearance quotation",
  procedureSteps: [],
  requiredDocuments: [],
  terms: [],
  sizeLabels: ["20ft", "40ft"],
  lines: [
    {
      description: "BJH service fee",
      basis: "per_container",
      sizeAmountsMinor: [150000, 180000],
    },
  ],
});

type Quote = {
  id: string;
  jobId: string | null;
  quoteNumber: string | null;
  decisions: Array<{
    id: string;
    versionNumber: number;
    decision: string;
    clientSignatory: string;
    recordedBy: string;
  }>;
};
type Decided = {
  decision: { id: string; decision: string };
  job: { id: string; fileNumber: string; serviceLine: string } | null;
};

async function issuedQuote(token: string, customerCompanyId: string) {
  const created = (await (
    await post("/api/v1/quotes", token, {
      customerCompanyId,
      serviceLine: "sea_import",
      version: content(),
    })
  ).json()) as Quote;
  await post(`/api/v1/quotes/${created.id}/issue`, token, {});
  return created.id;
}

const decide = (quoteId: string, token: string, body: unknown) =>
  post(`/api/v1/quotes/${quoteId}/decision`, token, body);

const accept = (versionNumber = 1, over: Record<string, unknown> = {}) => ({
  versionNumber,
  decision: "accepted",
  clientSignatory: "  A. Client  ",
  ...over,
});

let quoteId: string;

test("only an issued version can be decided", async () => {
  const draft = (await (
    await post("/api/v1/quotes", TEST_MATCHING_TOKEN, {
      customerCompanyId: companyA,
      serviceLine: "sea_import",
      version: content(),
    })
  ).json()) as Quote;
  const response = await decide(draft.id, TEST_MATCHING_TOKEN, accept());
  assert.equal(response.status, 409);
  const missing = await decide(draft.id, TEST_MATCHING_TOKEN, accept(9));
  assert.equal(missing.status, 404);
});

test("a rejection is recorded against a version and cannot be reversed", async () => {
  quoteId = await issuedQuote(TEST_MATCHING_TOKEN, companyA);
  const rejected = await decide(quoteId, TEST_MATCHING_TOKEN, {
    versionNumber: 1,
    decision: "rejected",
    clientSignatory: "A. Client",
    note: "Rates too high",
  });
  assert.equal(rejected.status, 201);
  const body = (await rejected.json()) as Decided;
  assert.equal(body.decision.decision, "rejected");
  assert.equal(body.job, null);

  const again = (await (
    await decide(quoteId, TEST_MATCHING_TOKEN, {
      versionNumber: 1,
      decision: "rejected",
      clientSignatory: "A. Client",
    })
  ).json()) as Decided;
  assert.equal(again.decision.id, body.decision.id);

  const reversed = await decide(quoteId, TEST_MATCHING_TOKEN, accept(1));
  assert.equal(reversed.status, 409);
});

test("accepting opens exactly one job, even when the request is repeated at once", async () => {
  await post(`/api/v1/quotes/${quoteId}/versions`, TEST_MATCHING_TOKEN, {});
  await post(`/api/v1/quotes/${quoteId}/issue`, TEST_MATCHING_TOKEN, {});

  const results = await Promise.all(
    [1, 2, 3, 4].map(() => decide(quoteId, TEST_MATCHING_TOKEN, accept(2))),
  );
  assert.deepEqual(
    results.map((response) => response.status),
    [201, 201, 201, 201],
  );
  const bodies = (await Promise.all(
    results.map((response) => response.json()),
  )) as Decided[];
  const [first] = bodies;
  assert.ok(first.job);
  assert.match(
    first.job.fileNumber,
    new RegExp(`^BJH/SI/${new Date().getUTCFullYear()}/0001$`),
  );
  assert.equal(first.job.serviceLine, "sea_import");
  for (const item of bodies) {
    assert.equal(item.decision.id, first.decision.id);
    assert.equal(item.job?.id, first.job.id);
  }

  const jobs = (await (
    await call("/api/v1/jobs", TEST_SUPER_ADMIN_TOKEN)
  ).json()) as Array<{ id: string; customerCompanyName: string }>;
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].id, first.job.id);
  assert.equal(jobs[0].customerCompanyName, "Northstar Synthetic Ltd");

  const quote = (await (
    await call(`/api/v1/quotes/${quoteId}`, TEST_SUPER_ADMIN_TOKEN)
  ).json()) as Quote;
  assert.equal(quote.jobId, first.job.id);
  assert.deepEqual(
    quote.decisions.map((item) => [
      item.versionNumber,
      item.decision,
      item.clientSignatory,
      item.recordedBy,
    ]),
    [
      [1, "rejected", "A. Client", TEST_MATCHING_USER_ID],
      [2, "accepted", "A. Client", TEST_MATCHING_USER_ID],
    ],
  );

  const customerView = (await (
    await call(`/api/v1/quotes/${quoteId}`, TEST_CUSTOMER_A_TOKEN)
  ).json()) as Quote;
  assert.equal(customerView.jobId, first.job.id);
  assert.equal(customerView.decisions.length, 2);
});

test("an accepted quote is locked", async () => {
  const start = await post(
    `/api/v1/quotes/${quoteId}/versions`,
    TEST_MATCHING_TOKEN,
    {},
  );
  assert.equal(start.status, 409);
  const issue = await post(
    `/api/v1/quotes/${quoteId}/issue`,
    TEST_MATCHING_TOKEN,
    {},
  );
  assert.equal(issue.status, 409);
  const edit = await call(
    `/api/v1/quotes/${quoteId}/draft`,
    TEST_MATCHING_TOKEN,
    {
      method: "PUT",
      body: JSON.stringify(content()),
    },
  );
  assert.equal(edit.status, 409);
  const other = await decide(quoteId, TEST_MATCHING_TOKEN, {
    versionNumber: 2,
    decision: "rejected",
    clientSignatory: "A. Client",
  });
  assert.equal(other.status, 409);
});

test("only the latest issued version can be decided", async () => {
  const id = await issuedQuote(TEST_MATCHING_TOKEN, companyB);
  await post(`/api/v1/quotes/${id}/versions`, TEST_MATCHING_TOKEN, {});
  await post(`/api/v1/quotes/${id}/issue`, TEST_MATCHING_TOKEN, {});
  const stale = await decide(id, TEST_MATCHING_TOKEN, accept(1));
  assert.equal(stale.status, 409);
  const jobs = (await (
    await call("/api/v1/jobs", TEST_SUPER_ADMIN_TOKEN)
  ).json()) as unknown[];
  assert.equal(jobs.length, 1);
});

test("the super admin can also record a decision", async () => {
  const id = await issuedQuote(TEST_SUPER_ADMIN_TOKEN, companyB);
  const response = await decide(id, TEST_SUPER_ADMIN_TOKEN, accept());
  assert.equal(response.status, 201);
  const body = (await response.json()) as Decided;
  assert.match(String(body.job?.fileNumber), /\/0002$/);
});

test("invalid decisions are rejected", async () => {
  const id = await issuedQuote(TEST_MATCHING_TOKEN, companyB);
  const future = new Date(Date.now() + 3_600_000).toISOString();
  const cases: Array<[unknown, string]> = [
    [[], "A quote decision object is required"],
    [
      { decision: "accepted", clientSignatory: "x" },
      "versionNumber is required",
    ],
    [accept(0), "versionNumber must be a whole number"],
    [accept(1, { decision: "maybe" }), "decision must be accepted or rejected"],
    [
      accept(1, { clientSignatory: " " }),
      "clientSignatory must contain 1 to 160 characters",
    ],
    [
      accept(1, { decidedAt: "last week-ish" }),
      "decidedAt must be a date and time",
    ],
    [accept(1, { decidedAt: future }), "decidedAt cannot be in the future"],
  ];
  for (const [body, message] of cases) {
    const response = await decide(id, TEST_MATCHING_TOKEN, body);
    assert.equal(response.status, 400, message);
    assert.equal(
      ((await response.json()) as { message: string }).message,
      message,
    );
  }
});

test("access boundaries: other departments, customers and anonymous callers", async () => {
  const id = await issuedQuote(TEST_MATCHING_TOKEN, companyA);
  const wrongDepartment = await decide(id, TEST_UNASSIGNED_TOKEN, accept());
  // Staff without the quote desk are refused by role, whatever the service line.
  assert.equal(wrongDepartment.status, 403);
  const customer = await decide(id, TEST_CUSTOMER_A_TOKEN, accept());
  assert.equal(customer.status, 403);
  const anonymous = await fetch(`${baseUrl}/api/v1/quotes/${id}/decision`, {
    method: "POST",
  });
  assert.equal(anonymous.status, 401);
  const unknown = await decide(randomUUID(), TEST_SUPER_ADMIN_TOKEN, accept());
  assert.equal(unknown.status, 404);
  const detail = (await (
    await call(`/api/v1/quotes/${id}`, TEST_SUPER_ADMIN_TOKEN)
  ).json()) as Quote;
  assert.deepEqual(detail.decisions, []);
  assert.equal(detail.jobId, null);
});
