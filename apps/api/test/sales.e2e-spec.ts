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
import { POSTGRES_POOL } from "../src/database/postgres-database.service";
import type { PostgresPool } from "../src/database/postgres-database.service";
import { OUTREACH_DRAFTER } from "../src/sales/outreach-drafting";
import { beginTestDatabase, endTestDatabase } from "./postgres-test-database";

/** Everything is synthetic, nothing is sent, and the drafter is the fixed wording (asserted below). */
let application: INestApplication;
let baseUrl: string;
let pool: PostgresPool;

type Pool = {
  items: Array<{
    id: string;
    businessName: string;
    campaignName: string;
    score: number | null;
    dismissedAt: string | null;
    draftStatus: string | null;
    promotedLeadId: string | null;
  }>;
  total: number;
};
type Draft = {
  id: string;
  prospectId: string;
  recipientEmail: string;
  subject: string;
  body: string;
  status: string;
  method: string;
  edited: boolean;
  rejectedReason: string | null;
  decidedByName: string | null;
};
type DraftPage = {
  items: Draft[];
  total: number;
  counts: Record<string, number>;
};

const admin = TEST_SUPER_ADMIN_TOKEN;
const salesRep = TEST_UNASSIGNED_TOKEN;

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
    ...(method === "GET" ? {} : { body: JSON.stringify(body) }),
  });

async function newCampaign(name: string) {
  const response = await send("POST", "/api/v1/campaigns", admin, {
    name,
    targetService: "Sea freight import",
    targetIndustry: "Food importers",
    targetLocation: "Accra, Ghana",
  });
  assert.equal(response.status, 201);
  return ((await response.json()) as { id: string }).id;
}

/** A scored prospect, as the run pipeline would leave it. */
async function addProspect(
  campaignId: string,
  name: string,
  options: { score?: number | null; emails?: string[] } = {},
) {
  const id = randomUUID();
  const score = options.score === undefined ? 60 : options.score;
  await pool.query(
    `INSERT INTO app.prospect
       (prospect_id, campaign_id, business_name, source, normalized_name, emails,
        category, address, score, score_reason, score_method, scored_at)
     VALUES ($1::uuid, $2::uuid, $3, 'stub', $4, $5::text[], 'Food importer',
             '1 Example Road, Accra', $6, $7, $8, $9)`,
    [
      id,
      campaignId,
      name,
      name.toLowerCase(),
      options.emails ?? [],
      score,
      score === null ? null : "Synthetic reason",
      score === null ? null : "rules",
      score === null ? null : new Date().toISOString(),
    ],
  );
  return id;
}

async function poolOf(query = "") {
  const response = await call(`/api/v1/sales/pool${query}`, admin);
  assert.equal(response.status, 200);
  return (await response.json()) as Pool;
}
async function draftsOf(query = "") {
  const response = await call(`/api/v1/sales/drafts${query}`, admin);
  assert.equal(response.status, 200);
  return (await response.json()) as DraftPage;
}
async function draftFor(prospectIds: string[]) {
  const response = await send("POST", "/api/v1/sales/drafts", admin, {
    prospectIds,
  });
  assert.equal(response.status, 201);
  return (await response.json()) as {
    created: Draft[];
    skipped: Array<{ prospectId: string; reason: string }>;
  };
}

before(async () => {
  await beginTestDatabase();
  const started = await createTestApplication();
  application = started.application;
  baseUrl = started.baseUrl;
  pool = application.get(POSTGRES_POOL);
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
  // Never let a test reach a real AI.
  assert.equal(application.get(OUTREACH_DRAFTER).name, "template");
});

after(async () => {
  await application?.close();
  await endTestDatabase();
});

