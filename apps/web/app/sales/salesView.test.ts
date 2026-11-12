import assert from "node:assert/strict";
import { test } from "node:test";
import {
  csvCell,
  draftChanged,
  draftOutcome,
  inGroups,
  poolToCsv,
  scoreTone,
} from "./salesView.ts";
import type { PoolProspect } from "./salesApi.ts";

/** All data below is synthetic. */
const row = (extra: Partial<PoolProspect> = {}): PoolProspect => ({
  id: "p1",
  campaignId: "c1",
  businessName: "Sample Foods Ltd",
  website: "https://sample.example",
  address: "1 Example Road, Accra",
  phones: ["+233200000001", "+233200000002"],
  emails: ["a@sample.example", "b@sample.example"],
  socialLinks: {
    facebook: ["https://facebook.com/sample"],
    instagram: ["https://instagram.com/sample"],
  },
  rating: 4.5,
  category: "Food importer",
  source: "stub",
  duplicateKind: null,
  duplicateReason: null,
  enrichmentStatus: "email_found",
  enrichmentError: null,
  score: 72,
  scoreReason: "A food importer, in Accra.",
  scoreMethod: "ai",
  promotedLeadId: null,
  campaignName: "Accra food",
  qualificationThreshold: 50,
  dismissedAt: null,
  draftStatus: null,
  ...extra,
});

test("a score is good from the campaign's line, middling within 15 below it, otherwise low", () => {
  assert.equal(scoreTone(50, 50), "good");
  assert.equal(scoreTone(49, 50), "mid");
  assert.equal(scoreTone(35, 50), "mid");
  assert.equal(scoreTone(34, 50), "low");
  assert.equal(scoreTone(null, 50), "none");
  assert.equal(scoreTone(60, 70), "mid");
});

test("a CSV cell is quoted when needed and cannot start a spreadsheet formula", () => {
  assert.equal(csvCell("plain"), "plain");
  assert.equal(csvCell("a, b"), '"a, b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell("line\nbreak"), '"line\nbreak"');
  assert.equal(csvCell(null), "");
  assert.equal(csvCell(4.5), "4.5");
  for (const dangerous of ["=1+1", "+1", "-1", "@SUM(A1)", "\tcmd"]) {
    assert.ok(csvCell(dangerous).startsWith("'"), dangerous);
  }
  assert.equal(csvCell('=HYPERLINK("x")'), `"'=HYPERLINK(""x"")"`);
});

test("the pool exports as CSV with a header and one line per business", () => {
  const csv = poolToCsv([
    row(),
    row({
      businessName: "=EVIL()",
      emails: [],
      score: null,
      scoreReason: null,
    }),
  ]);
  const lines = csv.trimEnd().split("\r\n");
  assert.equal(lines.length, 3);
  assert.match(lines[0], /^Business,Category,Address,Website,Emails/);
  assert.match(lines[1], /^Sample Foods Ltd,Food importer,/);
  assert.match(lines[1], /a@sample\.example; b@sample\.example/);
  assert.match(
    lines[1],
    /https:\/\/facebook\.com\/sample; https:\/\/instagram\.com\/sample/,
  );
  assert.match(lines[2], /^'=EVIL\(\)/);
  assert.ok(csv.endsWith("\r\n"));
});

test("what drafting did reads as one sentence", () => {
  assert.equal(draftOutcome(1, []), "Drafted 1 email.");
  assert.equal(draftOutcome(3, []), "Drafted 3 emails.");
  assert.equal(
    draftOutcome(2, [
      { businessName: "Acme", reason: "no_email" },
      { businessName: null, reason: "already_drafted" },
    ]),
    "Drafted 2 emails. Skipped 2: Acme has no email address; A business already has a draft.",
  );
  assert.match(
    draftOutcome(
      0,
      Array.from({ length: 5 }, (_, i) => ({
        businessName: `B${i}`,
        reason: "dismissed" as const,
      })),
    ),
    /Skipped 5: B0 was set aside; B1 was set aside; B2 was set aside and 2 more\.$/,
  );
});

test("a list is split into groups of at most the size", () => {
  assert.deepEqual(inGroups([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(inGroups([], 20), []);
});

test("a draft counts as changed only when its trimmed text differs", () => {
  const draft = { recipientEmail: "a@a.example", subject: "S", body: "B" };
  assert.equal(
    draftChanged(draft, {
      recipientEmail: " a@a.example ",
      subject: "S ",
      body: "B",
    }),
    false,
  );
  assert.equal(
    draftChanged(draft, {
      recipientEmail: "a@a.example",
      subject: "S2",
      body: "B",
    }),
    true,
  );
});
