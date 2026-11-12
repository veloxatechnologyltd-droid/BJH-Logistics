import assert from "node:assert/strict";
import test from "node:test";
import { describeAction, describeResult } from "./activityLabels.ts";

test("known routes read as plain sentences", () => {
  assert.equal(
    describeAction("GET", "/api/v1/team-chat/unread"),
    "Checked for new team chat messages",
  );
  assert.equal(
    describeAction("POST", "/api/v1/jobs/:id/milestones"),
    "Recorded a milestone on a job",
  );
});

test("unknown routes fall back to a readable phrase, never the raw path", () => {
  assert.equal(
    describeAction("GET", "/api/v1/new-things/:id"),
    "Viewed new things",
  );
  assert.equal(
    describeAction("GET", "(unmatched)"),
    "Visited a page that does not exist",
  );
});

test("results are words, and denied attempts are flagged", () => {
  assert.deepEqual(describeResult(200), { text: "Done", failed: false });
  assert.deepEqual(describeResult(304), { text: "Done", failed: false });
  assert.deepEqual(describeResult(403), { text: "Not allowed", failed: true });
});
