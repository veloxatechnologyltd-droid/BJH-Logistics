import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { allServices, SITE_URL } from "./content.ts";
import { GET as llmsTxt } from "./llms.txt/route.ts";
import robots from "./robots.ts";
import {
  absoluteUrl,
  breadcrumbJsonLd,
  faqJsonLd,
  jsonLdString,
  OG_IMAGE,
  organizationJsonLd,
  pageMetadata,
  serviceJsonLd,
  sitePaths,
  websiteJsonLd,
} from "./seo.ts";
import { serviceDetails, serviceHref } from "./serviceDetails.ts";
import sitemap from "./sitemap.ts";

const strings = (value: unknown): string[] =>
  typeof value === "string"
    ? [value]
    : value && typeof value === "object"
      ? Object.values(value).flatMap(strings)
      : [];

const keys = (value: unknown): string[] =>
  value && typeof value === "object"
    ? Object.entries(value).flatMap(([key, child]) => [key, ...keys(child)])
    : [];

test(
  "the default site URL is the www host that Vercel serves",
  { skip: Boolean(process.env.NEXT_PUBLIC_SITE_URL) },
  () => {
    assert.equal(new URL(SITE_URL).host, "www.bjhlogistics.com");
  },
);

test("the sitemap lists each page once, on the canonical host, with no query or fragment", () => {
  const entries = sitemap();
  const urls = entries.map((entry) => entry.url);
  assert.equal(new Set(urls).size, urls.length);
  for (const entry of entries) {
    assert.ok(
      entry.url === SITE_URL || entry.url.startsWith(`${SITE_URL}/`),
      entry.url,
    );
    assert.ok(!/[?#]/.test(entry.url), entry.url);
    assert.ok(entry.lastModified, `${entry.url} has no lastModified`);
  }
  assert.ok(urls.includes(SITE_URL));
  assert.ok(urls.includes(`${SITE_URL}/services/customs-clearance`));
});

test("every sitemap path has a page behind it", () => {
  for (const path of sitePaths) {
    const folder = path.startsWith("/services/")
      ? "app/services/[slug]"
      : `app${path === "/" ? "" : path}`;
    assert.ok(existsSync(`${folder}/page.tsx`), `${path} has no page`);
  }
});

test("robots points at the sitemap, keeps the API out and names the AI crawlers", () => {
  const result = robots();
  assert.equal(result.sitemap, `${SITE_URL}/sitemap.xml`);
  const rules = [result.rules].flat();
  assert.ok(rules.length >= 2);
  for (const rule of rules) {
    assert.equal(rule.allow, "/");
    assert.equal(rule.disallow, "/api/");
  }
  const agents = rules.flatMap((rule) => [rule.userAgent ?? []].flat());
  for (const bot of [
    "*",
    "GPTBot",
    "OAI-SearchBot",
    "ClaudeBot",
    "PerplexityBot",
  ]) {
    assert.ok(agents.includes(bot), `${bot} is not named`);
  }
});

test("service pages: unique titles and descriptions within search-result limits", () => {
  const titles = new Set<string>();
  const descriptions = new Set<string>();
  for (const [slug, detail] of Object.entries(serviceDetails)) {
    assert.ok(
      allServices.some((service) => service.slug === slug),
      `${slug} is not a service`,
    );
    // " | BJH Logistics" adds 16 characters, keeping the title near 60.
    assert.ok(
      detail.seoTitle.length <= 44,
      `${slug} title: ${detail.seoTitle.length}`,
    );
    assert.ok(
      detail.description.length >= 70 && detail.description.length <= 155,
      `${slug} description: ${detail.description.length}`,
    );
    assert.ok(detail.h1 && detail.intro && detail.includes.length >= 3, slug);
    assert.ok(!titles.has(detail.seoTitle), `${slug} repeats a title`);
    assert.ok(
      !descriptions.has(detail.description),
      `${slug} repeats a description`,
    );
    titles.add(detail.seoTitle);
    descriptions.add(detail.description);
  }
});

test("service page copy makes no ranking, price or credential claims BJH has not published", () => {
  const banned =
    /\b(best|top|leading|cheapest|lowest|fastest|guarantee[ds]?|licen[sc]ed|certified|accredited|award)|#1|number one|number 1/i;
  for (const text of strings(serviceDetails)) {
    assert.ok(!banned.test(text), `unsupported claim in: ${text}`);
  }
});

test("serviceHref goes to the detail page when there is one, else the card", () => {
  assert.equal(serviceHref("sea-freight"), "/services/sea-freight");
  assert.equal(serviceHref("container-sales"), "/services#container-sales");
  assert.equal(serviceHref("constructor"), "/services#constructor");
});

test("pageMetadata sets a canonical path and matching social tags", () => {
  const meta = pageMetadata({
    title: "About Us",
    description: "Desc",
    path: "/about",
  });
  assert.equal(meta.alternates?.canonical, "/about");
  assert.equal(meta.title, "About Us");
  assert.equal(meta.openGraph?.title, "About Us | BJH Logistics");
  assert.equal(meta.openGraph?.url, "/about");
  assert.equal((meta.twitter as { card: string }).card, "summary_large_image");

  const home = pageMetadata({
    title: "Home title",
    description: "Desc",
    path: "/",
    absoluteTitle: true,
  });
  assert.deepEqual(home.title, { absolute: "Home title" });
  assert.equal(home.openGraph?.title, "Home title");
});

test("organization markup carries the real contact facts and no invented ones", () => {
  const org = organizationJsonLd();
  assert.equal(org["@id"], `${SITE_URL}/#organization`);
  assert.equal(org.address.addressCountry, "GH");
  assert.equal(org.foundingDate, "2006");
  for (const phone of org.telephone) assert.match(phone, /^\+233\d{9}$/);
  for (const link of org.sameAs) assert.match(link, /^https:\/\//);
  assert.equal(org.hasOfferCatalog.itemListElement.length, allServices.length);
  for (const offer of org.hasOfferCatalog.itemListElement) {
    assert.ok(offer.itemOffered.url.startsWith(`${SITE_URL}/services`));
  }
  const text = JSON.stringify(org);
  assert.ok(!text.includes("undefined"));
  // No ratings, reviews, hours, prices, coordinates or memberships exist in
  // BJH's material; search engines penalise markup for things that are absent.
  const invented = [
    "aggregateRating",
    "review",
    "memberOf",
    "openingHours",
    "openingHoursSpecification",
    "priceRange",
    "geo",
  ];
  const present = keys([org, websiteJsonLd()]);
  for (const key of invented) assert.ok(!present.includes(key), key);
});

test("service, breadcrumb and FAQ markup are well formed", () => {
  const service = allServices.find(
    (item) => item.slug === "customs-clearance",
  )!;
  const markup = serviceJsonLd(service);
  assert.equal(markup["@type"], "Service");
  assert.equal(markup.url, `${SITE_URL}/services/customs-clearance`);
  assert.equal(markup.provider["@id"], organizationJsonLd()["@id"]);
  assert.equal(
    markup.description,
    serviceDetails["customs-clearance"].description,
  );

  const crumbs = breadcrumbJsonLd([
    { name: "Home", path: "/" },
    { name: "Services", path: "/services" },
  ]);
  assert.deepEqual(
    crumbs.itemListElement.map((item) => [item.position, item.item]),
    [
      [1, SITE_URL],
      [2, `${SITE_URL}/services`],
    ],
  );

  const faq = faqJsonLd([{ question: "Q?", answer: "A." }]);
  assert.equal(faq.mainEntity[0].acceptedAnswer.text, "A.");
  assert.equal(absoluteUrl("/"), SITE_URL);
});

test("structured data cannot close its own script tag", () => {
  const output = jsonLdString({ text: "</script><script>alert(1)</script>" });
  assert.ok(!output.includes("<"));
  assert.equal(JSON.parse(output).text, "</script><script>alert(1)</script>");
});

test("llms.txt is plain text and lists every service, the clearance time and the contacts", async () => {
  const response = llmsTxt();
  assert.match(response.headers.get("content-type") ?? "", /^text\/plain/);
  const text = await response.text();
  for (const service of allServices) {
    assert.ok(
      text.includes(absoluteUrl(serviceHref(service.slug))),
      service.slug,
    );
  }
  assert.ok(text.includes("3–5 business days"));
  assert.ok(text.includes("+233 59 841 5519"));
  assert.ok(!text.includes("undefined"));
});

test("the share image is a 1200x630 PNG", () => {
  const file = readFileSync(`public${OG_IMAGE.url}`);
  assert.equal(file.subarray(1, 4).toString(), "PNG");
  assert.equal(file.readUInt32BE(16), OG_IMAGE.width);
  assert.equal(file.readUInt32BE(20), OG_IMAGE.height);
});