test("customers, other staff roles and anonymous callers are refused on every sales route", async () => {
  const id = randomUUID();
  const routes: Array<[string, string, unknown?]> = [
    ["GET", "/api/v1/sales/overview"],
    ["GET", "/api/v1/sales/pool"],
    [
      "POST",
      "/api/v1/sales/pool/dismiss",
      { prospectIds: [id], dismissed: true },
    ],
    ["POST", "/api/v1/sales/drafts", { prospectIds: [id] }],
    ["GET", "/api/v1/sales/drafts"],
    ["POST", "/api/v1/sales/drafts/approve", { draftIds: [id] }],
    [
      "PATCH",
      `/api/v1/sales/drafts/${id}`,
      { recipientEmail: "a@example.test", subject: "s", body: "b" },
    ],
    ["POST", `/api/v1/sales/drafts/${id}/approve`],
    ["POST", `/api/v1/sales/drafts/${id}/reject`, {}],
  ];
  for (const [method, path, body] of routes) {
    for (const [who, token, status] of [
      ["a customer", TEST_CUSTOMER_A_TOKEN, 403],
      ["an import rep", TEST_MATCHING_TOKEN, 403],
      ["no sign-in", null, 401],
    ] as const) {
      const response = await send(method, path, token, body);
      assert.equal(response.status, status, `${method} ${path} as ${who}`);
    }
  }
  // A sales rep and the super admin are let in.
  for (const token of [salesRep, admin]) {
    assert.equal((await call("/api/v1/sales/overview", token)).status, 200);
    assert.equal((await call("/api/v1/sales/pool", token)).status, 200);
  }
});

test("the pool lists prospects of every campaign and filters, searches and sorts them", async () => {
  const first = await newCampaign("Pool campaign one");
  const second = await newCampaign("Pool campaign two");
  await addProspect(first, "Pool Alpha Foods", {
    score: 80,
    emails: ["a@pool-alpha.example"],
  });
  await addProspect(first, "Pool Bravo Rice", { score: 40 });
  await addProspect(second, "Pool Charlie Grains", {
    score: null,
    emails: ["c@pool-charlie.example"],
  });

  const everything = await poolOf("?search=Pool%20&limit=10");
  assert.equal(everything.total, 3);
  // Best score first; an unscored business last; each says which campaign found it.
  assert.deepEqual(
    everything.items.map((item) => item.businessName),
    ["Pool Alpha Foods", "Pool Bravo Rice", "Pool Charlie Grains"],
  );
  assert.deepEqual(
    everything.items.map((item) => item.campaignName),
    ["Pool campaign one", "Pool campaign one", "Pool campaign two"],
  );

  const named = await poolOf("?search=Pool&sort=name");
  assert.deepEqual(
    named.items.map((item) => item.businessName),
    ["Pool Alpha Foods", "Pool Bravo Rice", "Pool Charlie Grains"],
  );
  assert.equal((await poolOf(`?campaignId=${second}`)).total, 1);
  assert.equal((await poolOf("?search=Pool&minScore=50")).total, 1);
  assert.equal((await poolOf("?search=Pool&hasEmail=true")).total, 2);
  assert.equal((await poolOf("?search=Pool&hasEmail=false")).total, 1);
  assert.equal((await poolOf("?search=rice")).total, 1);
  // A "%" in the search is text, not a wildcard.
  assert.equal((await poolOf("?search=%25")).total, 0);

  for (const bad of [
    "?status=maybe",
    "?sort=best",
    "?minScore=101",
    "?hasEmail=yes",
    "?campaignId=nope",
    "?limit=0",
    "?limit=201",
  ]) {
    const response = await call(`/api/v1/sales/pool${bad}`, admin);
    assert.equal(response.status, 400, bad);
  }
});

