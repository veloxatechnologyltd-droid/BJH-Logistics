import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeEmailDomain } from "../src/leads/business-normalize";
import { mapPlace } from "../src/leads/business-search";
import {
  KnownBusinessRow,
  checkDuplicates,
} from "../src/leads/duplicate-check";

/** A found business, built the way a search builds it. */
function found(overrides: Record<string, unknown> = {}) {
  const business = mapPlace(
    {
      title: "Synthetic Traders Ltd",
      placeId: "place-1",
      website: "https://www.synthetic-traders.example",
      phoneUnformatted: "+233240000001",
      ...overrides,
    },
    "google_maps",
  );
  assert.ok(business);
  return business;
}

const row = (overrides: Partial<KnownBusinessRow>): KnownBusinessRow => ({
  kind: "customer",
  id: "known-1",
  label: "Known Ltd",
  names: [],
  websites: [],
  emails: [],
  phones: [],
  source: null,
  sourceId: null,
  ...overrides,
});

const verdictOf = (
  business: ReturnType<typeof found>,
  rows: KnownBusinessRow[],
) => checkDuplicates([{ id: "new-1", business }], rows).get("new-1");

test("a business nobody holds is unique", () => {
  assert.deepEqual(verdictOf(found(), []), { outcome: "unique" });
  assert.deepEqual(
    verdictOf(found(), [
      row({ names: ["Other Co"], websites: ["https://other.example"] }),
    ]),
    { outcome: "unique" },
  );
});

test("the same website as a customer is flagged, with the customer named", () => {
  const verdict = verdictOf(found(), [
    row({
      id: "customer-1",
      label: "Synthetic Traders Limited",
      names: ["Totally Different Name"],
      websites: ["synthetic-traders.example/contact"],
    }),
  ]);
  assert.deepEqual(verdict, {
    outcome: "flagged",
    kind: "customer",
    ref: "customer-1",
    strength: "strong",
    reason:
      "Same website (synthetic-traders.example) as customer Synthetic Traders Limited",
  });
});

test("a business email domain counts as the website, a free mailbox does not", () => {
  const byEmail = verdictOf(found(), [
    row({
      kind: "lead",
      id: "lead-1",
      emails: ["pat@synthetic-traders.example"],
    }),
  ]);
  assert.equal(byEmail?.outcome, "flagged");
  assert.equal(byEmail?.outcome === "flagged" && byEmail.kind, "lead");

  const free = verdictOf(found({ website: "https://gmail.com" }), [
    row({ kind: "lead", emails: ["someone@gmail.com"] }),
  ]);
  assert.deepEqual(free, { outcome: "unique" });
  assert.equal(normalizeEmailDomain("a@Gmail.com"), null);
  assert.equal(normalizeEmailDomain("a@acme.com"), "acme.com");
  assert.equal(normalizeEmailDomain("not-an-email"), null);
});

test("the same phone number matches across spellings, on any of a customer's contacts", () => {
  const verdict = verdictOf(found({ website: undefined }), [
    row({ id: "customer-2", phones: ["024 000 0001"] }),
  ]);
  assert.equal(verdict?.outcome === "flagged" && verdict.strength, "strong");
  assert.match(
    verdict?.outcome === "flagged" ? verdict.reason : "",
    /^Same phone number as customer/,
  );
});

test("a name-only match is flagged as weaker, ignoring legal suffixes and trading names", () => {
  const verdict = verdictOf(
    found({ website: undefined, phoneUnformatted: undefined }),
    [
      row({
        id: "customer-3",
        label: "Synthetic Holdings",
        names: ["Synthetic Holdings", "SYNTHETIC TRADERS Limited."],
      }),
    ],
  );
  assert.deepEqual(verdict, {
    outcome: "flagged",
    kind: "customer",
    ref: "customer-3",
    strength: "name",
    reason: "Same business name as customer Synthetic Holdings",
  });
});

