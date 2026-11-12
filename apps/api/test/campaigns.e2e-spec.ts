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
import { POSTGRES_POOL } from "../src/database/postgres-database.service";
import type { PostgresPool } from "../src/database/postgres-database.service";
import { BUSINESS_SEARCH_PROVIDER } from "../src/leads/business-search";
import { StubBusinessSearchProvider } from "../src/leads/business-search";
import { ReportPdfService } from "../src/reports/report-pdf.service";
import type { ReportBlock } from "../src/reports/report-pdf";
import { LeadRunPipeline } from "../src/leads/lead-run-pipeline.service";
import { RulesProspectScorer } from "../src/leads/prospect-scoring";
import { StubWebsiteContactFinder } from "../src/leads/website-contacts";
import { beginTestDatabase, endTestDatabase } from "./postgres-test-database";

/** Everything is synthetic: the search is the stub, no website is read, no AI is called. */
let application: INestApplication;
let baseUrl: string;
let database: DatabasePort;
let pool: PostgresPool;

type Campaign = {
  id: string;
  name: string;
  status: string;
  searchKeywords: string[];
  excludedKeywords: string[];
  minRating: number | null;
  requireWebsite: boolean;
  idealCustomerProfile: string | null;
  qualificationThreshold: number;
  maxProspects: number;
  prospectCount: number;
  promotedCount: number;
  latestRun: Run | null;
};
type Run = {
  id: string;
  status: string;
  step: string;
  targetCount: number;
  storedCount: number;
  duplicateCount: number;
};
type Prospect = {
  id: string;
  businessName: string;
  source: string;
  score: number | null;
  scoreMethod: string | null;
  duplicateKind: string | null;
  enrichmentStatus: string;
  promotedLeadId: string | null;
  emails: string[];
};
type Page = { items: Prospect[]; total: number; limit: number; offset: number };

function call(path: string, token: string | null, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (token) headers.set("authorization", `Bearer ${token}`);
  if (init.body) headers.set("content-type", "application/json");
  return fetch(`${baseUrl}${path}`, { ...init, headers });
}
const send = (
  method: string,
  path: string,
  token: string | null,
  body: unknown = {},
) =>
  call(path, token, {
    method,
    // A GET carries no body.
    ...(method === "GET" ? {} : { body: JSON.stringify(body) }),
  });
const admin = TEST_SUPER_ADMIN_TOKEN;

const validCampaign = {
  name: "Synthetic importers in Accra",
  targetService: "Sea freight import",
  targetIndustry: "Import company",
  targetLocation: "Accra, Ghana",
};

async function newCampaign(extra: Record<string, unknown> = {}) {
  const response = await send("POST", "/api/v1/campaigns", admin, {
    ...validCampaign,
    ...extra,
  });
  assert.equal(response.status, 201);
  return (await response.json()) as Campaign;
}

function pipeline() {
  return new LeadRunPipeline(
    database,
    new StubBusinessSearchProvider(),
    new StubWebsiteContactFinder(),
    new RulesProspectScorer(),
  );
}

async function runToEnd(pipe: LeadRunPipeline, campaignId: string) {
  for (let tick = 0; tick < 80; tick++) {
    const row = (
      await pool.query(
        `SELECT status FROM app.lead_campaign_run WHERE campaign_id = $1::uuid
         ORDER BY created_at DESC LIMIT 1`,
        [campaignId],
      )
    ).rows[0];
    if (!row || ["ready", "failed", "cancelled"].includes(String(row.status)))
      return;
    await pool.query(
      `UPDATE app.lead_campaign_run SET next_attempt_at = clock_timestamp() - interval '1 second'
       WHERE campaign_id = $1::uuid AND status IN ('queued', 'running')`,
      [campaignId],
    );
    await pipe.advance();
  }
}

async function prospects(campaignId: string, query = "") {
  const response = await call(
    `/api/v1/campaigns/${campaignId}/prospects${query}`,
    admin,
  );
  assert.equal(response.status, 200);
  return (await response.json()) as Page;
}

