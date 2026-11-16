import assert from "node:assert/strict";
import test from "node:test";
import {
  expenseGroupLabel,
  expenseLabel,
  paymentMethodLabel,
  periodRange,
} from "./expenseLabels.ts";

const midNovember = new Date(2026, 10, 15);

test("periods are whole months and years in local time", () => {
  assert.deepEqual(periodRange("this_month", midNovember), {
    from: "2026-11-01",
    to: "2026-11-30",
  });
  assert.deepEqual(periodRange("last_3_months", midNovember), {
    from: "2026-09-01",
    to: "2026-11-30",
  });
  assert.deepEqual(periodRange("last_year", midNovember), {
    from: "2025-01-01",
    to: "2025-12-31",
  });
  assert.deepEqual(periodRange("all", midNovember), { from: "", to: "" });
  assert.equal(periodRange("custom", midNovember), null);
});

test("last month crosses into the previous year in January", () => {
  assert.deepEqual(periodRange("last_month", new Date(2027, 0, 10)), {
    from: "2026-12-01",
    to: "2026-12-31",
  });
  // February in a leap year ends on the 29th.
  assert.deepEqual(periodRange("this_month", new Date(2028, 1, 3)), {
    from: "2028-02-01",
    to: "2028-02-29",
  });
});

test("categories and methods read as words", () => {
  assert.equal(expenseLabel("fuel"), "Fuel");
  assert.equal(expenseGroupLabel("rent"), "Office and premises");
  assert.equal(paymentMethodLabel("mobile_money"), "Mobile money");
  assert.equal(expenseLabel("unknown_key"), "unknown_key");
});
