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

// A second import rep with no sign-in of its own, to be added as an assistant.
const SECOND_IMPORT_REP_ID = "50000000-0000-4000-8000-000000000005";

let application: INestApplication;
let baseUrl: string;
let jobId: string;
let invoiceId: string;

type Team = {
  team: Array<{
    id: string;
    userId: string;
    kind: string;
    overrideReason: string | null;
  }>;
  history: Array<{ userId: string; removedAt: string | null }>;
  invoiceAccepted: boolean;
  invoices: Array<{
    id: string;
    invoiceNumber: string | null;
    issuedAt: string | null;
    acceptance: { signatoryName: string } | null;
  }>;
  candidates: Array<{ userId: string }>;
};

function call(path: string, token: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  if (init.body) headers.set("content-type", "application/json");
  return fetch(`${baseUrl}${path}`, { ...init, headers });
}
const post = (path: string, token: string, body: unknown = {}) =>
  call(path, token, { method: "POST", body: JSON.stringify(body) });
const message = async (response: Response) =>
  ((await response.json()) as { message: string }).message;
const team = async (token = TEST_UNASSIGNED_TOKEN) =>
  (await (await call(`/api/v1/jobs/${jobId}/team`, token)).json()) as Team;

async function issueInvoice(): Promise<string> {
  const draft = await post(
    `/api/v1/jobs/${jobId}/invoices`,
    TEST_SUPER_ADMIN_TOKEN,
    {
      currency: "GHS",
      lines: [{ description: "Clearance", amountMinor: 100000 }],
    },
  );
  const id = ((await draft.json()) as { id: string }).id;
  const issued = await post(
    `/api/v1/jobs/${jobId}/invoices/${id}/issue`,
    TEST_SUPER_ADMIN_TOKEN,
  );
  assert.equal(issued.status, 201, await issued.clone().text());
  return id;
}

