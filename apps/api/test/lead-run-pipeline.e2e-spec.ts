import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { after, before, beforeEach, test } from "node:test";
import { TEST_SUPER_ADMIN_ID, createTestApplication } from "./test-application";
import { DatabasePort } from "../src/database/database.port";
import { POSTGRES_POOL } from "../src/database/postgres-database.service";
import type { PostgresPool } from "../src/database/postgres-database.service";
import { ApifyError } from "../src/leads/apify-business-search";
import {
  StubBusinessSearchProvider,
  processPlaces,
} from "../src/leads/business-search";
import type { BusinessSearchQuery } from "../src/leads/business-search";
import type {
  BusinessSearchProvider,
  SearchProgress,
} from "../src/leads/business-search";
import {
  LEASE_SECONDS,
  LeadRunPipeline,
  MAX_ATTEMPTS,
  SEARCH_POLL_SECONDS,
} from "../src/leads/lead-run-pipeline.service";
import {
  RulesProspectScorer,
  scoreByRules,
} from "../src/leads/prospect-scoring";
import type {
  FitScore,
  ProspectForScoring,
  ProspectScorer,
} from "../src/leads/prospect-scoring";
import {
  StubWebsiteContactFinder,
  WEBSITE_CONTACT_FINDER,
} from "../src/leads/website-contacts";
import type {
  WebsiteContactFinder,
  WebsiteContacts,
} from "../src/leads/website-contacts";
import { beginTestDatabase, endTestDatabase } from "./postgres-test-database";

/** Everything here is synthetic: the search is the stub, no website is read, no AI is called. */
let application: INestApplication;
let database: DatabasePort;
let pool: PostgresPool;

/** The columns of a run and of a prospect that these tests read. */
interface Row {
  status: string;
  current_step: string;
  error_message: string | null;
  claimed_by: string | null;
  started_at: unknown;
  finished_at: unknown;
  found_count: number;
  stored_count: number;
  duplicate_count: number;
  qualified_count: number;
  disqualified_count: number;
  failed_count: number;
  provider_run_id: string | null;
  provider_dataset_id: string | null;
  attempt_count: number;
  business_name: string;
  category: string | null;
  address: string | null;
  website: string | null;
  rating: string | null;
  source: string;
  emails: string[];
  phones: string[];
  enrichment_status: string;
  enrichment_error: string | null;
  enriched_at: unknown;
  duplicate_kind: string | null;
  duplicate_reason: string | null;
  score: number | null;
  score_reason: string | null;
  score_method: string | null;
  scored_at: unknown;
  website_excerpt: string | null;
}

before(async () => {
  await beginTestDatabase();
  application = (await createTestApplication()).application;
  database = application.get(DatabasePort);
  pool = application.get(POSTGRES_POOL);
});

after(async () => {
  await application?.close();
  await endTestDatabase();
});

beforeEach(async () => {
  // Each test starts with no campaigns, so one run's work never shows in another's.
  await pool.query("DELETE FROM app.lead_campaign");
  await pool.query(
    "DELETE FROM app.customer_company WHERE company_name = 'Existing Customer Ltd'",
  );
});

async function campaign(
  overrides: { maxProspects?: number; threshold?: number } = {},
) {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO app.lead_campaign (campaign_id, name, target_service, target_industry,
       target_location, qualification_threshold, max_prospects, created_by)
     VALUES ($1::uuid, 'Synthetic campaign', 'Sea freight import', 'Import company',
             'Accra, Ghana', $2, $3, $4::uuid)`,
    [
      id,
      overrides.threshold ?? 50,
      overrides.maxProspects ?? 6,
      TEST_SUPER_ADMIN_ID,
    ],
  );
  return id;
}

async function queueRun(campaignId: string, target = 6) {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO app.lead_campaign_run (run_id, campaign_id, target_count, created_by)
     VALUES ($1::uuid, $2::uuid, $3, $4::uuid)`,
    [id, campaignId, target, TEST_SUPER_ADMIN_ID],
  );
  return id;
}