test("dismissing sets a business aside and restoring brings it back; a lead cannot be dismissed", async () => {
  const campaignId = await newCampaign("Dismiss campaign");
  const keep = await addProspect(campaignId, "Dismiss Keep Ltd");
  const away = await addProspect(campaignId, "Dismiss Away Ltd");
  const asLead = await addProspect(campaignId, "Dismiss Lead Ltd");

  const promoted = await send(
    "POST",
    `/api/v1/campaigns/${campaignId}/prospects/promote`,
    admin,
    { prospectIds: [asLead] },
  );
  assert.equal(promoted.status, 200);

  const dismiss = await send("POST", "/api/v1/sales/pool/dismiss", salesRep, {
    prospectIds: [away, asLead, randomUUID()],
    dismissed: true,
  });
  assert.equal(dismiss.status, 200);
  // Only the one that was free to dismiss changed.
  assert.deepEqual(await dismiss.json(), { changed: 1, unchanged: 2 });

  const waiting = await poolOf(`?campaignId=${campaignId}`);
  assert.deepEqual(
    waiting.items.map((item) => item.businessName),
    ["Dismiss Keep Ltd"],
  );
  const dismissed = await poolOf(`?campaignId=${campaignId}&status=dismissed`);
  assert.deepEqual(
    dismissed.items.map((item) => item.businessName),
    ["Dismiss Away Ltd"],
  );
  assert.ok(dismissed.items[0].dismissedAt);
  const added = await poolOf(`?campaignId=${campaignId}&status=added`);
  assert.deepEqual(
    added.items.map((item) => item.businessName),
    ["Dismiss Lead Ltd"],
  );
  assert.ok(added.items[0].promotedLeadId);
  assert.equal((await poolOf(`?campaignId=${campaignId}&status=all`)).total, 3);

  // Dismissing it again changes nothing; restoring brings it back.
  const again = await send("POST", "/api/v1/sales/pool/dismiss", admin, {
    prospectIds: [away],
    dismissed: true,
  });
  assert.deepEqual(await again.json(), { changed: 0, unchanged: 1 });
  const restore = await send("POST", "/api/v1/sales/pool/dismiss", admin, {
    prospectIds: [away, keep],
    dismissed: false,
  });
  assert.deepEqual(await restore.json(), { changed: 1, unchanged: 1 });
  assert.equal((await poolOf(`?campaignId=${campaignId}`)).total, 2);

  for (const bad of [
    {},
    { prospectIds: [], dismissed: true },
    { prospectIds: [away] },
    { prospectIds: ["nope"], dismissed: true },
  ]) {
    const response = await send(
      "POST",
      "/api/v1/sales/pool/dismiss",
      admin,
      bad,
    );
    assert.equal(response.status, 400, JSON.stringify(bad));
  }
});

test("drafting writes one pending email per business with an address and reports the rest", async () => {
  const campaignId = await newCampaign("Drafting campaign");
  const withEmail = await addProspect(campaignId, "Draft Foods Ltd", {
    emails: ["sales@draft-foods.example", "other@draft-foods.example"],
  });
  const noEmail = await addProspect(campaignId, "Draft Silent Ltd");
  const setAside = await addProspect(campaignId, "Draft Away Ltd", {
    emails: ["a@draft-away.example"],
  });
  await send("POST", "/api/v1/sales/pool/dismiss", admin, {
    prospectIds: [setAside],
    dismissed: true,
  });
  const missing = randomUUID();

  const result = await draftFor([withEmail, noEmail, setAside, missing]);
  assert.equal(result.created.length, 1);
  const [draft] = result.created;
  assert.equal(draft.prospectId, withEmail);
  assert.equal(draft.recipientEmail, "sales@draft-foods.example");
  assert.equal(draft.status, "pending");
  assert.equal(draft.method, "template");
  assert.equal(draft.edited, false);
  assert.match(draft.subject, /Draft Foods Ltd/);
  assert.match(draft.body, /reply "stop"/);
  assert.deepEqual(
    result.skipped.map((skip) => [skip.prospectId, skip.reason]).sort(),
    [
      [noEmail, "no_email"],
      [setAside, "dismissed"],
      [missing, "not_found"],
    ].sort(),
  );

  // Drafting again does not pile up a second open draft.
  const second = await draftFor([withEmail]);
  assert.equal(second.created.length, 0);
  assert.deepEqual(
    second.skipped.map((skip) => skip.reason),
    ["already_drafted"],
  );

  // The pool shows the draft's state.
  const pooled = await poolOf(`?campaignId=${campaignId}&search=Foods`);
  assert.equal(pooled.items[0].draftStatus, "pending");

  for (const bad of [{}, { prospectIds: [] }, { prospectIds: ["nope"] }]) {
    const response = await send("POST", "/api/v1/sales/drafts", admin, bad);
    assert.equal(response.status, 400, JSON.stringify(bad));
  }
  const tooMany = await send("POST", "/api/v1/sales/drafts", admin, {
    prospectIds: Array.from({ length: 21 }, () => randomUUID()),
  });
  assert.equal(tooMany.status, 400);
});