before(async () => {
  await beginTestDatabase();
  const started = await createTestApplication();
  application = started.application;
  baseUrl = started.baseUrl;
  database = application.get(DatabasePort);
  pool = application.get(POSTGRES_POOL);
  // Two of the allowed roles; the third is the super admin. The matching user
  // starts with two roles that are not allowed and gains customer service later.
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
  await database.assignStaffRole(
    TEST_MATCHING_USER_ID,
    "finance_rep",
    TEST_SUPER_ADMIN_ID,
  );
});

after(async () => {
  await application?.close();
  await endTestDatabase();
});

test("customers, other staff roles and anonymous callers are refused on every campaign route", async () => {
  const id = randomUUID();
  const routes: Array<[string, string, unknown?]> = [
    ["GET", "/api/v1/campaigns"],
    ["GET", "/api/v1/campaigns/config"],
    ["POST", "/api/v1/campaigns", validCampaign],
    ["GET", `/api/v1/campaigns/${id}`],
    ["PATCH", `/api/v1/campaigns/${id}`, { name: "x" }],
    ["DELETE", `/api/v1/campaigns/${id}`],
    ["GET", `/api/v1/campaigns/${id}/runs`],
    ["POST", `/api/v1/campaigns/${id}/runs`],
    ["GET", `/api/v1/campaigns/${id}/runs/${id}`],
    ["POST", `/api/v1/campaigns/${id}/runs/${id}/cancel`],
    ["GET", `/api/v1/campaigns/${id}/prospects`],
    [
      "POST",
      `/api/v1/campaigns/${id}/prospects/promote`,
      { prospectIds: [id] },
    ],
  ];
  for (const [method, path, body] of routes) {
    for (const [who, token, status] of [
      ["a customer", TEST_CUSTOMER_A_TOKEN, 403],
      ["an import rep who is also finance", TEST_MATCHING_TOKEN, 403],
      ["no sign-in", null, 401],
    ] as const) {
      const response = await send(method, path, token, body);
      assert.equal(response.status, status, `${who}: ${method} ${path}`);
    }
  }
  // Nothing was created or changed by the refused calls.
  assert.equal(
    (await pool.query("SELECT count(*) AS n FROM app.lead_campaign")).rows[0].n,
    "0",
  );
});

test("sales, customer service and the super admin may use campaigns", async () => {
  await database.assignStaffRole(
    TEST_MATCHING_USER_ID,
    "customer_service_rep",
    TEST_SUPER_ADMIN_ID,
  );
  for (const token of [admin, TEST_UNASSIGNED_TOKEN, TEST_MATCHING_TOKEN]) {
    assert.equal((await call("/api/v1/campaigns", token)).status, 200);
    assert.equal((await call("/api/v1/campaigns/config", token)).status, 200);
  }
  // A customer account that is also a member of a company is still refused.
  assert.equal(
    (await call("/api/v1/campaigns", TEST_CUSTOMER_A_TOKEN)).status,
    403,
  );
  void TEST_CUSTOMER_A_ID;
});

test("the config says whether the search is sample data and what scores", async () => {
  const config = (await (
    await call("/api/v1/campaigns/config", admin)
  ).json()) as { searchProvider: string; sampleData: boolean; scorer: string };
  const provider = application.get(BUSINESS_SEARCH_PROVIDER);
  assert.equal(config.searchProvider, provider.name);
  assert.equal(config.sampleData, provider.name === "stub");
  assert.ok(["claude", "rules"].includes(config.scorer));
});