async function runRow(runId: string) {
  const result = await pool.query(
    `SELECT * FROM app.lead_campaign_run WHERE run_id = $1::uuid`,
    [runId],
  );
  return result.rows[0] as unknown as Row;
}

async function makeDue(runId: string) {
  await pool.query(
    `UPDATE app.lead_campaign_run SET next_attempt_at = clock_timestamp() - interval '1 second'
     WHERE run_id = $1::uuid`,
    [runId],
  );
}

/** Runs ticks until the run is over (or `limit` ticks), waiting out no delay. */
async function drive(pipeline: LeadRunPipeline, runId: string, limit = 60) {
  for (let tick = 0; tick < limit; tick++) {
    const row = await runRow(runId);
    if (["ready", "failed", "cancelled"].includes(row.status)) return row;
    await makeDue(runId);
    await pipeline.advance();
  }
  return runRow(runId);
}

function pipelineWith(
  parts: {
    search?: BusinessSearchProvider;
    finder?: WebsiteContactFinder;
    scorer?: ProspectScorer;
  } = {},
) {
  return new LeadRunPipeline(
    database,
    parts.search ?? new StubBusinessSearchProvider(),
    parts.finder ?? new StubWebsiteContactFinder(),
    parts.scorer ?? new RulesProspectScorer(),
  );
}

async function prospects(runId: string) {
  const result = await pool.query(
    `SELECT * FROM app.prospect WHERE run_id = $1::uuid ORDER BY business_name`,
    [runId],
  );
  return result.rows as unknown as Row[];
}

test("a queued run goes through searching, enriching and scoring to ready", async () => {
  const campaignId = await campaign({ threshold: 50 });
  const runId = await queueRun(campaignId, 6);
  const finished = await drive(pipelineWith(), runId);

  assert.equal(finished.status, "ready");
  assert.equal(finished.current_step, "ready");
  assert.equal(finished.error_message, null);
  assert.equal(finished.claimed_by, null);
  assert.ok(finished.started_at && finished.finished_at);
  assert.equal(finished.found_count, 6);
  assert.equal(finished.stored_count, 6);
  assert.equal(finished.duplicate_count, 0);
  assert.equal(finished.provider_run_id, "stub-run-1");

  const rows = await prospects(runId);
  assert.equal(rows.length, 6);
  for (const row of rows) {
    // Synthetic rows are marked as such, scored with a reason, and the excerpt is gone.
    assert.equal(row.source, "stub");
    assert.ok(
      Number.isInteger(row.score) && row.score! >= 0 && row.score! <= 100,
    );
    assert.ok(row.score_reason);
    assert.equal(row.score_method, "rules");
    assert.ok(row.scored_at);
    assert.equal(row.website_excerpt, null);
    assert.ok(row.enriched_at);
  }
  // Business 3 has no website: nothing to read. The others got "info@<domain>".
  const noSite = rows.find((row) => row.business_name.includes("Business 3 "))!;
  assert.equal(noSite.enrichment_status, "email_missing");
  const withSite = rows.find((row) =>
    row.business_name.includes("Business 1 "),
  )!;
  assert.equal(withSite.enrichment_status, "email_found");
  assert.deepEqual(withSite.emails, ["info@synthetic-business-1.example"]);

  const qualified = rows.filter((row) => row.score! >= 50).length;
  assert.equal(finished.qualified_count, qualified);
  assert.equal(finished.disqualified_count, rows.length - qualified);
  assert.equal(finished.failed_count, 0);
});

