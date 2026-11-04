import assert from "node:assert/strict";
import { test } from "node:test";
import {
  installHintSnoozeMs,
  installHintSnoozed,
  isAppleTouchDevice,
} from "./installPrompt.ts";

const iPhone =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1";
const android =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36";

test("recognises iPhones and iPads, including an iPad that calls itself a Mac", () => {
  assert.equal(isAppleTouchDevice(iPhone, "iPhone", 5), true);
  assert.equal(
    isAppleTouchDevice("Mozilla/5.0 (Macintosh)", "MacIntel", 5),
    true,
  );
});

test("an Android phone or a laptop is not an Apple touch device", () => {
  assert.equal(isAppleTouchDevice(android, "Linux armv8l", 5), false);
  assert.equal(
    isAppleTouchDevice("Mozilla/5.0 (Macintosh)", "MacIntel", 0),
    false,
  );
  assert.equal(
    isAppleTouchDevice("Mozilla/5.0 (X11; Linux x86_64)", "Linux x86_64", 0),
    false,
  );
});

test("Not now keeps the banner away for 30 days, then it may return", () => {
  const now = Date.UTC(2026, 10, 4);
  const day = 24 * 60 * 60 * 1000;
  assert.equal(installHintSnoozed(String(now - day), now), true);
  assert.equal(
    installHintSnoozed(String(now - installHintSnoozeMs + 1), now),
    true,
  );
  assert.equal(
    installHintSnoozed(String(now - installHintSnoozeMs), now),
    false,
  );
  assert.equal(installHintSnoozed(String(now - 90 * day), now), false);
});

test("a missing, unreadable or future date does not hide the banner", () => {
  const now = Date.UTC(2026, 10, 4);
  assert.equal(installHintSnoozed(null, now), false);
  assert.equal(installHintSnoozed("", now), false);
  assert.equal(installHintSnoozed("yesterday", now), false);
  assert.equal(installHintSnoozed(String(now + 1000), now), false);
});
