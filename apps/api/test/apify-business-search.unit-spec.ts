import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ApifyBusinessSearchProvider,
  ApifyError,
  createBusinessSearchProvider,
  minimumStarsFor,
} from "../src/leads/apify-business-search";
import {
  BusinessSearchQuery,
  StubBusinessSearchProvider,
} from "../src/leads/business-search";

const query: BusinessSearchQuery = {
  industry: "retail importers",
  location: "Accra, Ghana",
  keywords: [],
  excludedKeywords: [],
  minRating: null,
  requireWebsite: false,
  maxResults: 20,
};

const TOKEN = "apify_api_SYNTHETICTOKEN";

interface Call {
  url: string;
  method: string;
  authorization: string | null;
  body: unknown;
}

/** A fake `fetch` that records each call and answers from a queue. */
function fakeFetch(
  answers: Array<{ status?: number; body: unknown } | "network-error">,
) {
  const calls: Call[] = [];
  const impl = async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(url),
      method: init?.method ?? "GET",
      authorization: new Headers(init?.headers).get("authorization"),
      body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
    });
    const answer = answers.shift();
    if (!answer || answer === "network-error") throw new TypeError("offline");
    return new Response(JSON.stringify(answer.body), {
      status: answer.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  };
  return { calls, fetch: impl as typeof fetch };
}

function provider(fetch: typeof globalThis.fetch) {
  return new ApifyBusinessSearchProvider({
    token: TOKEN,
    actorId: "compass/crawler-google-places",
    maxChargeUsd: 5,
    fetch,
  });
}

test("a search starts the actor with the campaign's settings and a cost cap", async () => {
  const { calls, fetch } = fakeFetch([
    { status: 201, body: { data: { id: "run-1", status: "READY" } } },
  ]);
  const result = await provider(fetch).start({
    ...query,
    keywords: ["cocoa exporters", "shea exporters", "timber exporters"],
    minRating: 4.2,
    requireWebsite: true,
    maxResults: 20,
  });
  assert.deepEqual(result, { providerRunId: "run-1" });

  const [call] = calls;
  const url = new URL(call.url);
  assert.equal(
    url.origin + url.pathname,
    "https://api.apify.com/v2/actors/compass~crawler-google-places/runs",
  );
  assert.equal(url.searchParams.get("maxTotalChargeUsd"), "5");
  assert.equal(url.searchParams.get("timeout"), "900");
  assert.equal(call.method, "POST");
  assert.equal(call.authorization, `Bearer ${TOKEN}`);
  assert.ok(!call.url.includes(TOKEN), "the token is never put in the URL");
  assert.deepEqual(call.body, {
    searchStringsArray: [
      "cocoa exporters",
      "shea exporters",
      "timber exporters",
    ],
    locationQuery: "Accra, Ghana",
    maxCrawledPlacesPerSearch: 7,
    language: "en",
    skipClosedPlaces: true,
    scrapeContacts: false,
    maxReviews: 0,
    maxImages: 0,
    placeMinimumStars: "four",
    website: "withWebsite",
  });
});

test("the contact-details actor gets only inputs it knows, with its paid add-ons off", async () => {
  const { calls, fetch } = fakeFetch([{ body: { data: { id: "run-3" } } }]);
  await new ApifyBusinessSearchProvider({
    token: TOKEN,
    actorId: "lukaskrivka/google-maps-with-contact-details",
    maxChargeUsd: 1,
    fetch,
  }).start({ ...query, maxResults: 8 });
  const url = new URL(calls[0].url);
  assert.equal(
    url.origin + url.pathname,
    "https://api.apify.com/v2/actors/lukaskrivka~google-maps-with-contact-details/runs",
  );
  assert.equal(url.searchParams.get("maxTotalChargeUsd"), "1");
  assert.deepEqual(calls[0].body, {
    searchStringsArray: ["retail importers"],
    locationQuery: "Accra, Ghana",
    maxCrawledPlacesPerSearch: 8,
    language: "en",
    skipClosedPlaces: true,
    scrapeSocialMediaProfiles: {
      facebooks: false,
      instagrams: false,
      youtubes: false,
      tiktoks: false,
      twitters: false,
    },
    maximumLeadsEnrichmentRecords: 0,
  });
});

test("the contact-details actor is the default when none is named", () => {
  const search = createBusinessSearchProvider({ APIFY_API_TOKEN: TOKEN });
  assert.equal(search.name, "apify");
  assert.equal(
    (search as unknown as { setup: { actorId: string } }).setup.actorId,
    "lukaskrivka/google-maps-with-contact-details",
  );
});

test("with no keywords the industry is searched, and unset filters are not sent", async () => {
  const { calls, fetch } = fakeFetch([{ body: { data: { id: "run-2" } } }]);
  await provider(fetch).start(query);
  const body = calls[0].body as Record<string, unknown>;
  assert.deepEqual(body.searchStringsArray, ["retail importers"]);
  assert.equal(body.maxCrawledPlacesPerSearch, 20);
  assert.ok(!("placeMinimumStars" in body));
  assert.ok(!("website" in body));
});