test("a duplicate of a customer is stored with a flag and counted; a repeat run stores nothing again", async () => {
  await database.createCustomer({
    id: randomUUID(),
    companyName: "Existing Customer Ltd",
    tradingName: null,
    website: "https://www.synthetic-business-2.example",
    phone: null,
    companyEmail: null,
    createdAt: new Date().toISOString(),
    contacts: [],
  });
  const campaignId = await campaign();
  const first = await queueRun(campaignId, 4);
  const pipeline = pipelineWith();
  const firstDone = await drive(pipeline, first);
  assert.equal(firstDone.status, "ready");
  assert.equal(firstDone.duplicate_count, 1);
  assert.equal(firstDone.stored_count, 4);
  const flagged = (await prospects(first)).filter((row) => row.duplicate_kind);
  assert.equal(flagged.length, 1);
  assert.equal(flagged[0].duplicate_kind, "customer");
  assert.match(flagged[0].duplicate_reason!, /Existing Customer Ltd/);

  // The same places again: the provider's own ids are already stored, so nothing is
  // stored twice, and each is counted as a duplicate.
  const second = await queueRun(campaignId, 4);
  const secondDone = await drive(pipeline, second);
  assert.equal(secondDone.status, "ready");
  assert.equal(secondDone.found_count, 4);
  assert.equal(secondDone.stored_count, 0);
  assert.equal(secondDone.duplicate_count, 4);
  assert.equal((await prospects(second)).length, 0);
});

test("while the search is still running the run waits and is asked again later", async () => {
  const search = new StubBusinessSearchProvider();
  search.pendingPolls = 2;
  const pipeline = pipelineWith({ search });
  const runId = await queueRun(await campaign(), 3);

  assert.equal(await pipeline.advance(), true); // claims, starts the search
  await makeDue(runId);
  assert.equal(await pipeline.advance(), true); // polls: still running
  let row = await runRow(runId);
  assert.equal(row.current_step, "searching");
  assert.equal(row.provider_dataset_id, null);
  assert.equal(row.claimed_by, null);
  // It waits before asking again, so an immediate tick finds nothing due.
  const wait = await pool.query(
    `SELECT extract(epoch FROM next_attempt_at - clock_timestamp()) AS seconds
     FROM app.lead_campaign_run WHERE run_id = $1::uuid`,
    [runId],
  );
  assert.ok(Number(wait.rows[0].seconds) > SEARCH_POLL_SECONDS - 5);
  assert.equal(await pipeline.advance(), false);

  row = await drive(pipeline, runId);
  assert.equal(row.status, "ready");
  assert.equal(row.stored_count, 3);
});

test("a search the provider reports as failed fails the run with that message", async () => {
  const search = new StubBusinessSearchProvider();
  search.failWith = "The Apify search ended as timed-out";
  const runId = await queueRun(await campaign());
  const row = await drive(pipelineWith({ search }), runId);
  assert.equal(row.status, "failed");
  assert.equal(row.current_step, "failed");
  assert.equal(row.error_message, "The Apify search ended as timed-out");
  assert.ok(row.finished_at);
  assert.equal(row.claimed_by, null);
  assert.equal((await prospects(runId)).length, 0);
});

test("a provider error that will repeat fails the run at once, with its safe message", async () => {
  const search = new StubBusinessSearchProvider();
  search.start = async () => {
    throw new ApifyError("Apify did not accept the token that was set up");
  };
  const runId = await queueRun(await campaign());
  const pipeline = pipelineWith({ search });
  await pipeline.advance();
  const row = await runRow(runId);
  assert.equal(row.status, "failed");
  assert.equal(
    row.error_message,
    "Apify did not accept the token that was set up",
  );
});

test("a busy or broken provider is retried later, then given up after the attempt limit", async () => {
  const search = new StubBusinessSearchProvider();
  let calls = 0;
  search.start = async () => {
    calls += 1;
    throw new ApifyError("Apify is busy; try again in a few minutes", true);
  };
  const runId = await queueRun(await campaign());
  const pipeline = pipelineWith({ search });

  await pipeline.advance();
  let row = await runRow(runId);
  assert.equal(row.status, "running");
  assert.equal(row.attempt_count, 1);
  assert.equal(row.error_message, null);
  assert.equal(row.claimed_by, null);
  // It backs off: nothing is due straight away.
  assert.equal(await pipeline.advance(), false);

  row = await drive(pipeline, runId);
  assert.equal(calls, MAX_ATTEMPTS);
  assert.equal(row.status, "failed");
  assert.match(row.error_message!, /busy.*gave up after 5 attempts/);
});

