import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isActiveRun,
  leadCampaignNote,
  joinWords,
  parseWords,
  prospectQuery,
  runLabel,
  searchStepsFor,
  runSummary,
  safeWebUrl,
  scoreMethodLabel,
  socialLinkGroups,
  stepsDone,
} from "./campaignView.ts";
import type { CampaignRun } from "./campaignApi.ts";

const run = (change: Partial<CampaignRun> = {}): CampaignRun => ({
  id: "run-1",
  campaignId: "campaign-1",
  status: "ready",
  step: "ready",
  targetCount: 20,
  foundCount: 12,
  storedCount: 11,
  duplicateCount: 1,
  qualifiedCount: 7,
  disqualifiedCount: 4,
  failedCount: 2,
  errorMessage: null,
  startedAt: null,
  finishedAt: null,
  createdAt: "2026-11-11T10:00:00.000Z",
  ...change,
});

test("a search is active while it waits or works, and not once it is over", () => {
  assert.equal(isActiveRun(null), false);
  for (const status of ["queued", "running"] as const) {
    assert.equal(isActiveRun(run({ status })), true, status);
  }
  for (const status of ["ready", "failed", "cancelled"] as const) {
    assert.equal(isActiveRun(run({ status })), false, status);
  }
});

test("each stage of a search has its own plain label", () => {
  assert.equal(
    runLabel(run({ status: "queued", step: "queued" })),
    "Waiting to start",
  );
  assert.equal(
    runLabel(run({ status: "running", step: "enriching" })),
    "Reading their websites",
  );
  assert.equal(
    runLabel(run({ status: "running", step: "scoring" })),
    "Scoring the fit",
  );
  assert.equal(
    runLabel(run({ status: "running", step: "qualifying" })),
    "Qualifying the best",
  );
  assert.equal(
    runLabel(run({ status: "running", step: "drafting" })),
    "Writing tailored emails",
  );
  assert.equal(runLabel(run()), "Finished");
  assert.equal(runLabel(run({ status: "failed", step: "failed" })), "Failed");
  assert.equal(
    runLabel(run({ status: "cancelled", step: "cancelled" })),
    "Cancelled",
  );
});

test("a leads-only campaign has no email step, and a run that is over has done all of its own steps", () => {
  const leadsOnly = searchStepsFor({ generateEmails: false });
  const withEmails = searchStepsFor({ generateEmails: true });
  assert.deepEqual(
    leadsOnly.map((step) => step.key),
    ["searching", "enriching", "scoring", "qualifying"],
  );
  assert.equal(withEmails.at(-1)?.key, "drafting");
  assert.equal(stepsDone(run(), leadsOnly), 4);
  assert.equal(stepsDone(run(), withEmails), 5);
  assert.equal(
    stepsDone(run({ status: "running", step: "qualifying" }), leadsOnly),
    3,
  );
  // Emails switched off while the search was already on its email step.
  assert.equal(
    stepsDone(run({ status: "running", step: "drafting" }), leadsOnly),
    3,
  );
});

test("steps done count from nothing, through the five stages, to all of them", () => {
  assert.equal(stepsDone(run({ status: "queued" })), -1);
  assert.equal(stepsDone(run({ status: "running", step: "searching" })), 0);
  assert.equal(stepsDone(run({ status: "running", step: "scoring" })), 2);
  assert.equal(stepsDone(run({ status: "running", step: "qualifying" })), 3);
  assert.equal(stepsDone(run({ status: "running", step: "drafting" })), 4);
  assert.equal(stepsDone(run()), 5);
});

