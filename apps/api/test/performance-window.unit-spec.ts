import assert from "node:assert/strict";
import { test } from "node:test";
import { performanceWindow } from "../src/performance/performance-metrics";

const now = new Date("2026-11-16T10:00:00Z");

test("a period is compared with the equal period just before it", () => {
  const day = performanceWindow("2026-11-16", "2026-11-16", now);
  assert.deepEqual(
    [day.previousFrom, day.previousTo, day.start, day.end, day.previousStart],
    [
      "2026-11-15",
      "2026-11-15",
      "2026-11-16T00:00:00.000Z",
      "2026-11-17T00:00:00.000Z",
      "2026-11-15T00:00:00.000Z",
    ],
  );
  const month = performanceWindow("2026-10-01", "2026-10-31", now);
  assert.deepEqual(
    [month.previousFrom, month.previousTo],
    ["2026-08-31", "2026-09-30"],
  );
});

test("without dates it is this month so far", () => {
  const period = performanceWindow(undefined, undefined, now);
  assert.equal(period.from, "2026-11-01");
  assert.equal(period.to, "2026-11-16");
});

test("bad periods are refused", () => {
  for (const [from, to] of [
    ["2026-11-16", undefined],
    ["2026-13-01", "2026-13-02"],
    ["2026-02-30", "2026-03-01"],
    ["2026-11-17", "2026-11-16"],
    ["2025-01-01", "2026-11-16"],
    ["16/11/2026", "16/11/2026"],
  ]) {
    assert.throws(() => performanceWindow(from, to, now), `${from}..${to}`);
  }
});