test("a retryable failure that then clears carries on from where the run was", async () => {
  const search = new StubBusinessSearchProvider();
  search.failStartWith = "network down";
  const pipeline = pipelineWith({ search });
  const runId = await queueRun(await campaign(), 3);
  await pipeline.advance();
  let row = await runRow(runId);
  assert.equal(row.status, "running");
  assert.equal(row.attempt_count, 1);

  search.failStartWith = null;
  row = await drive(pipeline, runId);
  assert.equal(row.status, "ready");
  assert.equal(row.attempt_count, 0);
  assert.equal(row.stored_count, 3);
});

test("an unexpected error is shown to staff only as a generic problem", async () => {
  const search = new StubBusinessSearchProvider();
  search.failStartWith = "connect ECONNREFUSED 10.0.0.5:5432 password=hunter2";
  const runId = await queueRun(await campaign());
  const row = await drive(pipelineWith({ search }), runId);
  assert.equal(row.status, "failed");
  assert.match(row.error_message!, /unexpected problem/);
  assert.doesNotMatch(row.error_message!, /hunter2|10\.0\.0\.5/);
});

test("a run whose worker died is taken over when its lease runs out, and counts as an attempt", async () => {
  const runId = await queueRun(await campaign(), 3);
  const pipeline = pipelineWith();

  // A worker claims the run and never gives it back.
  const held = await database.claimLeadRun("dead-worker", LEASE_SECONDS);
  assert.equal(held?.runId, runId);
  assert.equal(held?.step, "searching");
  // While the lease holds, nobody else can take it.
  assert.equal(await database.claimLeadRun("other", LEASE_SECONDS), null);
  assert.equal(await pipeline.advance(), false);

  // The lease runs out.
  await makeDue(runId);
  const taken = await database.claimLeadRun("rescuer", LEASE_SECONDS);
  assert.equal(taken?.runId, runId);
  assert.equal(taken?.attemptCount, 1);
  // The dead worker can no longer change the run.
  assert.equal(
    await database.releaseLeadRun(
      { runId, claimId: "dead-worker" },
      { attemptCount: 0, nextInSeconds: 0 },
    ),
    false,
  );
  assert.equal(
    await database.failLeadRun({ runId, claimId: "dead-worker" }, "x"),
    false,
  );
  await database.releaseLeadRun(
    { runId, claimId: "rescuer" },
    { attemptCount: 1, nextInSeconds: 0 },
  );

  const row = await drive(pipeline, runId);
  assert.equal(row.status, "ready");
});

test("a run that keeps killing its workers is given up", async () => {
  const runId = await queueRun(await campaign());
  for (let claim = 0; claim < MAX_ATTEMPTS; claim++) {
    await makeDue(runId);
    assert.ok(await database.claimLeadRun(`dead-${claim}`, LEASE_SECONDS));
  }
  await makeDue(runId);
  await pipelineWith().advance();
  const row = await runRow(runId);
  assert.equal(row.status, "failed");
  assert.match(row.error_message!, /too many times/);
});

test("a worker that lost its claim stores nothing", async () => {
  const campaignId = await campaign();
  const runId = await queueRun(campaignId);
  const claim = await database.claimLeadRun("worker-a", LEASE_SECONDS);
  assert.ok(claim);
  const business = (
    await new StubBusinessSearchProvider().fetchResults("d", {
      industry: "x",
      location: "y",
      keywords: [],
      excludedKeywords: [],
      minRating: null,
      requireWebsite: false,
      maxResults: 1,
    })
  ).businesses[0];
  const stored = await database.storeFoundProspects(
    { runId, campaignId, claimId: "worker-b" },
    [{ prospectId: randomUUID(), business, duplicate: null }],
    { found: 1, duplicates: 0 },
  );
  assert.equal(stored, false);
  assert.equal((await prospects(runId)).length, 0);
  assert.equal((await runRow(runId)).current_step, "searching");
});