test("a campaign is created with its settings, tidy lists and the usual defaults", async () => {
  const created = await newCampaign({
    searchKeywords: [" importers ", "importers", "food importers"],
    excludedKeywords: ["bank"],
    minRating: 3.5,
    idealCustomerProfile: "  Regular importers shipping full containers ",
  });
  assert.equal(created.status, "active");
  assert.deepEqual(created.searchKeywords, ["importers", "food importers"]);
  assert.deepEqual(created.excludedKeywords, ["bank"]);
  assert.equal(created.minRating, 3.5);
  assert.equal(created.requireWebsite, false);
  assert.equal(created.qualificationThreshold, 50);
  assert.equal(created.maxProspects, 50);
  assert.equal(
    created.idealCustomerProfile,
    "Regular importers shipping full containers",
  );
  assert.equal(created.prospectCount, 0);
  assert.equal(created.latestRun, null);

  const read = (await (
    await call(`/api/v1/campaigns/${created.id}`, admin)
  ).json()) as Campaign;
  assert.equal(read.id, created.id);
  const listed = (await (
    await call("/api/v1/campaigns", TEST_UNASSIGNED_TOKEN)
  ).json()) as Campaign[];
  assert.ok(listed.some((campaign) => campaign.id === created.id));
});

test("bad campaign input is refused with the reason", async () => {
  const bad: Array<[Record<string, unknown>, RegExp]> = [
    [{ name: "" }, /name must contain/],
    [{ targetLocation: undefined }, /targetLocation is required/],
    [{ minRating: 6 }, /minRating/],
    [{ minRating: 3.55 }, /one decimal/],
    [{ qualificationThreshold: 101 }, /qualificationThreshold/],
    [{ qualificationThreshold: 50.5 }, /qualificationThreshold/],
    [{ maxProspects: 0 }, /maxProspects/],
    [{ maxProspects: 501 }, /maxProspects/],
    [{ searchKeywords: "importers" }, /searchKeywords/],
    [
      { searchKeywords: Array.from({ length: 21 }, (_, n) => `k${n}`) },
      /at most 20/,
    ],
    [{ requireWebsite: "yes" }, /requireWebsite/],
    [{ idealCustomerProfile: "x".repeat(2001) }, /at most 2000/],
  ];
  for (const [change, message] of bad) {
    const response = await send("POST", "/api/v1/campaigns", admin, {
      ...validCampaign,
      ...change,
    });
    assert.equal(response.status, 400, JSON.stringify(change));
    assert.match(
      ((await response.json()) as { message: string }).message,
      message,
    );
  }
  assert.equal(
    (await send("POST", "/api/v1/campaigns", admin, null)).status,
    400,
  );
});

test("a campaign can be changed, paused and resumed, and unknown ones are not found", async () => {
  const campaign = await newCampaign();
  const patch = (body: unknown) =>
    send("PATCH", `/api/v1/campaigns/${campaign.id}`, admin, body);

  const renamed = (await (
    await patch({
      name: "Renamed",
      qualificationThreshold: 70,
      minRating: null,
    })
  ).json()) as Campaign;
  assert.equal(renamed.name, "Renamed");
  assert.equal(renamed.qualificationThreshold, 70);
  assert.equal(renamed.maxProspects, 50);
  assert.equal(
    ((await (await patch({ status: "paused" })).json()) as Campaign).status,
    "paused",
  );
  assert.equal(
    ((await (await patch({ status: "active" })).json()) as Campaign).status,
    "active",
  );

  assert.equal((await patch({})).status, 400);
  assert.equal((await patch({ status: "deleted" })).status, 400);
  assert.equal((await patch({ maxProspects: 9999 })).status, 400);
  for (const id of [randomUUID(), "not-an-id"]) {
    assert.equal(
      (await send("PATCH", `/api/v1/campaigns/${id}`, admin, { name: "x" }))
        .status,
      404,
    );
    assert.equal((await call(`/api/v1/campaigns/${id}`, admin)).status, 404);
  }
});