test("the strongest match wins, then customer over lead over prospect", () => {
  const nameOnCustomer = row({
    id: "customer-1",
    names: ["Synthetic Traders"],
  });
  const websiteOnLead = row({
    kind: "lead",
    id: "lead-1",
    emails: ["x@synthetic-traders.example"],
  });
  const websiteOnCustomer = row({
    id: "customer-2",
    websites: ["synthetic-traders.example"],
  });
  const websiteOnProspect = row({
    kind: "prospect",
    id: "prospect-1",
    websites: ["synthetic-traders.example"],
    source: "google_maps",
    sourceId: "other-place",
  });

  const ref = (rows: KnownBusinessRow[]) => {
    const verdict = verdictOf(found(), rows);
    return verdict?.outcome === "flagged" ? verdict.ref : null;
  };
  assert.equal(ref([nameOnCustomer, websiteOnLead]), "lead-1");
  assert.equal(ref([websiteOnLead, websiteOnCustomer]), "customer-2");
  assert.equal(ref([websiteOnProspect, websiteOnLead]), "lead-1");
  assert.equal(ref([websiteOnProspect, nameOnCustomer]), "prospect-1");
});

test("the same place of the campaign is not stored twice, but a flagged one is kept", () => {
  const stored = row({
    kind: "prospect",
    id: "prospect-1",
    names: ["Synthetic Traders Ltd"],
    source: "google_maps",
    sourceId: "place-1",
  });
  assert.deepEqual(verdictOf(found(), [stored]), {
    outcome: "already_found",
    ref: "prospect-1",
  });
  // The same id from the stub is a different place, not the same one.
  assert.notEqual(
    verdictOf(
      mapPlace({ title: "Synthetic Traders Ltd", placeId: "place-1" }, "stub")!,
      [stored],
    )?.outcome,
    "already_found",
  );
  // A branch on the same website, with its own place id, is kept and flagged.
  const branch = verdictOf(found({ placeId: "place-2" }), [stored]);
  assert.equal(branch?.outcome, "flagged");
});

test("businesses in one batch are checked against each other, and none is dropped", () => {
  const batch = [
    {
      id: "a",
      business: found({
        title: "Alpha Ltd",
        placeId: "p-a",
        website: "https://alpha.example",
        phoneUnformatted: "+233240000010",
      }),
    },
    {
      id: "b",
      business: found({
        title: "Alpha Tema Branch",
        placeId: "p-b",
        website: "https://alpha.example/tema",
        phoneUnformatted: "+233240000011",
      }),
    },
    {
      id: "c",
      business: found({
        title: "Alpha Ltd",
        placeId: "p-a",
        website: "https://alpha.example",
        phoneUnformatted: "+233240000010",
      }),
    },
    {
      id: "d",
      business: found({
        title: "Gamma Ltd",
        placeId: "p-d",
        website: "https://gamma.example",
        phoneUnformatted: "+233240000012",
      }),
    },
  ];
  const verdicts = checkDuplicates(batch, []);
  assert.equal(verdicts.size, 4);
  assert.deepEqual(verdicts.get("a"), { outcome: "unique" });
  assert.deepEqual(verdicts.get("b"), {
    outcome: "flagged",
    kind: "prospect",
    ref: "a",
    strength: "strong",
    reason:
      "Same website (alpha.example) as prospect in this campaign Alpha Ltd",
  });
  assert.deepEqual(verdicts.get("c"), { outcome: "already_found", ref: "a" });
  assert.deepEqual(verdicts.get("d"), { outcome: "unique" });
});

test("social pages and shared hosts never make two businesses the same", () => {
  const verdict = verdictOf(
    found({
      title: "Fresh Co",
      website: "https://www.facebook.com/freshco",
      phoneUnformatted: undefined,
    }),
    [
      row({
        names: ["Other Co"],
        websites: ["https://facebook.com/otherco"],
        emails: ["other@gmail.com"],
      }),
    ],
  );
  assert.deepEqual(verdict, { outcome: "unique" });
});

test("a flag's reason fits the column", () => {
  const long = "Very Long Name ".repeat(13).trim();
  const verdict = verdictOf(
    found({ website: undefined, phoneUnformatted: undefined, title: long }),
    [row({ names: [long], label: long })],
  );
  assert.equal(verdict?.outcome, "flagged");
  assert.ok(
    verdict?.outcome === "flagged" && verdict.reason.length <= 300,
    "reason is at most 300 characters",
  );
});