test("runs are taken one at a time, oldest first, and a cancelled run is left alone", async () => {
  const first = await queueRun(await campaign());
  const second = await queueRun(await campaign());
  const cancelled = await queueRun(await campaign());
  await pool.query(
    `UPDATE app.lead_campaign_run SET status = 'cancelled', current_step = 'cancelled',
       finished_at = clock_timestamp() WHERE run_id = $1::uuid`,
    [cancelled],
  );
  const pipeline = pipelineWith();
  await pipeline.advance();
  assert.equal((await runRow(first)).status, "running");
  assert.equal((await runRow(second)).status, "queued");
  assert.equal((await runRow(cancelled)).status, "cancelled");

  // The oldest is worked on until it is over, then the next one starts.
  await drive(pipeline, first);
  assert.equal((await runRow(second)).status, "queued");
  assert.equal((await drive(pipeline, second)).status, "ready");
  assert.equal((await runRow(cancelled)).status, "cancelled");
});

test("an unreadable website marks that prospect failed and the run still finishes", async () => {
  const read: string[] = [];
  const finder: WebsiteContactFinder = {
    async find(website): Promise<WebsiteContacts> {
      read.push(website);
      if (website.includes("business-1."))
        return {
          status: "failed",
          emails: [],
          phones: [],
          pagesChecked: 0,
          excerpt: null,
          error: "The website could not be read",
        };
      if (website.includes("business-2.")) throw new Error("finder bug");
      return {
        status: "email_missing",
        emails: [],
        phones: ["+233 24 000 1111"],
        pagesChecked: 1,
        excerpt: null,
        error: null,
      };
    },
  };
  const runId = await queueRun(await campaign(), 4);
  const row = await drive(pipelineWith({ finder }), runId);
  assert.equal(row.status, "ready");
  const rows = await prospects(runId);
  const byName = (n: number) =>
    rows.find((r) => r.business_name.includes(`Business ${n} `))!;
  assert.equal(byName(1).enrichment_status, "failed");
  assert.equal(byName(1).enrichment_error, "The website could not be read");
  assert.equal(byName(2).enrichment_status, "failed");
  assert.equal(byName(4).enrichment_status, "email_missing");
  // The number the site gave is kept next to the one the search gave.
  assert.equal(byName(4).phones.length, 2);
  assert.equal(row.failed_count, 2);
  // A prospect whose site could not be read is still scored, from the search data.
  assert.ok(rows.every((r) => r.score !== null));
});

test("an email and social pages from the search are kept, even when the website cannot be read", async () => {
  // As the contact-details actor reports them: the address and pages come with the place.
  class EmailedSearch extends StubBusinessSearchProvider {
    override async fetchResults(
      _datasetId: string,
      query: BusinessSearchQuery,
    ) {
      return processPlaces(
        [
          {
            title: "Emailed Foods Ltd",
            placeId: "emailed-1",
            website: "https://emailed-foods.example",
            emails: ["Sales@Emailed-Foods.example"],
            facebooks: ["facebook.com/emailed.foods"],
            instagrams: [
              "https://www.instagram.com/emailed_foods/",
              "https://evil.example/instagram.com/x",
            ],
            linkedIns: ["not a link"],
          },
        ],
        query,
        "stub",
      );
    }
  }
  const finder: WebsiteContactFinder = {
    async find(): Promise<WebsiteContacts> {
      return {
        status: "failed",
        emails: [],
        phones: [],
        pagesChecked: 0,
        excerpt: null,
        error: "The website could not be read",
      };
    },
  };
  const runId = await queueRun(await campaign(), 1);
  const row = await drive(
    pipelineWith({ search: new EmailedSearch(), finder }),
    runId,
  );
  assert.equal(row.status, "ready");
  const [found] = (
    await pool.query(
      `SELECT enrichment_status, enrichment_error, emails, social_links
     FROM app.prospect WHERE run_id = $1::uuid`,
      [runId],
    )
  ).rows;
  // The address the search gave counts: the site being unreadable is not a failure here.
  assert.equal(found.enrichment_status, "email_found");
  assert.equal(found.enrichment_error, null);
  assert.deepEqual(found.emails, ["sales@emailed-foods.example"]);
  // Only real pages on their own platform are stored, as https addresses.
  assert.deepEqual(found.social_links, {
    facebook: ["https://facebook.com/emailed.foods"],
    instagram: ["https://www.instagram.com/emailed_foods/"],
  });
});