test("a person edits, approves or rejects a pending draft; the first decision stands", async () => {
  const campaignId = await newCampaign("Approval campaign");
  const ids = [
    await addProspect(campaignId, "Approve One Ltd", {
      emails: ["1@a.example"],
    }),
    await addProspect(campaignId, "Approve Two Ltd", {
      emails: ["2@a.example"],
    }),
    await addProspect(campaignId, "Approve Three Ltd", {
      emails: ["3@a.example"],
    }),
  ];
  const { created } = await draftFor(ids);
  assert.equal(created.length, 3);
  const [one, two, three] = created;

  // Edit: the wording changes and is marked as edited; a bad address is refused.
  const edited = await send(
    "PATCH",
    `/api/v1/sales/drafts/${one.id}`,
    salesRep,
    {
      recipientEmail: "boss@a.example",
      subject: "A better subject",
      body: "Hello, a better body.",
    },
  );
  assert.equal(edited.status, 200);
  const editedBody = (await edited.json()) as Draft;
  assert.equal(editedBody.recipientEmail, "boss@a.example");
  assert.equal(editedBody.subject, "A better subject");
  assert.equal(editedBody.edited, true);
  for (const bad of [
    { recipientEmail: "not-an-email", subject: "s", body: "b" },
    { recipientEmail: "a@a.example", subject: "", body: "b" },
    { recipientEmail: "a@a.example", subject: "s", body: "x".repeat(5001) },
    {},
  ]) {
    const response = await send(
      "PATCH",
      `/api/v1/sales/drafts/${one.id}`,
      admin,
      bad,
    );
    assert.equal(response.status, 400, JSON.stringify(bad).slice(0, 60));
  }
  // Saving the same wording is not an edit.
  const same = await send("PATCH", `/api/v1/sales/drafts/${two.id}`, admin, {
    recipientEmail: two.recipientEmail,
    subject: two.subject,
    body: two.body,
  });
  assert.equal(((await same.json()) as Draft).edited, false);

  // Approve records who and when; a second decision is refused and changes nothing.
  const approved = await send(
    "POST",
    `/api/v1/sales/drafts/${one.id}/approve`,
    salesRep,
  );
  assert.equal(approved.status, 200);
  const approvedBody = (await approved.json()) as Draft;
  assert.equal(approvedBody.status, "approved");
  // Who approved is recorded (the test sign-in has no display name, so it is the email).
  assert.ok(approvedBody.decidedByName);
  assert.equal(
    (await send("POST", `/api/v1/sales/drafts/${one.id}/approve`, admin))
      .status,
    409,
  );
  assert.equal(
    (await send("POST", `/api/v1/sales/drafts/${one.id}/reject`, admin, {}))
      .status,
    409,
  );
  assert.equal(
    (
      await send("PATCH", `/api/v1/sales/drafts/${one.id}`, admin, {
        recipientEmail: "a@a.example",
        subject: "late",
        body: "late",
      })
    ).status,
    409,
  );

  // Reject keeps the reason; the business can then be drafted for again.
  const rejected = await send(
    "POST",
    `/api/v1/sales/drafts/${two.id}/reject`,
    admin,
    {
      reason: "Wrong tone",
    },
  );
  assert.equal(rejected.status, 200);
  const rejectedBody = (await rejected.json()) as Draft;
  assert.equal(rejectedBody.status, "rejected");
  assert.equal(rejectedBody.rejectedReason, "Wrong tone");
  assert.equal((await draftFor([two.prospectId])).created.length, 1);

  // Batch approve: the pending one is approved, the decided and the unknown are reported.
  const batch = await send("POST", "/api/v1/sales/drafts/approve", admin, {
    draftIds: [three.id, one.id, randomUUID()],
  });
  assert.equal(batch.status, 200);
  const batchBody = (await batch.json()) as {
    approved: number;
    notPending: number;
    notFound: number;
  };
  assert.deepEqual(
    [batchBody.approved, batchBody.notPending, batchBody.notFound],
    [1, 1, 1],
  );

  // The queue lists pending drafts, and counts every status.
  const pending = await draftsOf("?status=pending");
  assert.ok(pending.items.every((draft) => draft.status === "pending"));
  assert.ok(pending.items.some((draft) => draft.prospectId === two.prospectId));
  assert.ok(pending.counts.approved >= 2 && pending.counts.rejected >= 1);
  assert.equal(
    (await call("/api/v1/sales/drafts?status=sent", admin)).status,
    400,
  );
  assert.equal(
    (await send("POST", `/api/v1/sales/drafts/${randomUUID()}/approve`, admin))
      .status,
    404,
  );
  assert.equal(
    (await send("POST", "/api/v1/sales/drafts/not-an-id/approve", admin))
      .status,
    404,
  );
});