test("a search is started once at a time, only for an active campaign, and can be cancelled", async () => {
  const campaign = await newCampaign({ maxProspects: 7 });
  const base = `/api/v1/campaigns/${campaign.id}/runs`;

  const started = await send("POST", base, TEST_UNASSIGNED_TOKEN);
  assert.equal(started.status, 201);
  const run = (await started.json()) as Run;
  assert.equal(run.status, "queued");
  assert.equal(run.targetCount, 7);

  // A second search while one is waiting is refused, and the first is untouched.
  assert.equal((await send("POST", base, admin)).status, 409);
  assert.equal(
    ((await (await call(`${base}/${run.id}`, admin)).json()) as Run).status,
    "queued",
  );

  const cancelled = await send("POST", `${base}/${run.id}/cancel`, admin);
  assert.equal(cancelled.status, 200);
  assert.equal(((await cancelled.json()) as Run).status, "cancelled");
  assert.equal(
    (await send("POST", `${base}/${run.id}/cancel`, admin)).status,
    409,
  );
  assert.equal(
    (await send("POST", `${base}/${randomUUID()}/cancel`, admin)).status,
    404,
  );
  // A run of another campaign is not reachable through this one.
  const other = await newCampaign();
  assert.equal(
    (
      await send(
        "POST",
        `/api/v1/campaigns/${other.id}/runs/${run.id}/cancel`,
        admin,
      )
    ).status,
    404,
  );

  // Cancelled, so a new search may start; a paused campaign may not search.
  assert.equal((await send("POST", base, admin)).status, 201);
  const history = (await (await call(base, admin)).json()) as Run[];
  assert.equal(history.length, 2);
  assert.equal(history[0].status, "queued");
  assert.equal(history[1].status, "cancelled");

  await send("PATCH", `/api/v1/campaigns/${other.id}`, admin, {
    status: "paused",
  });
  assert.equal(
    (await send("POST", `/api/v1/campaigns/${other.id}/runs`, admin)).status,
    409,
  );
  assert.equal(
    (await send("POST", `/api/v1/campaigns/${randomUUID()}/runs`, admin))
      .status,
    404,
  );
});

test("archiving a campaign cancels its waiting search", async () => {
  const campaign = await newCampaign();
  await send("POST", `/api/v1/campaigns/${campaign.id}/runs`, admin);
  await send("PATCH", `/api/v1/campaigns/${campaign.id}`, admin, {
    status: "archived",
  });
  const read = (await (
    await call(`/api/v1/campaigns/${campaign.id}`, admin)
  ).json()) as Campaign;
  assert.equal(read.status, "archived");
  assert.equal(read.latestRun?.status, "cancelled");
});

test("a paused campaign's search waits, and carries on when it is resumed", async () => {
  // Other tests leave searches waiting on active campaigns; this one looks at its own.
  await pool.query("DELETE FROM app.lead_campaign_run");
  const campaign = await newCampaign({ maxProspects: 3 });
  const pipe = pipeline();
  await send("POST", `/api/v1/campaigns/${campaign.id}/runs`, admin);
  await send("PATCH", `/api/v1/campaigns/${campaign.id}`, admin, {
    status: "paused",
  });
  assert.equal(await pipe.advance(), false);
  assert.equal(
    (
      (await (
        await call(`/api/v1/campaigns/${campaign.id}`, admin)
      ).json()) as Campaign
    ).latestRun?.status,
    "queued",
  );

  await send("PATCH", `/api/v1/campaigns/${campaign.id}`, admin, {
    status: "active",
  });
  await runToEnd(pipe, campaign.id);
  const done = (await (
    await call(`/api/v1/campaigns/${campaign.id}`, admin)
  ).json()) as Campaign;
  assert.equal(done.latestRun?.status, "ready");
  assert.equal(done.prospectCount, 3);
});

