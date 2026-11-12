import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  normalizeBusinessName,
  normalizeDomain,
  normalizePhoneKey,
} from "../src/leads/business-normalize";
import {
  BusinessSearchQuery,
  StubBusinessSearchProvider,
  mapPlace,
  processPlaces,
  searchTerms,
} from "../src/leads/business-search";

const query: BusinessSearchQuery = {
  industry: "retail importers",
  location: "Accra, Ghana",
  keywords: [],
  excludedKeywords: [],
  minRating: null,
  requireWebsite: false,
  maxResults: 50,
};

/** A place shaped like the Google Maps scraper's output, with synthetic values. */
const place = (overrides: Record<string, unknown> = {}) => ({
  title: "Synthetic Traders Ltd",
  placeId: "ChIJsynthetic1",
  address: "1 Synthetic Road, Accra",
  phone: "024 000 0001",
  phoneUnformatted: "+233240000001",
  website: "https://www.synthetic-traders.example/about?utm=1",
  totalScore: 4.45,
  categoryName: "Import company",
  ...overrides,
});

test("business names compare across punctuation, case and legal suffixes", () => {
  assert.equal(normalizeBusinessName("ACME Trading Ltd."), "acme trading");
  assert.equal(normalizeBusinessName("Acme Trading Limited"), "acme trading");
  assert.equal(normalizeBusinessName("Smith & Sons Co"), "smith and sons");
  assert.equal(normalizeBusinessName("  Ltd  "), "ltd", "never empties a name");
  assert.equal(normalizeBusinessName("!!!"), null);
  assert.equal(normalizeBusinessName(null), null);
});

test("a website becomes its host; social and page-builder hosts match nothing", () => {
  assert.equal(
    normalizeDomain("https://www.Synthetic-Traders.example/about?x=1"),
    "synthetic-traders.example",
  );
  assert.equal(normalizeDomain("synthetic.example"), "synthetic.example");
  assert.equal(normalizeDomain("https://www.facebook.com/synthetic"), null);
  assert.equal(normalizeDomain("https://m.facebook.com/synthetic"), null);
  assert.equal(normalizeDomain("https://synthetic.business.site"), null);
  assert.equal(normalizeDomain("ftp://synthetic.example"), null);
  assert.equal(normalizeDomain("not a url"), null);
  assert.equal(normalizeDomain(""), null);
});

test("phone keys match across Ghanaian spellings and keep other countries' digits", () => {
  const spellings = ["024 405 8592", "+233 24 405 8592", "233244058592"];
  for (const spelling of spellings) {
    assert.equal(normalizePhoneKey(spelling), "233244058592");
  }
  assert.equal(normalizePhoneKey("+44 20 7946 0958"), "442079460958");
  assert.equal(normalizePhoneKey("12345"), null);
  assert.equal(normalizePhoneKey(null), null);
});

test("a place is mapped to a prospect-shaped business", () => {
  const business = mapPlace(place(), "google_maps");
  assert.deepEqual(business, {
    businessName: "Synthetic Traders Ltd",
    website: "https://www.synthetic-traders.example/about?utm=1",
    address: "1 Synthetic Road, Accra",
    phones: ["+233240000001"],
    emails: [],
    socialLinks: {},
    rating: 4.5,
    category: "Import company",
    source: "google_maps",
    sourceId: "ChIJsynthetic1",
    normalizedName: "synthetic traders",
    normalizedDomain: "synthetic-traders.example",
    normalizedPhone: "233240000001",
  });
});

test("mapping tolerates missing fields and junk, and collects emails once", () => {
  const sparse = mapPlace({ name: "  Bare Minimum  " }, "stub");
  assert.equal(sparse?.businessName, "Bare Minimum");
  assert.equal(sparse?.website, null);
  assert.equal(sparse?.rating, null);
  assert.equal(sparse?.normalizedPhone, null);
  assert.deepEqual(sparse?.phones, []);

  assert.equal(mapPlace({ title: "   " }, "stub"), null);
  assert.equal(mapPlace({ title: "!!!" }, "stub"), null);
  assert.equal(mapPlace(null, "stub"), null);
  assert.equal(mapPlace("a string", "stub"), null);

  const withEmails = mapPlace(
    place({
      email: "Info@Synthetic-Traders.example",
      emails: ["info@synthetic-traders.example", "not-an-email", 7],
    }),
    "stub",
  );
  assert.deepEqual(withEmails?.emails, ["info@synthetic-traders.example"]);

  // The same number written two ways is kept once, in its international form.
  assert.deepEqual(mapPlace(place({ phone: "0240000001" }), "stub")?.phones, [
    "+233240000001",
  ]);
  // A website that is not an address is not kept as one.
  assert.equal(mapPlace(place({ website: "call us" }), "stub")?.website, null);
  // The rating fits the column: one decimal, 0 to 5.
  assert.equal(mapPlace(place({ totalScore: 7 }), "stub")?.rating, 5);
  assert.equal(mapPlace(place({ totalScore: "4.5" }), "stub")?.rating, null);
});