test("the scorer gets the campaign's rules and the website excerpt, and it is dropped once scored", async () => {
  const seen: Array<{ prospect: ProspectForScoring; threshold: number }> = [];
  const scorer: ProspectScorer = {
    name: "test",
    async score(prospect, rules): Promise<FitScore> {
      seen.push({ prospect, threshold: rules.qualificationThreshold });
      return { score: 77, reason: "Looks right.", method: "ai" };
    },
  };
  const finder: WebsiteContactFinder = {
    async find(): Promise<WebsiteContacts> {
      return {
        status: "email_found",
        emails: [
          { address: "Info@Synthetic.example", score: 80, foundOn: "x" },
        ],
        phones: [],
        pagesChecked: 1,
        excerpt: "We import rice for supermarkets.",
        error: null,
      };
    },
  };
  const runId = await queueRun(await campaign({ threshold: 77 }), 2);
  const row = await drive(pipelineWith({ finder, scorer }), runId);
  assert.equal(row.status, "ready");
  assert.equal(seen.length, 2);
  for (const call of seen) {
    assert.equal(call.threshold, 77);
    assert.equal(call.prospect.websiteText, "We import rice for supermarkets.");
    assert.equal(call.prospect.hasEmail, true);
  }
  const rows = await prospects(runId);
  assert.ok(rows.every((r) => r.score === 77 && r.score_method === "ai"));
  assert.ok(rows.every((r) => r.website_excerpt === null));
  // A score exactly on the campaign's threshold of 77 qualifies.
  assert.equal(row.qualified_count, 2);
  assert.equal(row.disqualified_count, 0);
});

test("a scorer that breaks does not stop the run: the rules score is used", async () => {
  const scorer: ProspectScorer = {
    name: "broken",
    async score() {
      throw new Error("scorer bug");
    },
  };
  const runId = await queueRun(await campaign(), 2);
  const row = await drive(pipelineWith({ scorer }), runId);
  assert.equal(row.status, "ready");
  const rows = await prospects(runId);
  assert.ok(rows.every((r) => r.score_method === "rules"));
  assert.ok(
    rows.every(
      (r) =>
        r.score ===
        scoreByRules(
          {
            businessName: r.business_name,
            category: r.category,
            address: r.address,
            website: r.website,
            rating: Number(r.rating),
            hasEmail: r.emails.length > 0,
            hasPhone: r.phones.length > 0,
            websiteText: null,
          },
          {
            targetService: "Sea freight import",
            targetIndustry: "Import company",
            targetLocation: "Accra, Ghana",
            idealCustomerProfile: null,
            disqualifiers: null,
            qualificationThreshold: 50,
          },
        ).score,
    ),
  );
});

test("a search that finds nothing still ends as ready, with zero counts", async () => {
  const search: BusinessSearchProvider = {
    name: "empty",
    async start() {
      return { providerRunId: "empty-run" };
    },
    async poll(): Promise<SearchProgress> {
      return { state: "succeeded", datasetId: "empty-dataset" };
    },
    async fetchResults() {
      return { businesses: [], rawCount: 0, rejected: {} };
    },
  };
  const runId = await queueRun(await campaign());
  const row = await drive(pipelineWith({ search }), runId);
  assert.equal(row.status, "ready");
  assert.equal(row.found_count, 0);
  assert.equal(row.stored_count, 0);
});

test("the application wires the pipeline, the search, the finder and the scorer", async () => {
  assert.ok(application.get(LeadRunPipeline));
  assert.ok(application.get(WEBSITE_CONTACT_FINDER));
});