before(async () => {
  await beginTestDatabase();
  const started = await createTestApplication();
  application = started.application;
  baseUrl = started.baseUrl;
  const database = application.get(DatabasePort);
  for (const [userId, role] of [
    [TEST_MATCHING_USER_ID, "import_rep"],
    [SECOND_IMPORT_REP_ID, "import_rep"],
    [TEST_UNASSIGNED_USER_ID, "customer_service_rep"],
  ] as const) {
    await database.assignStaffRole(userId, role, TEST_SUPER_ADMIN_ID);
  }
  const companyA = randomUUID();
  const companyB = randomUUID();
  for (const [id, name] of [
    [companyA, "Assign Synthetic Ltd"],
    [companyB, "Other Synthetic Ltd"],
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
  const saved = await call("/api/v1/settings", TEST_SUPER_ADMIN_TOKEN, {
    method: "PUT",
    body: JSON.stringify({
      issuer: { name: "Synthetic Forwarding Ltd", address: "1 Test Road" },
      currencies: ["GHS"],
      taxLines: [],
      paymentTermsDays: 30,
      numbering: {
        quotePrefix: "SYN/Q",
        invoicePrefix: "SYN/INV",
        receiptPrefix: "SYN/RCT",
      },
      quoteDefaults: {},
    }),
  });
  assert.equal(saved.status, 200);
  const opened = await post("/api/v1/jobs", TEST_SUPER_ADMIN_TOKEN, {
    customerCompanyId: companyA,
    serviceLine: "sea_import",
  });
  jobId = ((await opened.json()) as { id: string }).id;
  invoiceId = await issueInvoice();
});

after(async () => {
  await application?.close();
  await endTestDatabase();
});

test("the import reps are the people who can lead an import job", async () => {
  const view = await team();
  assert.deepEqual(view.team, []);
  assert.equal(view.invoiceAccepted, false);
  assert.deepEqual(view.candidates.map((item) => item.userId).sort(), [
    SECOND_IMPORT_REP_ID,
    TEST_MATCHING_USER_ID,
  ]);
  const customer = await call(
    `/api/v1/jobs/${jobId}/team`,
    TEST_CUSTOMER_A_TOKEN,
  );
  assert.equal(customer.status, 403);
});

test("customer service assigns as soon as the quote is accepted, before any invoice is accepted; reps cannot", async () => {
  const lead = { userId: TEST_MATCHING_USER_ID, kind: "lead" };
  assert.equal((await team()).invoiceAccepted, false);

  const rep = await post(
    `/api/v1/jobs/${jobId}/team`,
    TEST_MATCHING_TOKEN,
    lead,
  );
  assert.equal(rep.status, 403);

  const desk = await post(
    `/api/v1/jobs/${jobId}/team`,
    TEST_UNASSIGNED_TOKEN,
    lead,
  );
  assert.equal(desk.status, 201, await desk.clone().text());
  const assigned = (await desk.json()) as {
    id: string;
    overrideReason: string | null;
  };
  assert.equal(assigned.overrideReason, null);

  const removed = await call(
    `/api/v1/jobs/${jobId}/team/${assigned.id}`,
    TEST_SUPER_ADMIN_TOKEN,
    { method: "DELETE" },
  );
  assert.equal(removed.status, 200);
  const view = await team();
  assert.deepEqual(view.team, []);
  assert.equal(view.history.length, 1);
  assert.ok(view.history[0].removedAt);
});

test("the client accepts the invoice in the portal, once; other companies and reps cannot", async () => {
  const path = `/api/v1/jobs/${jobId}/invoices/${invoiceId}/accept`;
  assert.equal(
    (await post(path, TEST_MATCHING_TOKEN, { signatoryName: "X" })).status,
    403,
  );
  assert.equal(
    (await post(path, TEST_CUSTOMER_B_TOKEN, { signatoryName: "X" })).status,
    404,
  );
  assert.equal((await post(path, TEST_CUSTOMER_A_TOKEN, {})).status, 400);

  const accepted = await post(path, TEST_CUSTOMER_A_TOKEN, {
    signatoryName: "  Kojo Synthetic  ",
  });
  assert.equal(accepted.status, 201);
  const record = (await accepted.json()) as Record<string, unknown>;
  assert.equal(record.via, "portal");
  assert.equal(record.signatoryName, "Kojo Synthetic");
  assert.equal(record.acceptedBy, TEST_CUSTOMER_A_ID);

  const again = await post(path, TEST_SUPER_ADMIN_TOKEN, {
    signatoryName: "Kojo",
  });
  assert.equal(again.status, 409);

  const invoices = (await (
    await call(`/api/v1/jobs/${jobId}/invoices`, TEST_CUSTOMER_A_TOKEN)
  ).json()) as Array<{ acceptance: { signatoryName: string } | null }>;
  assert.equal(invoices[0].acceptance?.signatoryName, "Kojo Synthetic");
});

test("once accepted, customer service assigns the lead and adds an assistant", async () => {
  assert.equal((await team()).invoiceAccepted, true);

  const notARep = await post(
    `/api/v1/jobs/${jobId}/team`,
    TEST_UNASSIGNED_TOKEN,
    {
      userId: TEST_UNASSIGNED_USER_ID,
    },
  );
  assert.equal(notARep.status, 400);

  const assistantFirst = await post(
    `/api/v1/jobs/${jobId}/team`,
    TEST_UNASSIGNED_TOKEN,
    {
      userId: SECOND_IMPORT_REP_ID,
      kind: "assistant",
    },
  );
  assert.equal(assistantFirst.status, 409);
  assert.equal(
    await message(assistantFirst),
    "Assign a lead before adding assistants",
  );

  const lead = await post(`/api/v1/jobs/${jobId}/team`, TEST_UNASSIGNED_TOKEN, {
    userId: TEST_MATCHING_USER_ID,
  });
  assert.equal(lead.status, 201);
  assert.equal(
    ((await lead.json()) as { overrideReason: null }).overrideReason,
    null,
  );

  const assistant = await post(
    `/api/v1/jobs/${jobId}/team`,
    TEST_UNASSIGNED_TOKEN,
    {
      userId: SECOND_IMPORT_REP_ID,
      kind: "assistant",
    },
  );
  assert.equal(assistant.status, 201);

  const repeat = await post(
    `/api/v1/jobs/${jobId}/team`,
    TEST_UNASSIGNED_TOKEN,
    {
      userId: TEST_MATCHING_USER_ID,
    },
  );
  assert.equal(repeat.status, 409);

  // Promoting the assistant replaces the lead; the old lead's row is kept as history.
  const promoted = await post(
    `/api/v1/jobs/${jobId}/team`,
    TEST_UNASSIGNED_TOKEN,
    {
      userId: SECOND_IMPORT_REP_ID,
      kind: "lead",
    },
  );
  assert.equal(promoted.status, 201);
  const view = await team();
  assert.deepEqual(
    view.team.map((item) => [item.userId, item.kind]),
    [[SECOND_IMPORT_REP_ID, "lead"]],
  );
  assert.equal(view.history.length, 4);
});

test("customer service records the client's acceptance from the team card; finance does not", async () => {
  const secondInvoice = await issueInvoice();
  // The team view lists the issued invoice by number only (Evans, 2026-11-02).
  const listed = (await team()).invoices.find(
    (invoice) => invoice.id === secondInvoice,
  );
  assert.ok(listed);
  assert.ok(listed.invoiceNumber);
  assert.equal(listed.acceptance, null);
  assert.deepEqual(Object.keys(listed).sort(), [
    "acceptance",
    "id",
    "invoiceNumber",
    "issuedAt",
  ]);
  // Customer service also reads the invoices themselves (Evans, 2026-11-03).
  assert.equal(
    (await call(`/api/v1/jobs/${jobId}/invoices`, TEST_UNASSIGNED_TOKEN))
      .status,
    200,
  );

  const recorded = await post(
    `/api/v1/jobs/${jobId}/invoices/${secondInvoice}/accept`,
    TEST_UNASSIGNED_TOKEN,
    { signatoryName: "Kojo Synthetic" },
  );
  assert.equal(recorded.status, 201);
  assert.equal(((await recorded.json()) as { via: string }).via, "staff");
  assert.equal(
    (await team()).invoices.find((invoice) => invoice.id === secondInvoice)
      ?.acceptance?.signatoryName,
    "Kojo Synthetic",
  );

  // Finance works the invoices but does not record the client's acceptance.
  const database = application.get(DatabasePort);
  await database.revokeStaffRole(
    TEST_MATCHING_USER_ID,
    "import_rep",
    TEST_SUPER_ADMIN_ID,
  );
  await database.assignStaffRole(
    TEST_MATCHING_USER_ID,
    "finance_rep",
    TEST_SUPER_ADMIN_ID,
  );
  const thirdInvoice = await issueInvoice();
  const byFinance = await post(
    `/api/v1/jobs/${jobId}/invoices/${thirdInvoice}/accept`,
    TEST_MATCHING_TOKEN,
    { signatoryName: "Kojo Synthetic" },
  );
  assert.equal(byFinance.status, 403);

  const draft = await post(
    `/api/v1/jobs/${jobId}/invoices`,
    TEST_SUPER_ADMIN_TOKEN,
    {
      currency: "GHS",
    },
  );
  const draftId = ((await draft.json()) as { id: string }).id;
  assert.equal(
    (await team()).invoices.some((invoice) => invoice.id === draftId),
    false,
  );
  const refused = await post(
    `/api/v1/jobs/${jobId}/invoices/${draftId}/accept`,
    TEST_UNASSIGNED_TOKEN,
    { signatoryName: "Kojo" },
  );
  assert.equal(refused.status, 409);
  const hidden = await post(
    `/api/v1/jobs/${jobId}/invoices/${draftId}/accept`,
    TEST_CUSTOMER_A_TOKEN,
    { signatoryName: "Kojo" },
  );
  assert.equal(hidden.status, 404);
});