test("the overview counts the pool, the funnel, drafts and what is due", async () => {
  const campaignId = await newCampaign("Overview campaign");
  const good = await addProspect(campaignId, "Overview Good Ltd", {
    score: 90,
    emails: ["g@o.example"],
  });
  await addProspect(campaignId, "Overview Weak Ltd", { score: 10 });
  const promoted = await send(
    "POST",
    `/api/v1/campaigns/${campaignId}/prospects/promote`,
    admin,
    { prospectIds: [good] },
  );
  const leadId = (
    (await promoted.json()) as { results: Array<{ leadId: string }> }
  ).results[0].leadId;
  // The lead has a follow-up that is already due.
  const due = await send("PATCH", `/api/v1/leads/${leadId}`, admin, {
    nextFollowUp: "2020-01-01",
  });
  assert.equal(due.status, 200);

  const response = await call("/api/v1/sales/overview", admin);
  assert.equal(response.status, 200);
  const overview = (await response.json()) as {
    pool: { waiting: number; goodFit: number; withEmail: number };
    funnel: { found: number; goodFit: number; addedToLeads: number };
    leads: { open: number; followUpsDue: number };
    drafts: { pending: number; approved: number; rejected: number };
    followUps: Array<{ leadId: string; overdue: boolean }>;
    recentActivity: Array<{ leadId: string }>;
    campaigns: Array<{
      name: string;
      found: number;
      goodFit: number;
      added: number;
    }>;
  };
  assert.ok(overview.funnel.found >= 2);
  assert.ok(overview.funnel.goodFit >= 1);
  assert.ok(overview.funnel.addedToLeads >= 1);
  assert.ok(overview.pool.waiting >= 1);
  assert.ok(overview.leads.open >= 1);
  assert.ok(overview.leads.followUpsDue >= 1);
  const followUp = overview.followUps.find((item) => item.leadId === leadId);
  assert.ok(followUp?.overdue);
  assert.ok(overview.recentActivity.some((item) => item.leadId === leadId));
  assert.ok(overview.drafts.pending >= 0);
  const mine = overview.campaigns.find((c) => c.name === "Overview campaign");
  assert.deepEqual([mine?.found, mine?.goodFit, mine?.added], [2, 1, 1]);
});