test("prospects are listed best first, with sample data and rules scores marked, and can be filtered", async () => {
  await database.createCustomer({
    id: randomUUID(),
    companyName: "Known Customer Ltd",
    tradingName: null,
    website: "https://www.synthetic-business-2.example",
    phone: null,
    companyEmail: null,
    createdAt: new Date().toISOString(),
    contacts: [],
  });
  const campaign = await newCampaign({
    maxProspects: 6,
    qualificationThreshold: 60,
  });
  await send("POST", `/api/v1/campaigns/${campaign.id}/runs`, admin);
  await runToEnd(pipeline(), campaign.id);

  const all = await prospects(campaign.id);
  assert.equal(all.total, 6);
  assert.equal(all.items.length, 6);
  assert.equal(all.limit, 50);
  assert.ok(all.items.every((item) => item.source === "stub"));
  assert.ok(all.items.every((item) => item.scoreMethod === "rules"));
  const scores = all.items.map((item) => item.score!);
  assert.deepEqual(
    scores,
    [...scores].sort((a, b) => b - a),
  );

  // The one that matches a customer's website is flagged, not dropped.
  const flagged = await prospects(campaign.id, "?duplicate=true");
  assert.equal(flagged.total, 1);
  assert.equal(flagged.items[0].duplicateKind, "customer");
  assert.equal((await prospects(campaign.id, "?duplicate=false")).total, 5);

  // Qualified means at or above the campaign's threshold, a score exactly on it included.
  const threshold = scores[2];
  await send("PATCH", `/api/v1/campaigns/${campaign.id}`, admin, {
    qualificationThreshold: threshold,
  });
  const qualified = await prospects(campaign.id, "?qualified=true");
  const unqualified = await prospects(campaign.id, "?qualified=false");
  assert.equal(
    qualified.total,
    scores.filter((score) => score >= threshold).length,
  );
  assert.equal(
    unqualified.total,
    scores.filter((score) => score < threshold).length,
  );
  assert.ok(qualified.items.some((item) => item.score === threshold));
  assert.ok(qualified.items.every((item) => item.score! >= threshold));
  assert.ok(unqualified.items.every((item) => item.score! < threshold));
  const best = Math.max(...scores);
  assert.ok(
    (await prospects(campaign.id, `?minScore=${best}`)).items.every(
      (item) => item.score === best,
    ),
  );

  assert.equal(
    (await prospects(campaign.id, "?enrichment=email_missing")).total,
    1,
  );
  assert.equal((await prospects(campaign.id, "?search=business%203")).total, 1);
  assert.equal((await prospects(campaign.id, "?search=%25")).total, 0);
  assert.equal((await prospects(campaign.id, "?promoted=true")).total, 0);

  const paged = await prospects(campaign.id, "?limit=2&offset=4");
  assert.equal(paged.total, 6);
  assert.equal(paged.items.length, 2);
  assert.equal(paged.offset, 4);

  const campaignRow = (await (
    await call(`/api/v1/campaigns/${campaign.id}`, admin)
  ).json()) as Campaign;
  assert.equal(campaignRow.prospectCount, 6);
  assert.equal(campaignRow.latestRun?.status, "ready");
  assert.equal(campaignRow.latestRun?.duplicateCount, 1);

  for (const query of [
    "?qualified=maybe",
    "?minScore=101",
    "?limit=0",
    "?limit=201",
    "?offset=-1",
    "?enrichment=nope",
    "?runId=nope",
    "?search=" + "x".repeat(101),
  ]) {
    assert.equal(
      (await call(`/api/v1/campaigns/${campaign.id}/prospects${query}`, admin))
        .status,
      400,
      query,
    );
  }
  assert.equal(
    (await call(`/api/v1/campaigns/${randomUUID()}/prospects`, admin)).status,
    404,
  );
});

