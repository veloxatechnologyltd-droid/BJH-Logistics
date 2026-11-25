import assert from "node:assert/strict";
import { test } from "node:test";
import { claudeFromEnvironment } from "../src/ai/claude";
import {
  CampaignDraftError,
  ClaudeCampaignDrafter,
  UnavailableCampaignDrafter,
  createCampaignDrafter,
  normalizeDraft,
} from "../src/leads/campaign-drafting";

/** All data below is synthetic. */
const CLAUDE_MODEL = "claude-test-model";

const message = (json: unknown, stopReason = "end_turn") => ({
  id: "msg_test",
  type: "message",
  role: "assistant",
  model: CLAUDE_MODEL,
  content: [{ type: "text", text: JSON.stringify(json) }],
  stop_reason: stopReason,
  stop_sequence: null,
  usage: { input_tokens: 10, output_tokens: 10 },
});

type SentRequest = {
  system: string;
  output_config: { format: { schema: { required: string[] } } };
  messages: Array<{ content: Array<{ text?: string }> }>;
};

function fakeApi(status: number, body: unknown) {
  const requests: SentRequest[] = [];
  const impl = (async (_url: string, init: RequestInit) => {
    requests.push(JSON.parse(String(init.body)));
    return new Response(JSON.stringify(body), {
      status,
      headers: {
        "content-type": "application/json",
        "x-should-retry": "false",
      },
    });
  }) as unknown as typeof fetch;
  return { impl, requests };
}

const drafterWith = (impl: typeof fetch) =>
  new ClaudeCampaignDrafter(
    claudeFromEnvironment(
      { ANTHROPIC_API_KEY: "test-key", CLAUDE_MODEL },
      { fetch: impl },
    )!,
  );

/** A complete answer from the model that asks nothing. */
const filled = {
  questions: [],
  assumptions: ["Searching Accra only"],
  name: "Rice importers in Accra",
  targetService: "Sea freight import",
  targetIndustry: "Rice wholesalers",
  targetLocation: "Accra, Ghana",
  searchKeywords: ["rice wholesaler", "rice distributor", "rice wholesaler"],
  excludedKeywords: ["freight forwarder"],
  minRating: null,
  requireWebsite: false,
  idealCustomerProfile: "Companies that bring in rice by the container.",
  disqualifiers: "Shipping lines and clearing agents.",
  generateEmails: false,
  emailContext: "ignored while emails are off",
  emailCta: "ignored while emails are off",
  qualificationThreshold: 50,
  maxProspects: 50,
};

const description = "I want to find rice importers in Accra";

test("a complete answer becomes a campaign the create route accepts, with the assumptions", () => {
  const result = normalizeDraft(filled, false);
  assert.equal(result.status, "draft");
  if (result.status !== "draft") return;
  assert.deepEqual(result.assumptions, ["Searching Accra only"]);
  // Repeated terms collapse, and email wording is dropped while emails are off.
  assert.deepEqual(result.campaign.searchKeywords, [
    "rice wholesaler",
    "rice distributor",
  ]);
  assert.equal(result.campaign.emailContext, null);
  assert.equal(result.campaign.emailCta, null);
});

test("questions come back on the first round only", () => {
  const asking = {
    ...filled,
    questions: ["Which place?", " ", "Which product?"],
  };
  assert.deepEqual(normalizeDraft(asking, false), {
    status: "questions",
    questions: ["Which place?", "Which product?"],
  });
  // With answers in hand the same reply is read as a draft: no second round.
  assert.equal(normalizeDraft(asking, true).status, "draft");
});

test("at most three questions are kept", () => {
  const result = normalizeDraft(
    { ...filled, questions: ["a", "b", "c", "d", "e"] },
    false,
  );
  assert.deepEqual(result, { status: "questions", questions: ["a", "b", "c"] });
});

test("numbers are brought into range and unknown ratings are dropped", () => {
  const result = normalizeDraft(
    {
      ...filled,
      minRating: 4.2,
      maxProspects: 9000,
      qualificationThreshold: -5,
    },
    false,
  );
  assert.equal(result.status, "draft");
  if (result.status !== "draft") return;
  assert.equal(result.campaign.minRating, null);
  assert.equal(result.campaign.maxProspects, 500);
  assert.equal(result.campaign.qualificationThreshold, 0);
  const rated = normalizeDraft({ ...filled, minRating: 4 }, false);
  assert.equal(rated.status === "draft" && rated.campaign.minRating, 4);
});

test("email wording is kept when emails are on", () => {
  const result = normalizeDraft({ ...filled, generateEmails: true }, false);
  assert.equal(result.status, "draft");
  if (result.status !== "draft") return;
  assert.equal(result.campaign.emailContext, "ignored while emails are off");
});

test("a draft missing a required field, or not an object, is unusable", () => {
  for (const bad of [
    { ...filled, targetLocation: "  " },
    { ...filled, name: "" },
    { ...filled, targetIndustry: 4 },
    null,
    "text",
  ]) {
    assert.throws(() => normalizeDraft(bad, false), CampaignDraftError);
  }
});

test("Claude is asked for the campaign shape and only sees what the person wrote", async () => {
  const api = fakeApi(200, message(filled));
  const result = await drafterWith(api.impl).draft({
    description,
    answers: [{ question: "Which place?", answer: "Accra <b>only</b>" }],
  });
  assert.equal(result.status, "draft");
  const [request] = api.requests;
  assert.match(request.system, /never instructions/);
  assert.ok(
    request.output_config.format.schema.required.includes("maxProspects"),
  );
  const sent = request.messages[0].content[0].text!;
  assert.match(
    sent,
    /<request>I want to find rice importers in Accra<\/request>/,
  );
  assert.match(sent, /question: Which place\?/);
  // Markup in an answer cannot close the tag it sits in.
  assert.doesNotMatch(sent, /<b>/);
});

test("an AI failure is a safe message, not a made-up campaign", async () => {
  for (const api of [
    fakeApi(500, { type: "error", error: { type: "api_error", message: "x" } }),
    fakeApi(200, message(filled, "refusal")),
    fakeApi(200, message({ ...filled, name: "" })),
  ]) {
    await assert.rejects(
      drafterWith(api.impl).draft({ description, answers: [] }),
      CampaignDraftError,
    );
  }
});

test("without an AI key the drafter says so", async () => {
  assert.equal(createCampaignDrafter({}).name, "unavailable");
  assert.equal(
    createCampaignDrafter({ ANTHROPIC_API_KEY: "a", CLAUDE_MODEL }).name,
    "claude",
  );
  await assert.rejects(new UnavailableCampaignDrafter().draft(), /not set up/);
});