test("the filters reject closed places, missing websites, low ratings and exclusions, and count each", () => {
  const places = [
    place({ title: "Keeper One" }),
    place({ title: "Closed Shop", permanentlyClosed: true }),
    place({ title: "Paused Shop", temporarilyClosed: true }),
    place({ title: "No Site", website: undefined }),
    place({ title: "Low Rated", totalScore: 3.1 }),
    place({ title: "Unrated", totalScore: undefined }),
    place({ title: "Big Bank Branch", categoryName: "Bank" }),
    place({ title: "Described", description: "We are a Freight forwarder" }),
    { title: "   " },
    place({ title: "Keeper Two" }),
  ];
  const results = processPlaces(
    places,
    {
      ...query,
      requireWebsite: true,
      minRating: 4,
      excludedKeywords: ["bank", " FREIGHT FORWARDER ", ""],
    },
    "google_maps",
  );
  assert.deepEqual(
    results.businesses.map((business) => business.businessName),
    ["Keeper One", "Keeper Two"],
  );
  assert.equal(results.rawCount, 10);
  assert.deepEqual(results.rejected, {
    closed: 2,
    missing_website: 1,
    below_min_rating: 2,
    excluded_keyword: 2,
    unusable: 1,
  });
});

test("with no filters set everything usable is kept, up to the limit", () => {
  const places = Array.from({ length: 5 }, (_, index) =>
    place({
      title: `Place ${index}`,
      placeId: `id-${index}`,
      website: undefined,
    }),
  );
  const all = processPlaces(places, query, "stub");
  assert.equal(all.businesses.length, 5);
  assert.deepEqual(all.rejected, {});

  const capped = processPlaces(places, { ...query, maxResults: 3 }, "stub");
  assert.deepEqual(
    capped.businesses.map((business) => business.businessName),
    ["Place 0", "Place 1", "Place 2"],
  );
  assert.equal(capped.rawCount, 5);
});

test("the search terms are the keywords, or the industry when there are none", () => {
  assert.deepEqual(searchTerms(query), ["retail importers"]);
  assert.deepEqual(
    searchTerms({ ...query, keywords: [" cocoa exporters ", "", "shea"] }),
    ["cocoa exporters", "shea"],
  );
});

test("the stub searches in three steps and returns synthetic businesses only", async () => {
  const stub = new StubBusinessSearchProvider();
  stub.pendingPolls = 2;
  const { providerRunId } = await stub.start(query);
  assert.deepEqual(await stub.poll(providerRunId), { state: "running" });
  assert.deepEqual(await stub.poll(providerRunId), { state: "running" });
  const progress = await stub.poll(providerRunId);
  assert.equal(progress.state, "succeeded");
  if (progress.state !== "succeeded") return;

  const results = await stub.fetchResults(progress.datasetId, {
    ...query,
    requireWebsite: true,
    minRating: 4,
    excludedKeywords: ["bank"],
    maxResults: 10,
  });
  // Strict filters leave fewer than asked for, as a real search can.
  assert.ok(results.businesses.length > 0 && results.businesses.length <= 10);
  assert.equal(
    results.businesses.length +
      Object.values(results.rejected).reduce((sum, count) => sum + count, 0),
    results.rawCount,
    "every place is either kept or counted as rejected",
  );
  assert.ok(results.businesses.every((business) => business.source === "stub"));
  assert.ok(
    results.businesses.every((business) => business.website !== null),
    "the website rule applies to stub results too",
  );
  const rejected = results.rejected;
  assert.ok((rejected.missing_website ?? 0) > 0);
  assert.ok((rejected.below_min_rating ?? 0) > 0);
  assert.ok((rejected.closed ?? 0) > 0);
  assert.ok((rejected.excluded_keyword ?? 0) > 0);
  const ids = results.businesses.map((business) => business.sourceId);
  assert.equal(new Set(ids).size, ids.length, "place ids are unique");
});

test("the stub can be told to fail, for the run pipeline's failure path", async () => {
  const stub = new StubBusinessSearchProvider();
  stub.failWith = "Synthetic search failed";
  const { providerRunId } = await stub.start(query);
  assert.deepEqual(await stub.poll(providerRunId), {
    state: "failed",
    message: "Synthetic search failed",
  });

  stub.failStartWith = "Synthetic start failed";
  await assert.rejects(stub.start(query), /Synthetic start failed/);
});