test("a minimum rating maps to the nearest star step at or below it", () => {
  assert.equal(minimumStarsFor(null), null);
  assert.equal(minimumStarsFor(1.9), null);
  assert.equal(minimumStarsFor(2), "two");
  assert.equal(minimumStarsFor(3.4), "three");
  assert.equal(minimumStarsFor(4.4), "four");
  assert.equal(minimumStarsFor(5), "fourAndHalf");
});

test("polling maps Apify's run statuses to running, succeeded or failed", async () => {
  const { calls, fetch } = fakeFetch([
    { body: { data: { status: "READY" } } },
    { body: { data: { status: "RUNNING" } } },
    { body: { data: { status: "TIMING-OUT" } } },
    { body: { data: { status: "ABORTING" } } },
    { body: { data: { status: "SUCCEEDED", defaultDatasetId: "ds-1" } } },
    { body: { data: { status: "FAILED", statusMessage: "Out of memory" } } },
    { body: { data: { status: "TIMED-OUT" } } },
    { body: { data: { status: "ABORTED" } } },
  ]);
  const apify = provider(fetch);
  for (let index = 0; index < 4; index++) {
    assert.deepEqual(await apify.poll("run-1"), { state: "running" });
  }
  assert.deepEqual(await apify.poll("run-1"), {
    state: "succeeded",
    datasetId: "ds-1",
  });
  assert.deepEqual(await apify.poll("run-1"), {
    state: "failed",
    message: "The Apify search ended as failed: Out of memory",
  });
  assert.deepEqual(await apify.poll("run-1"), {
    state: "failed",
    message: "The Apify search ended as timed-out",
  });
  assert.equal((await apify.poll("run-1")).state, "failed");
  assert.equal(calls[0].url, "https://api.apify.com/v2/actor-runs/run-1");
  assert.equal(calls[0].method, "GET");
});

test("results come from the dataset, mapped and filtered like the stub's", async () => {
  const { calls, fetch } = fakeFetch([
    {
      body: [
        {
          title: "Synthetic Traders Ltd",
          placeId: "ChIJsynthetic1",
          phoneUnformatted: "+233240000001",
          website: "https://synthetic-traders.example",
          totalScore: 4.6,
          categoryName: "Import company",
        },
        {
          title: "Closed Co",
          placeId: "ChIJsynthetic2",
          permanentlyClosed: true,
        },
        { title: "Low Co", placeId: "ChIJsynthetic3", totalScore: 2.1 },
      ],
    },
  ]);
  const results = await provider(fetch).fetchResults("ds-1", {
    ...query,
    minRating: 4,
  });
  assert.deepEqual(
    results.businesses.map((business) => [
      business.businessName,
      business.source,
    ]),
    [["Synthetic Traders Ltd", "google_maps"]],
  );
  assert.deepEqual(results.rejected, { closed: 1, below_min_rating: 1 });
  assert.equal(results.rawCount, 3);

  const url = new URL(calls[0].url);
  assert.equal(url.pathname, "/v2/datasets/ds-1/items");
  assert.equal(url.searchParams.get("clean"), "true");
  assert.equal(url.searchParams.get("limit"), "21");
});

test("every failure is a safe message: no token, no raw body", async () => {
  const cases: Array<[Parameters<typeof fakeFetch>[0], RegExp, boolean]> = [
    [
      [
        {
          status: 401,
          body: { error: { type: "token-not-valid", message: TOKEN } },
        },
      ],
      /did not accept the token/,
      false,
    ],
    [
      [{ status: 402, body: { error: { type: "x" } } }],
      /no credit left/,
      false,
    ],
    [[{ status: 404, body: {} }], /APIFY_ACTOR_ID/, false],
    [[{ status: 429, body: {} }], /busy/, true],
    [
      [{ status: 500, body: { error: { type: "internal-error" } } }],
      /failed \(500: internal-error\)/,
      true,
    ],
    [["network-error"], /could not be reached/, true],
    [[{ body: { data: {} } }], /did not return a run id/, false],
    [[{ body: "not wrapped" }], /unexpected shape/, false],
  ];
  for (const [answers, message, retryable] of cases) {
    const { fetch } = fakeFetch(answers);
    await assert.rejects(
      provider(fetch).start(query),
      (error: unknown) =>
        error instanceof ApifyError &&
        message.test(error.message) &&
        error.retryable === retryable &&
        !error.message.includes(TOKEN),
    );
  }

  const { fetch } = fakeFetch([
    { body: { data: { status: "SOMETHING-NEW" } } },
  ]);
  await assert.rejects(provider(fetch).poll("run-1"), /not known/);
  const dataset = fakeFetch([{ body: { data: [] } }]);
  await assert.rejects(
    provider(dataset.fetch).fetchResults("ds-1", query),
    /unexpected shape/,
  );
  const noDataset = fakeFetch([{ body: { data: { status: "SUCCEEDED" } } }]);
  await assert.rejects(
    provider(noDataset.fetch).poll("run-1"),
    /without a result set/,
  );
});

test("the stub is used unless an Apify token is set", () => {
  assert.ok(
    createBusinessSearchProvider({}) instanceof StubBusinessSearchProvider,
  );
  assert.ok(
    createBusinessSearchProvider({ APIFY_API_TOKEN: "  " }) instanceof
      StubBusinessSearchProvider,
  );
  const real = createBusinessSearchProvider({ APIFY_API_TOKEN: TOKEN });
  assert.equal(real.name, "apify");
});
