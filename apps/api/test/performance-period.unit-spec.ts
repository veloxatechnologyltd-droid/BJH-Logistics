import assert from "node:assert/strict";
import { test } from "node:test";
import {
  monthRange,
  reportPeriod,
} from "../src/performance/performance.service";

test("a daily report covers today only", () => {
  assert.deepEqual(reportPeriod("daily", new Date("2026-11-18T09:30:00Z")), {
    start: "2026-11-18",
    through: "2026-11-18",
  });
});

test("a weekly report runs from Monday through today", () => {
  // 2026-11-16 is a Monday.
  const cases: Array<[string, string]> = [
    ["2026-11-16T00:00:00Z", "2026-11-16"], // Monday itself
    ["2026-11-18T23:59:59Z", "2026-11-16"], // midweek, last second of the day
    ["2026-11-22T12:00:00Z", "2026-11-16"], // Sunday belongs to that week
    ["2026-11-23T00:00:00Z", "2026-11-23"], // the next Monday starts a new week
    ["2027-01-01T08:00:00Z", "2026-12-28"], // across the year end
  ];
  for (const [now, monday] of cases) {
    const period = reportPeriod("weekly", new Date(now));
    assert.equal(period.start, monday, now);
    assert.equal(period.through, now.slice(0, 10), now);
  }
});

test("a month runs from its first day to its last, or to today", () => {
  const now = new Date("2026-11-16T10:00:00Z");
  assert.deepEqual(monthRange("2026-11", now), {
    month: "2026-11",
    from: "2026-11-01",
    to: "2026-11-30",
    through: "2026-11-16",
  });
  assert.equal(monthRange("2024-02", now).through, "2024-02-29");
  assert.equal(monthRange(undefined, now).month, "2026-11");
  assert.throws(() => monthRange("2026-12", now));
  assert.throws(() => monthRange("2026-1", now));
});
