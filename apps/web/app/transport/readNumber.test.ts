import assert from "node:assert/strict";
import { test } from "node:test";
import { readNumber } from "./readNumber.ts";

test("reads figures written with commas, spaces and units", () => {
  assert.equal(readNumber("1,250.5"), 1250.5);
  assert.equal(readNumber("1 250 kg"), 1250);
  assert.equal(readNumber("500kgs"), 500);
  assert.equal(readNumber("12 pcs"), 12);
  assert.equal(readNumber(" 40 "), 40);
});

test("an empty box is no value, anything else unreadable is NaN", () => {
  assert.equal(readNumber(""), null);
  assert.equal(readNumber("   "), null);
  assert.ok(Number.isNaN(readNumber("about 500")));
  assert.ok(Number.isNaN(readNumber("1.2.3")));
  assert.ok(Number.isNaN(readNumber("kg")));
  assert.ok(Number.isNaN(readNumber("-5")));
});
