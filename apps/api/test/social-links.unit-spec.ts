import assert from "node:assert/strict";
import { test } from "node:test";
import { mapPlace } from "../src/leads/business-search";
import {
  socialLink,
  socialLinksAsText,
  socialLinksFromStored,
  socialLinksOf,
} from "../src/leads/social-links";

/** All data below is synthetic. */

test("a link must be a web address on its own platform, and comes back as https", () => {
  assert.equal(
    socialLink("facebook", "https://www.facebook.com/sample.page"),
    "https://www.facebook.com/sample.page",
  );
  // The tool sometimes leaves the scheme off.
  assert.equal(
    socialLink("facebook", "facebook.com/profile.php?id=123"),
    "https://facebook.com/profile.php?id=123",
  );
  assert.equal(
    socialLink("instagram", "http://m.instagram.com/sample"),
    "https://m.instagram.com/sample",
  );
  assert.equal(
    socialLink("twitter", "https://x.com/sample"),
    "https://x.com/sample",
  );
  assert.equal(
    socialLink("linkedin", "https://gh.linkedin.com/company/sample#top"),
    "https://gh.linkedin.com/company/sample",
  );
});

test("a link that points elsewhere, is not a web address or is too long is dropped", () => {
  for (const bad of [
    "https://evil.example/facebook.com/sample",
    "https://facebook.com.evil.example/sample",
    "https://notfacebook.com/sample",
    "javascript:alert(1)",
    "ftp://facebook.com/sample",
    "https://user:pass@facebook.com/sample",
    "not a link",
    "",
    42,
    null,
    `https://facebook.com/${"a".repeat(300)}`,
  ]) {
    assert.equal(socialLink("facebook", bad), null, String(bad).slice(0, 40));
  }
  // A real link on the wrong platform is dropped too.
  assert.equal(socialLink("instagram", "https://facebook.com/sample"), null);
});

test("a place's pages are filed by platform, deduplicated and limited to three", () => {
  const links = socialLinksOf({
    facebooks: [
      "facebook.com/a",
      "https://facebook.com/a",
      "https://facebook.com/b",
      "https://facebook.com/c",
      "https://facebook.com/d",
    ],
    instagrams: ["https://evil.example/x"],
    youtubes: "https://youtube.com/x",
    tiktoks: [],
    twitters: ["https://twitter.com/sample"],
  });
  assert.deepEqual(links, {
    facebook: [
      "https://facebook.com/a",
      "https://facebook.com/b",
      "https://facebook.com/c",
    ],
    twitter: ["https://twitter.com/sample"],
  });
  assert.deepEqual(socialLinksOf({}), {});
});

test("a mapped business carries its social pages", () => {
  const business = mapPlace(
    {
      title: "Sample Foods Ltd",
      placeId: "p1",
      emails: ["info@sample.example"],
      facebooks: ["https://www.facebook.com/sample"],
    },
    "google_maps",
  );
  assert.deepEqual(business?.socialLinks, {
    facebook: ["https://www.facebook.com/sample"],
  });
  assert.deepEqual(
    mapPlace({ title: "Plain Ltd" }, "google_maps")?.socialLinks,
    {},
  );
});

test("stored links are re-checked on the way out", () => {
  assert.deepEqual(
    socialLinksFromStored({
      facebook: ["https://facebook.com/ok", "https://evil.example/x"],
      other: ["https://facebook.com/ignored"],
    }),
    { facebook: ["https://facebook.com/ok"] },
  );
  assert.deepEqual(socialLinksFromStored(null), {});
  assert.deepEqual(socialLinksFromStored(["x"]), {});
  assert.deepEqual(socialLinksFromStored("x"), {});
});

test("links read as one line for a lead's notes", () => {
  assert.equal(socialLinksAsText({}), "");
  assert.equal(
    socialLinksAsText({
      instagram: ["https://instagram.com/a"],
      facebook: ["https://facebook.com/a", "https://facebook.com/b"],
    }),
    "Facebook: https://facebook.com/a, https://facebook.com/b; Instagram: https://instagram.com/a",
  );
});
