import assert from "node:assert/strict";
import { test } from "node:test";
import {
  normalizeTrackingNumber,
  publicTrackingUrl,
} from "../src/tracking/tracking-number";

test("what a visitor types is turned into the stored form, or refused", () => {
  const stored = "BJH-K3Q7-9XMD";
  for (const typed of [
    "BJH-K3Q7-9XMD",
    "bjh-k3q7-9xmd",
    "BJHK3Q79XMD",
    "K3Q79XMD",
    "k3q7 9xmd",
    "  bjh k3q7 9xmd ",
  ]) {
    assert.equal(normalizeTrackingNumber(typed), stored, typed);
  }
  for (const typed of [
    "",
    "BJH-K3Q7",
    "BJH-0O1I-LLLL",
    "BJH/SI/2026/0001",
    "x".repeat(100),
    undefined,
    42,
  ]) {
    assert.equal(normalizeTrackingNumber(typed), null, String(typed));
  }
});

test("the link points at the public site, never at localhost in production", () => {
  assert.equal(
    publicTrackingUrl("BJH-K3Q7-9XMD", {}),
    "http://127.0.0.1:3003/track/BJH-K3Q7-9XMD",
  );
  assert.equal(
    publicTrackingUrl("BJH-K3Q7-9XMD", { NODE_ENV: "production" }),
    "https://www.bjhlogistics.com/track/BJH-K3Q7-9XMD",
  );
  assert.equal(
    publicTrackingUrl("BJH-K3Q7-9XMD", {
      NODE_ENV: "production",
      PUBLIC_SITE_URL: "https://site.example.test/",
    }),
    "https://site.example.test/track/BJH-K3Q7-9XMD",
  );
});
