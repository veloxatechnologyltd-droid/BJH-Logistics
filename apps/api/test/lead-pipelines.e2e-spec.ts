import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { after, before, test } from "node:test";
import {
  TEST_CUSTOMER_A_TOKEN,
  TEST_SUPER_ADMIN_ID,
  TEST_SUPER_ADMIN_TOKEN,
  createTestApplication,
} from "./test-application";
import { DatabasePort } from "../src/database/database.port";
import { beginTestDatabase, endTestDatabase } from "./postgres-test-database";

let application: INestApplication;
let baseUrl: string;
let database: DatabasePort;
const company = randomUUID();

const call = (
  path: string,
  init: RequestInit = {},
  token = TEST_SUPER_ADMIN_TOKEN,
) => {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  if (init.body) headers.set("content-type", "application/json");
  return fetch(`${baseUrl}${path}`, { ...init, headers });
};
const send = (method: string, path: string, body: unknown = {}) =>
  call(path, { method, body: JSON.stringify(body) });

type Lead = { id: string; stage: string; source: string; companyName: string };
type Summary = {
  thisMonth: { newLeads: number; converted: number };
  openLeads: number;
};

/** A lead found by a campaign, as promoting a prospect makes it. */
async function generatedLead(
  name: string,
  stage: "new" | "interested" = "new",
) {
  const created = await database.createLead({
    id: randomUUID(),
    companyName: name,
    contactName: null,
    email: null,
    phone: null,
    source: "campaign",
    stage: "new",
    ownerId: TEST_SUPER_ADMIN_ID,
    nextFollowUp: null,
    notes: null,
    lostReason: null,
    quoteRequestId: null,
    customerCompanyId: null,
    createdBy: TEST_SUPER_ADMIN_ID,
  });
  assert.ok(typeof created !== "string");
  if (stage !== "new") {
    assert.ok(await database.saveLead({ ...created, stage }));
  }
  return created;
}

const manualLead = async (name: string) => {
  const response = await send("POST", "/api/v1/leads", {
    companyName: name,
    source: "referral",
  });
  assert.equal(response.status, 201, await response.clone().text());
  return (await response.json()) as Lead;
};

const list = async (pipeline?: string) =>
  (await (
    await call(`/api/v1/leads${pipeline ? `?pipeline=${pipeline}` : ""}`)
  ).json()) as Lead[];

before(async () => {
  await beginTestDatabase();
  const started = await createTestApplication();
  application = started.application;
  baseUrl = started.baseUrl;
  database = application.get(DatabasePort);
  await database.createCustomer({
    id: company,
    companyName: "Pipeline Synthetic Ltd",
    createdAt: new Date().toISOString(),
    contacts: [],
  });
});

after(async () => {
  await application?.close();
  await endTestDatabase();
});

test("generated and manual leads are listed apart, and never together under a pipeline", async () => {
  const manual = await manualLead("Hand Added Synthetic Ltd");
  const generated = await generatedLead("Campaign Found Synthetic Ltd");

  const manualList = await list("manual");
  assert.ok(manualList.some((lead) => lead.id === manual.id));
  assert.ok(!manualList.some((lead) => lead.id === generated.id));
  assert.ok(manualList.every((lead) => lead.source !== "campaign"));

  const generatedList = await list("generated");
  assert.ok(generatedList.some((lead) => lead.id === generated.id));
  assert.ok(!generatedList.some((lead) => lead.id === manual.id));
  assert.ok(generatedList.every((lead) => lead.source === "campaign"));

  // With no pipeline named, every lead is returned (reports, quote pickers).
  const all = await list();
  assert.ok(all.some((lead) => lead.id === manual.id));
  assert.ok(all.some((lead) => lead.id === generated.id));

  const bad = await call("/api/v1/leads?pipeline=warm");
  assert.equal(bad.status, 400);
  assert.equal((await call("/api/v1/leads/summary?pipeline=warm")).status, 400);
});

test("a customer cannot read either pipeline", async () => {
  for (const pipeline of ["manual", "generated"]) {
    const response = await call(
      `/api/v1/leads?pipeline=${pipeline}`,
      {},
      TEST_CUSTOMER_A_TOKEN,
    );
    assert.equal(response.status, 403);
  }
});