test("chosen prospects become leads once, with an activity, and repeating changes nothing", async () => {
  const campaign = await newCampaign({ maxProspects: 4 });
  await send("POST", `/api/v1/campaigns/${campaign.id}/runs`, admin);
  await runToEnd(pipeline(), campaign.id);
  const [first, second, third] = (await prospects(campaign.id)).items;
  const leadsBefore = (await pool.query("SELECT count(*) AS n FROM app.lead"))
    .rows[0].n;

  const promote = (ids: string[], token = TEST_UNASSIGNED_TOKEN) =>
    send("POST", `/api/v1/campaigns/${campaign.id}/prospects/promote`, token, {
      prospectIds: ids,
    });
  const result = (await (await promote([first.id, second.id])).json()) as {
    promoted: number;
    alreadyPromoted: number;
    notFound: number;
    results: Array<{
      prospectId: string;
      outcome: string;
      leadId: string | null;
    }>;
  };
  assert.equal(result.promoted, 2);
  assert.equal(result.alreadyPromoted, 0);
  assert.ok(result.results.every((entry) => entry.leadId));

  // The lead: source campaign, new, owned by the person who added it, details carried over.
  const lead = (
    await pool.query(`SELECT * FROM app.lead WHERE lead_id = $1::uuid`, [
      result.results[0].leadId,
    ])
  ).rows[0];
  assert.equal(lead.source, "campaign");
  assert.equal(lead.stage, "new");
  assert.equal(lead.campaign_id, campaign.id);
  assert.equal(lead.owner_id, TEST_UNASSIGNED_USER_ID);
  assert.equal(lead.created_by, TEST_UNASSIGNED_USER_ID);
  assert.equal(lead.company_name, first.businessName);
  assert.equal(lead.email, first.emails[0] ?? null);
  assert.match(
    String(lead.notes),
    /Found by the campaign "Synthetic importers in Accra"/,
  );
  assert.match(String(lead.notes), /Fit score \d+ of 100 \(simple rules\)/);
  assert.match(String(lead.notes), /Sample data, not a real business\./);

  // It shows on the leads board and in its history.
  const board = (await (await call("/api/v1/leads", admin)).json()) as Array<{
    id: string;
    source: string;
  }>;
  assert.equal(
    board.find((item) => item.id === lead.lead_id)?.source,
    "campaign",
  );
  // The board says which campaign found it.
  const onBoard = (await (await call("/api/v1/leads", admin)).json()) as Array<{
    id: string;
    campaignId: string | null;
    campaignName: string | null;
  }>;
  const found = onBoard.find((item) => item.id === lead.lead_id)!;
  assert.equal(found.campaignId, campaign.id);
  assert.equal(found.campaignName, campaign.name);

  const activities = (await (
    await call(`/api/v1/leads/${lead.lead_id}/activities`, admin)
  ).json()) as Array<{ kind: string; note: string; createdBy: string }>;
  assert.equal(activities.length, 1);
  assert.equal(activities[0].kind, "note");
  assert.match(activities[0].note, /Added from the campaign/);
  assert.equal(activities[0].createdBy, TEST_UNASSIGNED_USER_ID);

  // The prospect now says where it went, and the campaign counts it.
  const promoted = await prospects(campaign.id, "?promoted=true");
  assert.equal(promoted.total, 2);
  assert.equal(
    promoted.items.find((item) => item.id === first.id)?.promotedLeadId,
    lead.lead_id,
  );
  assert.equal(
    (
      (await (
        await call(`/api/v1/campaigns/${campaign.id}`, admin)
      ).json()) as Campaign
    ).promotedCount,
    2,
  );

  // Again, by someone else, with one new prospect: the two are reported, not repeated.
  const again = (await (
    await promote([first.id, second.id, third.id], admin)
  ).json()) as typeof result;
  assert.equal(again.promoted, 1);
  assert.equal(again.alreadyPromoted, 2);
  assert.deepEqual(
    again.results.slice(0, 2).map((entry) => entry.leadId),
    result.results.map((entry) => entry.leadId),
  );
  assert.equal(
    (await pool.query("SELECT count(*) AS n FROM app.lead")).rows[0].n,
    String(Number(leadsBefore) + 3),
  );

  // A prospect of another campaign cannot be promoted through this one.
  const other = await newCampaign({ maxProspects: 2 });
  await send("POST", `/api/v1/campaigns/${other.id}/runs`, admin);
  await runToEnd(pipeline(), other.id);
  const foreign = (await prospects(other.id)).items[0];
  const mixed = (await (
    await promote([foreign.id, randomUUID()])
  ).json()) as typeof result;
  assert.equal(mixed.notFound, 2);
  assert.equal(mixed.promoted, 0);
  assert.equal((await prospects(other.id, "?promoted=true")).total, 0);
});

test("promotion input is checked", async () => {
  const campaign = await newCampaign();
  const path = `/api/v1/campaigns/${campaign.id}/prospects/promote`;
  for (const body of [
    {},
    { prospectIds: [] },
    { prospectIds: ["nope"] },
    { prospectIds: "one" },
    { prospectIds: Array.from({ length: 101 }, () => randomUUID()) },
  ]) {
    assert.equal((await send("POST", path, admin, body)).status, 400);
  }
  assert.equal(
    (
      await send(
        "POST",
        `/api/v1/campaigns/${randomUUID()}/prospects/promote`,
        admin,
        {
          prospectIds: [randomUUID()],
        },
      )
    ).status,
    404,
  );
});

