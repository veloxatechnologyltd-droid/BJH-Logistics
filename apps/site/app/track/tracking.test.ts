import assert from "node:assert/strict";
import { test } from "node:test";
import { formatGhanaTime, trackingEndpoint } from "./tracking.ts";

test("the lookup address carries what was typed, safely encoded", () => {
  assert.equal(
    trackingEndpoint("  BJH-ABCD-2345 "),
    "http://127.0.0.1:3001/api/v1/track/BJH-ABCD-2345",
  );
  assert.equal(
    trackingEndpoint("../jobs?x=1"),
    "http://127.0.0.1:3001/api/v1/track/..%2Fjobs%3Fx%3D1",
  );
});

test("times are shown in Ghana time", () => {
  assert.equal(
    formatGhanaTime("2026-10-05T08:00:00.000Z"),
    "5 Oct 2026, 08:00 (Ghana time)",
  );
});
