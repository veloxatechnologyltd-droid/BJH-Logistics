import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { after, before, test } from "node:test";
import {
  TEST_CUSTOMER_A_ID,
  TEST_CUSTOMER_A_TOKEN,
  TEST_MATCHING_USER_ID,
  TEST_SUPER_ADMIN_ID,
  TEST_SUPER_ADMIN_TOKEN,
  TEST_UNASSIGNED_TOKEN,
  TEST_UNASSIGNED_USER_ID,
  createTestApplication,
} from "./test-application";
import { staffDisplayName } from "../src/auth/staff-admin.port";
import { DatabasePort } from "../src/database/database.port";
import { beginTestDatabase, endTestDatabase } from "./postgres-test-database";

let application: INestApplication;
let baseUrl: string;
let companyId: string;
let leadId: string;

type Lead = { id: string; stage: string; ownerId: string | null };
type Summary = {
  thisWeek: {
    newLeads: number;
    converted: number;
    convertedCompanies: string[];
  };
  thisMonth: { newLeads: number; converted: number };
  openLeads: number;
  followUpsDue: number;
};

function call(path: string, token: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  if (init.body) headers.set("content-type", "application/json");
  return fetch(`${baseUrl}${path}`, { ...init, headers });
}
const send = (
  method: string,
  path: string,
  token: string,
  body: unknown = {},
) => call(path, token, { method, body: JSON.stringify(body) });
const summary = async () =>
  (await (
    await call("/api/v1/leads/summary", TEST_UNASSIGNED_TOKEN)
  ).json()) as Summary;

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
    "sales_rep",
    TEST_SUPER_ADMIN_ID,
  );
  companyId = randomUUID();
  await database.createCustomer({
    id: companyId,
    companyName: "Prospect Synthetic Ltd",
    createdAt: new Date().toISOString(),
    contacts: [],
  });
  await database.grantCustomerMembership(
    companyId,
    TEST_CUSTOMER_A_ID,
    TEST_SUPER_ADMIN_ID,
  );
  await send("PUT", "/api/v1/settings", TEST_SUPER_ADMIN_TOKEN, {
    issuer: { name: "Synthetic Forwarding Ltd", address: "1 Test Road" },
    currencies: ["USD"],
    taxLines: [],
    paymentTermsDays: 30,
    numbering: {
      quotePrefix: "SYN/Q",
      invoicePrefix: "SYN/INV",
      receiptPrefix: "SYN/RCT",
    },
    quoteDefaults: {},
  });
});

after(async () => {
  await application?.close();
  await endTestDatabase();
});

test("sales logs a lead and its follow-ups, newest first", async () => {
  const today = new Date().toISOString().slice(0, 10);
  const created = await send("POST", "/api/v1/leads", TEST_UNASSIGNED_TOKEN, {
    companyName: "Prospect Synthetic Ltd",
    source: "walk_in",
    nextFollowUp: today,
  });
  assert.equal(created.status, 201, await created.clone().text());
  leadId = ((await created.json()) as Lead).id;

  for (const [kind, note] of [
    ["call", "Spoke to the logistics manager"],
    ["visit", "Visited their warehouse in Tema"],
  ]) {
    const added = await send(
      "POST",
      `/api/v1/leads/${leadId}/activities`,
      TEST_UNASSIGNED_TOKEN,
      { kind, note },
    );
    assert.equal(added.status, 201);
  }
  const activities = (await (
    await call(`/api/v1/leads/${leadId}/activities`, TEST_UNASSIGNED_TOKEN)
  ).json()) as Array<{ kind: string; createdByName: string }>;
  assert.deepEqual(
    activities.map((item) => item.kind),
    ["visit", "call"],
  );
  assert.equal(
    activities[0].createdByName,
    staffDisplayName({ email: `${TEST_UNASSIGNED_USER_ID}@example.test` }),
  );

  const bad = await send(
    "POST",
    `/api/v1/leads/${leadId}/activities`,
    TEST_UNASSIGNED_TOKEN,
    { kind: "fax", note: "x" },
  );
  assert.equal(bad.status, 400);
});

test("a lead can be handed to another sales rep, never to a customer", async () => {
  const handed = await send(
    "PATCH",
    `/api/v1/leads/${leadId}`,
    TEST_UNASSIGNED_TOKEN,
    {
      owner: TEST_MATCHING_USER_ID,
    },
  );
  assert.equal(handed.status, 200);
  assert.equal(((await handed.json()) as Lead).ownerId, TEST_MATCHING_USER_ID);

  const customer = await send(
    "PATCH",
    `/api/v1/leads/${leadId}`,
    TEST_UNASSIGNED_TOKEN,
    {
      owner: TEST_CUSTOMER_A_ID,
    },
  );
  assert.equal(customer.status, 400);
});

test("the summary counts this week's leads and follow-ups due", async () => {
  const figures = await summary();
  assert.equal(figures.thisWeek.newLeads, 1);
  assert.equal(figures.thisMonth.newLeads, 1);
  assert.equal(figures.thisWeek.converted, 0);
  assert.equal(figures.openLeads, 1);
  assert.equal(figures.followUpsDue, 1);
});