test("a lead cannot be logged by hand with the campaign source", async () => {
  const response = await send("POST", "/api/v1/leads", admin, {
    companyName: "Hand Made Ltd",
    source: "campaign",
  });
  assert.equal(response.status, 400);
  assert.match(
    ((await response.json()) as { message: string }).message,
    /source is not a supported lead source/,
  );
});

test("deleting a campaign removes its runs and prospects but keeps the leads made from it", async () => {
  const campaign = await newCampaign({ maxProspects: 2 });
  await send("POST", `/api/v1/campaigns/${campaign.id}/runs`, admin);
  await runToEnd(pipeline(), campaign.id);
  const [prospect] = (await prospects(campaign.id)).items;
  const promoted = (await (
    await send(
      "POST",
      `/api/v1/campaigns/${campaign.id}/prospects/promote`,
      admin,
      {
        prospectIds: [prospect.id],
      },
    )
  ).json()) as { results: Array<{ leadId: string }> };
  const leadId = promoted.results[0].leadId;

  const deleted = await call(`/api/v1/campaigns/${campaign.id}`, admin, {
    method: "DELETE",
  });
  assert.equal(deleted.status, 200);
  assert.equal(
    (await call(`/api/v1/campaigns/${campaign.id}`, admin)).status,
    404,
  );
  assert.equal(
    (
      await call(`/api/v1/campaigns/${campaign.id}`, admin, {
        method: "DELETE",
      })
    ).status,
    404,
  );
  const counts = (
    await pool.query(
      `SELECT (SELECT count(*) FROM app.prospect WHERE campaign_id = $1::uuid) AS prospects,
              (SELECT count(*) FROM app.lead_campaign_run WHERE campaign_id = $1::uuid) AS runs`,
      [campaign.id],
    )
  ).rows[0];
  assert.deepEqual([counts.prospects, counts.runs], ["0", "0"]);
  const lead = (
    await pool.query(
      `SELECT source, campaign_id FROM app.lead WHERE lead_id = $1::uuid`,
      [leadId],
    )
  ).rows[0];
  assert.equal(lead.source, "campaign");
  assert.equal(lead.campaign_id, null);
  // On the board it is still a campaign lead, but the campaign's name is gone.
  const onBoard = (await (await call("/api/v1/leads", admin)).json()) as Array<{
    id: string;
    source: string;
    campaignId: string | null;
    campaignName: string | null;
  }>;
  const kept = onBoard.find((item) => item.id === leadId)!;
  assert.deepEqual(
    [kept.source, kept.campaignId, kept.campaignName],
    ["campaign", null, null],
  );
});

type TableBlock = Extract<ReportBlock, { kind: "table" }>;
type BarsBlock = Extract<ReportBlock, { kind: "bars" }>;