test("the summary says what was found, in words, and the failure reason when it failed", () => {
  assert.equal(
    runSummary(run()),
    "Found 12 businesses; 1 looks like one BJH already has; 7 fit the campaign; 2 websites could not be read.",
  );
  assert.equal(
    runSummary(
      run({
        foundCount: 1,
        duplicateCount: 0,
        qualifiedCount: 1,
        failedCount: 0,
      }),
    ),
    "Found 1 business; 1 fits the campaign.",
  );
  assert.equal(
    runSummary(run({ duplicateCount: 3, failedCount: 1 })),
    "Found 12 businesses; 3 look like ones BJH already has; 7 fit the campaign; 1 website could not be read.",
  );
  assert.equal(
    runSummary(run({ status: "failed", errorMessage: "Apify is busy" })),
    "Apify is busy",
  );
  assert.equal(
    runSummary(run({ status: "failed", errorMessage: null })),
    "The search failed.",
  );
  assert.equal(runSummary(run({ status: "queued" })), "Waiting for its turn.");
  assert.equal(
    runSummary(run({ status: "cancelled", step: "cancelled", foundCount: 0 })),
    "Stopped before any businesses were found.",
  );
  // While the search is still out, there is no count to give.
  assert.equal(
    runSummary(run({ status: "running", step: "searching", foundCount: 0 })),
    "Looking for businesses…",
  );
  // Part-way through, only what is known so far.
  assert.equal(
    runSummary(
      run({ status: "running", step: "enriching", duplicateCount: 0 }),
    ),
    "Found 12 businesses.",
  );
});

test("words typed one per line or with commas become a clean list", () => {
  assert.deepEqual(parseWords("importers\n food importers ,importers,, \n"), [
    "importers",
    "food importers",
  ]);
  assert.deepEqual(parseWords("   "), []);
  assert.equal(joinWords(["a", "b"]), "a\nb");
});

test("the prospect query sends only what was chosen", () => {
  assert.equal(prospectQuery({}), "");
  assert.equal(prospectQuery({ search: "  " }), "");
  assert.equal(
    prospectQuery({ search: "ama & co", qualified: true, limit: 50 }),
    "?search=ama+%26+co&qualified=true&limit=50",
  );
  // false is a choice too, not "nothing".
  assert.equal(
    prospectQuery({ duplicate: false, promoted: false }),
    "?duplicate=false&promoted=false",
  );
  assert.equal(prospectQuery({ offset: 0 }), "");
  assert.equal(prospectQuery({ offset: 50 }), "?offset=50");
});

test("the score method says plainly when no AI was used", () => {
  assert.equal(scoreMethodLabel("ai"), "AI");
  assert.equal(scoreMethodLabel("rules"), "Simple rules");
  assert.equal(scoreMethodLabel(null), "Not scored");
});

test("a website is a link only when it is a plain web address", () => {
  assert.equal(
    safeWebUrl("https://shop.example/about"),
    "https://shop.example/about",
  );
  assert.equal(safeWebUrl("http://shop.example"), "http://shop.example/");
  for (const value of [
    "javascript:alert(1)",
    "data:text/html,<b>x</b>",
    "ftp://shop.example",
    "shop.example",
    "",
    null,
  ]) {
    assert.equal(safeWebUrl(value), null, String(value));
  }
});

test("a campaign lead says which campaign it came from, as a link only for those who may open it", () => {
  const found = {
    source: "campaign",
    campaignId: "c-1",
    campaignName: "Food importers in Accra",
  };
  assert.deepEqual(leadCampaignNote(found, true), {
    text: "Food importers in Accra",
    href: "/campaigns/c-1",
  });
  assert.deepEqual(leadCampaignNote(found, false), {
    text: "Food importers in Accra",
    href: null,
  });
  // The campaign was deleted: the lead stays, and says so.
  assert.deepEqual(
    leadCampaignNote(
      { source: "campaign", campaignId: null, campaignName: null },
      true,
    ),
    { text: "The campaign was deleted", href: null },
  );
  // Any other source has nothing to add.
  assert.equal(
    leadCampaignNote(
      { source: "walk_in", campaignId: null, campaignName: null },
      true,
    ),
    null,
  );
});

test("socialLinkGroups keeps every link per platform and drops what is not a web address", () => {
  assert.deepEqual(
    socialLinkGroups({
      instagram: ["https://instagram.com/a", "javascript:alert(1)"],
      facebook: ["https://facebook.com/a", "https://facebook.com/b"],
      tiktok: ["not a link"],
    }),
    [
      {
        platform: "Facebook",
        urls: ["https://facebook.com/a", "https://facebook.com/b"],
      },
      { platform: "Instagram", urls: ["https://instagram.com/a"] },
    ],
  );
  assert.deepEqual(socialLinkGroups({}), []);
});