test("accepting the client's first quote converts them and wins the lead", async () => {
  await send("PATCH", `/api/v1/leads/${leadId}`, TEST_UNASSIGNED_TOKEN, {
    customerCompanyId: companyId,
  });
  const quote = await send("POST", "/api/v1/quotes", TEST_UNASSIGNED_TOKEN, {
    customerCompanyId: companyId,
    serviceLine: "sea_import",
    version: {
      currency: "USD",
      title: "Synthetic clearance quotation",
      sizeLabels: [],
      lines: [{ description: "Clearance", basis: "fixed", amountMinor: 50000 }],
    },
  });
  assert.equal(quote.status, 201, await quote.clone().text());
  const quoteId = ((await quote.json()) as { id: string }).id;
  assert.equal(
    (
      await send(
        "POST",
        `/api/v1/quotes/${quoteId}/issue`,
        TEST_UNASSIGNED_TOKEN,
      )
    ).status,
    201,
  );
  const accepted = await send(
    "POST",
    `/api/v1/quotes/${quoteId}/respond`,
    TEST_CUSTOMER_A_TOKEN,
    {
      versionNumber: 1,
      decision: "accepted",
      clientSignatory: "Kojo Synthetic",
    },
  );
  assert.equal(accepted.status, 201, await accepted.clone().text());

  const leads = (await (
    await call("/api/v1/leads", TEST_UNASSIGNED_TOKEN)
  ).json()) as Lead[];
  assert.equal(leads.find((lead) => lead.id === leadId)?.stage, "won");

  const figures = await summary();
  assert.equal(figures.thisWeek.converted, 1);
  assert.deepEqual(figures.thisWeek.convertedCompanies, [
    "Prospect Synthetic Ltd",
  ]);
  assert.equal(figures.openLeads, 0);
});

test("reports show the sales and customer service picture for the period", async () => {
  const today = new Date().toISOString().slice(0, 10);
  const report = (await (
    await call(
      `/api/v1/reports?from=${today}&to=${today}`,
      TEST_UNASSIGNED_TOKEN,
    )
  ).json()) as {
    sales: {
      newLeads: number;
      leadsBySource: Record<string, number>;
      pipeline: Record<string, number>;
      converted: number;
    };
    service: { quotesIssued: number; quotesAccepted: number };
  };
  assert.equal(report.sales.newLeads, 1);
  assert.deepEqual(report.sales.leadsBySource, { walk_in: 1 });
  assert.equal(report.sales.pipeline.won, 1);
  assert.equal(report.sales.converted, 1);
  assert.equal(report.service.quotesIssued, 1);
  assert.equal(report.service.quotesAccepted, 1);
});

test("a quote can be prepared for a lead: it becomes a customer, then quoted on issue", async () => {
  const create = (body: unknown) =>
    send("POST", "/api/v1/leads", TEST_UNASSIGNED_TOKEN, body);
  const noEmail = (await (
    await create({ companyName: "No Email Synthetic Ltd" })
  ).json()) as Lead;
  assert.equal(
    (
      await send(
        "POST",
        `/api/v1/leads/${noEmail.id}/customer`,
        TEST_UNASSIGNED_TOKEN,
      )
    ).status,
    400,
  );

  const lead = (await (
    await create({
      companyName: "Lead Quote Synthetic Ltd",
      contactName: "Lena Lead",
      email: "lena@leadquote.test",
    })
  ).json()) as Lead;
  // Customers cannot turn leads into customers.
  assert.equal(
    (
      await send(
        "POST",
        `/api/v1/leads/${lead.id}/customer`,
        TEST_CUSTOMER_A_TOKEN,
      )
    ).status,
    403,
  );
  const converted = await send(
    "POST",
    `/api/v1/leads/${lead.id}/customer`,
    TEST_UNASSIGNED_TOKEN,
  );
  assert.equal(converted.status, 201, await converted.clone().text());
  const { customerCompanyId } = (await converted.json()) as {
    customerCompanyId: string;
  };
  // Asking again gives the same company, not a second one.
  const again = (await (
    await send(
      "POST",
      `/api/v1/leads/${lead.id}/customer`,
      TEST_UNASSIGNED_TOKEN,
    )
  ).json()) as { customerCompanyId: string };
  assert.equal(again.customerCompanyId, customerCompanyId);

  const customer = (await (
    await call(`/api/v1/customers/${customerCompanyId}`, TEST_SUPER_ADMIN_TOKEN)
  ).json()) as {
    companyName: string;
    contacts: { name: string; email: string; notify: boolean }[];
  };
  assert.equal(customer.companyName, "Lead Quote Synthetic Ltd");
  assert.equal(customer.contacts[0]?.email, "lena@leadquote.test");
  assert.equal(customer.contacts[0]?.notify, true);

  const quote = await send("POST", "/api/v1/quotes", TEST_UNASSIGNED_TOKEN, {
    customerCompanyId,
    serviceLine: "sea_import",
    version: {
      currency: "USD",
      title: "Synthetic lead quotation",
      sizeLabels: [],
      lines: [{ description: "Clearance", basis: "fixed", amountMinor: 50000 }],
    },
  });
  assert.equal(quote.status, 201, await quote.clone().text());
  const quoteId = ((await quote.json()) as { id: string }).id;
  const leadNow = async () =>
    (
      (await (
        await call("/api/v1/leads", TEST_UNASSIGNED_TOKEN)
      ).json()) as Lead[]
    ).find((row) => row.id === lead.id)?.stage;
  assert.equal(await leadNow(), "new");
  assert.equal(
    (
      await send(
        "POST",
        `/api/v1/quotes/${quoteId}/issue`,
        TEST_UNASSIGNED_TOKEN,
      )
    ).status,
    201,
  );
  assert.equal(await leadNow(), "quoted");
});
