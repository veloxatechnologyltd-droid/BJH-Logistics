import assert from "node:assert/strict";
import { test } from "node:test";
import { isSameSitePath } from "./sameSitePath.ts";

test("follows paths of this site, with query and hash", () => {
  for (const value of ["/", "/jobs", "/jobs/123?tab=team", "/chat#latest"]) {
    assert.equal(isSameSitePath(value), true, value);
  }
});

test("refuses anything that could leave the site", () => {
  for (const value of [
    "",
    "jobs",
    "//evil.example",
    "/\\evil.example",
    "/\\/evil.example",
    "\\\\evil.example",
    "https://evil.example",
    "javascript:alert(1)",
    "/\t/evil.example",
    "/\n/evil.example",
  ]) {
    assert.equal(isSameSitePath(value), false, JSON.stringify(value));
  }
});