test("the Sales report counts new leads by campaign, with won ones, and keeps a deleted campaign's leads apart", async () => {
  const day = new Date().toISOString().slice(0, 10);
  const sales = async () =>
    (
      await application
        .get(ReportPdfService)
        .document({ type: "sales-pipeline", from: day, to: day }, {}, [
          "super_admin",
        ])
    ).document.blocks;
  const tableWith = (blocks: ReportBlock[], first: string) =>
    blocks.find(
      (block): block is TableBlock =>
        block.kind === "table" && block.columns[0].header === first,
    )!;
  const row = (blocks: ReportBlock[], name: string) =>
    tableWith(blocks, "Campaign").rows.find((entry) => entry[0] === name);

  const a = await newCampaign({ name: "Report campaign A", maxProspects: 3 });
  const b = await newCampaign({ name: "Report campaign B", maxProspects: 2 });
  const leadIds: Record<string, string[]> = { a: [], b: [] };
  for (const [key, campaign, count] of [
    ["a", a, 2],
    ["b", b, 1],
  ] as const) {
    await send("POST", `/api/v1/campaigns/${campaign.id}/runs`, admin);
    await runToEnd(pipeline(), campaign.id);
    const chosen = (await prospects(campaign.id)).items.slice(0, count);
    const promoted = (await (
      await send(
        "POST",
        `/api/v1/campaigns/${campaign.id}/prospects/promote`,
        admin,
        { prospectIds: chosen.map((item) => item.id) },
      )
    ).json()) as { results: Array<{ leadId: string }> };
    leadIds[key] = promoted.results.map((entry) => entry.leadId);
  }

  // A lead logged by hand is not a campaign lead and must not appear among them.
  assert.equal(
    (
      await send("POST", "/api/v1/leads", admin, {
        companyName: "Walk-in Synthetic Ltd",
        source: "walk_in",
      })
    ).status,
    201,
  );

  // One of A's leads becomes a customer: it counts as won.
  const customerId = randomUUID();
  await database.createCustomer({
    id: customerId,
    companyName: "Report Won Customer Ltd",
    tradingName: null,
    website: null,
    phone: null,
    companyEmail: null,
    createdAt: new Date().toISOString(),
    contacts: [],
  });
  assert.equal(
    (
      await send("PATCH", `/api/v1/leads/${leadIds.a[0]}`, admin, {
        stage: "won",
        customerCompanyId: customerId,
      })
    ).status,
    200,
  );

  const before = await sales();
  assert.deepEqual(row(before, "Report campaign A"), [
    "Report campaign A",
    "2",
    "1",
  ]);
  assert.deepEqual(row(before, "Report campaign B"), [
    "Report campaign B",
    "1",
    "0",
  ]);
  const deletedBefore = Number(
    row(before, "A campaign that was deleted")?.[1] ?? 0,
  );
  // The source chart and this table agree on how many leads came from campaigns.
  const campaignLeads = (blocks: ReportBlock[]) =>
    tableWith(blocks, "Campaign").rows.reduce(
      (sum, entry) => sum + Number(entry[1]),
      0,
    );
  const bars = (blocks: ReportBlock[]) =>
    blocks.find(
      (block): block is BarsBlock =>
        block.kind === "bars" && block.rows.some((r) => r[0] === "Campaign"),
    )!;
  assert.equal(
    bars(before).rows.find((entry) => entry[0] === "Campaign")![1],
    campaignLeads(before),
  );
  const loggedTable = before.find(
    (block): block is TableBlock =>
      block.kind === "table" &&
      block.columns.some((column) => column.header === "Logged"),
  )!;
  assert.ok(
    loggedTable.rows.some(
      (entry) => entry[2] === "Campaign: Report campaign A",
    ),
  );

  // Deleting campaign B: its lead is kept, counted under "deleted", and no longer under B.
  assert.equal(
    (await call(`/api/v1/campaigns/${b.id}`, admin, { method: "DELETE" }))
      .status,
    200,
  );
  const after = await sales();
  assert.equal(row(after, "Report campaign B"), undefined);
  assert.equal(
    Number(row(after, "A campaign that was deleted")![1]),
    deletedBefore + 1,
  );
  assert.deepEqual(row(after, "Report campaign A"), [
    "Report campaign A",
    "2",
    "1",
  ]);
  assert.equal(
    bars(after).rows.find((entry) => entry[0] === "Campaign")![1],
    campaignLeads(after),
  );
  const loggedAfter = after.find(
    (block): block is TableBlock =>
      block.kind === "table" &&
      block.columns.some((column) => column.header === "Logged"),
  )!;
  assert.ok(loggedAfter.rows.some((entry) => entry[2] === "Campaign: deleted"));

  // And the real PDF still draws.
  const pdf = await call(
    `/api/v1/reports/pdf?type=sales-pipeline&from=${day}&to=${day}`,
    admin,
  );
  assert.equal(pdf.status, 200);
  assert.equal(
    Buffer.from(await pdf.arrayBuffer())
      .subarray(0, 5)
      .toString(),
    "%PDF-",
  );
});