test("a generated lead can be replied and interested; a manual lead cannot", async () => {
  const generated = await generatedLead("Engaged Synthetic Ltd");
  for (const stage of ["contacted", "replied", "interested", "quoted"]) {
    const moved = await send("PATCH", `/api/v1/leads/${generated.id}`, {
      stage,
    });
    assert.equal(moved.status, 200, `${stage}: ${await moved.clone().text()}`);
    assert.equal(((await moved.json()) as Lead).stage, stage);
  }

  const manual = await manualLead("Plain Manual Synthetic Ltd");
  for (const stage of ["replied", "interested"]) {
    const refused = await send("PATCH", `/api/v1/leads/${manual.id}`, {
      stage,
    });
    assert.equal(refused.status, 400, stage);
    assert.match(await refused.text(), /manual lead cannot be moved/);
  }
  const moved = await send("PATCH", `/api/v1/leads/${manual.id}`, {
    stage: "contacted",
  });
  assert.equal(moved.status, 200);

  // The database refuses it too, whatever the API does.
  await assert.rejects(
    database.saveLead({
      ...(await database.findLead(manual.id))!,
      stage: "replied",
    }),
  );
});

test("a lead cannot be switched from one pipeline to the other", async () => {
  const manual = await manualLead("Stays Manual Synthetic Ltd");
  const byHand = await send("POST", "/api/v1/leads", {
    companyName: "Pretend Campaign Ltd",
    source: "campaign",
  });
  assert.equal(byHand.status, 400);

  await send("PATCH", `/api/v1/leads/${manual.id}`, { source: "campaign" });
  assert.ok(
    (await list("manual")).some((lead) => lead.id === manual.id),
    "still manual after trying to change the source",
  );
  assert.ok(!(await list("generated")).some((lead) => lead.id === manual.id));
});

test("the summary counts one pipeline at a time", async () => {
  const summary = async (pipeline: string) =>
    (await (
      await call(`/api/v1/leads/summary?pipeline=${pipeline}`)
    ).json()) as Summary;
  const before = {
    manual: await summary("manual"),
    generated: await summary("generated"),
  };

  await manualLead("Counted Manual Synthetic Ltd");
  await generatedLead("Counted Generated One Ltd");
  await generatedLead("Counted Generated Two Ltd", "interested");

  const after = {
    manual: await summary("manual"),
    generated: await summary("generated"),
  };
  assert.equal(after.manual.openLeads, before.manual.openLeads + 1);
  assert.equal(after.generated.openLeads, before.generated.openLeads + 2);
  assert.equal(
    after.manual.thisMonth.newLeads,
    before.manual.thisMonth.newLeads + 1,
  );
  assert.equal(
    after.generated.thisMonth.newLeads,
    before.generated.thisMonth.newLeads + 2,
  );
});

test("a quote moves an interested generated lead to quoted, and a win closes it", async () => {
  const lead = await generatedLead("Quote Moves Synthetic Ltd", "interested");
  assert.ok(
    await database.saveLead({
      ...lead,
      stage: "interested",
      customerCompanyId: company,
    }),
  );

  assert.ok((await database.markLeadsQuoted(company)) >= 1);
  assert.equal((await database.findLead(lead.id))!.stage, "quoted");

  const second = await generatedLead("Win Closes Synthetic Ltd", "interested");
  assert.ok(
    await database.saveLead({
      ...second,
      stage: "interested",
      customerCompanyId: company,
    }),
  );
  assert.ok((await database.winLeadsForAcceptedQuote(company, null)) >= 1);
  assert.equal((await database.findLead(second.id))!.stage, "won");
});

test("the Sales overview shows the two pipelines side by side", async () => {
  const manual = await manualLead("Overview Manual Synthetic Ltd");
  await generatedLead("Overview Generated Synthetic Ltd");
  const response = await call("/api/v1/sales/overview");
  assert.equal(response.status, 200);
  const overview = (await response.json()) as {
    pipelines: Record<
      "manual" | "generated",
      { total: number; open: number; byStage: Record<string, number> }
    >;
    followUps: Array<{ leadId: string }>;
    recentActivity: Array<{ leadId: string }>;
  };
  assert.ok(overview.pipelines.manual.total >= 1);
  assert.ok(overview.pipelines.generated.total >= 1);
  assert.ok(overview.pipelines.manual.byStage.new >= 1);
  assert.equal(overview.pipelines.manual.byStage.replied, undefined);
  // The hub's follow-up list and activity are for generated leads only.
  assert.ok(!overview.followUps.some((row) => row.leadId === manual.id));
  assert.ok(!overview.recentActivity.some((row) => row.leadId === manual.id));
});
