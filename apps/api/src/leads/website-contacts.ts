import { normalizePhone } from "../notifications/phone";
import {
  normalizeDomain,
  normalizePhoneKey,
  parseWebsite,
} from "./business-normalize";
import type { FetchedPage, PageFetcher } from "./public-web-fetcher";

/**
 * Finds a business's public contact details on its own website (plan item 1.4):
 * the home page and the few pages most likely to carry them (contact, about...).
 * Ported from Venariq's `lead_enrichment_service.py`, minus the headless-browser
 * rendering and the sitemap crawl: plain HTML only, at most six pages per site.
 * What a page says is treated as data: it is only searched for addresses and numbers.
 */

export interface FoundEmail {
  address: string;
  /** 0 to 95: how likely this is the business's own, reachable address. */
  score: number;
  /** The page it was found on. */
  foundOn: string;
}

export interface WebsiteContacts {
  /** Maps onto `app.prospect.enrichment_status`. */
  status: "email_found" | "email_missing" | "failed";
  /** Best first, at most five. */
  emails: FoundEmail[];
  /** International form where possible, best first, at most three. */
  phones: string[];
  pagesChecked: number;
  /** Safe to show staff; set when status is "failed". */
  error: string | null;
}

export interface WebsiteContactFinder {
  find(website: string): Promise<WebsiteContacts>;
}

const EMAIL_PATTERN =
  /[a-z0-9._%+-]{1,64}@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}/gi;
// "name [at] domain [dot] com": the brackets are required, so plain prose never matches.
const OBFUSCATED_PATTERN =
  /([a-z0-9._%+-]{1,64})\s*[[(]\s*at\s*[\])]\s*([a-z0-9.-]+)\s*[[(]\s*dot\s*[\])]\s*([a-z]{2,})/gi;

const SKIPPED_LOCAL_PREFIXES = [
  "example@",
  "test@",
  "noreply@",
  "no-reply@",
  "donotreply@",
  "your@",
  "name@",
  "user@",
  "email@",
];
const SKIPPED_DOMAINS = new Set([
  "example.com",
  "example.org",
  "domain.com",
  "yourdomain.com",
  "yoursite.com",
  "email.com",
  "sentry.io",
  "wixpress.com",
  "schema.org",
]);
const FILE_LABELS = new Set([
  "css",
  "js",
  "jpg",
  "jpeg",
  "png",
  "gif",
  "svg",
  "webp",
  "ico",
  "woff",
  "woff2",
]);
const PREFERRED_LOCAL_PARTS = [
  "info",
  "contact",
  "sales",
  "enquir",
  "hello",
  "office",
  "admin",
  "support",
  "procurement",
  "purchas",
  "logistics",
  "shipping",
  "import",
  "export",
  "operations",
];
const UNWANTED_LOCAL_PARTS = [
  "webmaster",
  "privacy",
  "legal",
  "abuse",
  "career",
  "jobs",
  "recruit",
  "press",
];

/** Words in a page address that mark a page likely to carry contact details, best first. */
const CONTACT_HINTS = [
  "contact",
  "get-in-touch",
  "reach",
  "enquir",
  "inquir",
  "find-us",
  "location",
  "about",
  "team",
  "support",
];
const GUESSED_PATHS = ["/contact", "/contact-us", "/about"];
const FILE_EXTENSIONS =
  /\.(pdf|jpe?g|png|gif|svg|webp|zip|docx?|xlsx?|pptx?|mp[34]|css|js)$/i;

export function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => safeChar(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, decimal) => safeChar(Number(decimal)))
    .replace(/&commat;/gi, "@")
    .replace(/&period;/gi, ".")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&");
}

function safeChar(code: number): string {
  return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
}

/** Cloudflare "email protection" hides an address as hex: the first byte is the XOR key. */
function decodeCloudflare(hex: string): string | null {
  if (hex.length < 4 || hex.length % 2 !== 0) return null;
  const key = parseInt(hex.slice(0, 2), 16);
  let decoded = "";
  for (let i = 2; i < hex.length; i += 2) {
    decoded += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ key);
  }
  return decoded;
}

function visibleText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style|noscript)\b[\s\S]*?<\/\1>/gi, " ")
      .replace(/<[^>]*>/g, " "),
  ).replace(/\s+/g, " ");
}

function cleanEmail(email: string): string {
  return email
    .trim()
    .replace(/^[.,;:()[\]<>"']+|[.,;:()[\]<>"']+$/g, "")
    .toLowerCase();
}

function isUsableEmail(email: string): boolean {
  const at = email.lastIndexOf("@");
  if (at < 1 || email.length > 254) return false;
  const domain = email.slice(at + 1);
  if (!domain.includes(".") || SKIPPED_DOMAINS.has(domain)) return false;
  if (SKIPPED_LOCAL_PREFIXES.some((prefix) => email.startsWith(prefix)))
    return false;
  const labels = domain.split(".");
  // "logo@2x.png" is a file name, not an address.
  if (labels.some((label) => FILE_LABELS.has(label))) return false;
  return (
    /^[a-z0-9.-]+$/.test(domain) &&
    !domain.startsWith(".") &&
    !domain.includes("..")
  );
}

/** Every address that appears on a page, once each. */
export function extractEmails(html: string): string[] {
  const found = new Set<string>();
  const add = (candidate: string | null | undefined) => {
    const email = candidate ? cleanEmail(candidate) : "";
    if (email && isUsableEmail(email)) found.add(email);
  };

  const decoded = decodeEntities(html);
  for (const match of decoded.matchAll(EMAIL_PATTERN)) add(match[0]);
  for (const match of decoded.matchAll(/href\s*=\s*["']mailto:([^"'?]+)/gi)) {
    try {
      add(decodeURIComponent(match[1]));
    } catch {
      add(match[1]);
    }
  }
  for (const match of decoded.matchAll(
    /(?:data-cfemail\s*=\s*["']|email-protection#)([0-9a-f]{4,})/gi,
  )) {
    add(decodeCloudflare(match[1]));
  }
  const text = visibleText(html);
  for (const match of text.matchAll(EMAIL_PATTERN)) add(match[0]);
  for (const match of text.matchAll(OBFUSCATED_PATTERN)) {
    add(`${match[1]}@${match[2]}.${match[3]}`);
  }
  return [...found];
}

interface PhoneSighting {
  phone: string;
  key: string;
  /** How trustworthy the place it was found in is. */
  weight: number;
}

function usablePhone(raw: string): { phone: string; key: string } | null {
  const cleaned = raw
    .trim()
    .replace(/[\s.()/-]+/g, " ")
    .trim();
  const digits = cleaned.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) return null;
  if (new Set(digits).size === 1) return null;
  const key = normalizePhoneKey(cleaned);
  if (!key) return null;
  return { phone: normalizePhone(cleaned) ?? cleaned, key };
}

/** Phone numbers on a page: tel: and WhatsApp links, and numbers next to "Tel", "Call"... */
export function extractPhones(html: string): PhoneSighting[] {
  const found: PhoneSighting[] = [];
  const add = (raw: string, weight: number) => {
    const phone = usablePhone(raw);
    if (phone) found.push({ ...phone, weight });
  };
  const decoded = decodeEntities(html);
  for (const match of decoded.matchAll(/href\s*=\s*["']tel:([^"']+)/gi)) {
    try {
      add(decodeURIComponent(match[1]), 3);
    } catch {
      add(match[1], 3);
    }
  }
  for (const match of decoded.matchAll(
    /(?:wa\.me\/|whatsapp\.com\/send\?phone=)\+?(\d{7,15})/gi,
  )) {
    add(`+${match[1]}`, 2);
  }
  const labelled =
    /\b(?:tel|telephone|phone|call|mobile|cell|whatsapp|hotline|contact)\b[^0-9+]{0,20}(\+?\d[\d\s().\-/]{5,}\d)/gi;
  for (const match of visibleText(html).matchAll(labelled)) add(match[1], 1);
  return found;
}

/** Same-site links on a page that look like contact pages, best first. */
export function contactLinks(page: FetchedPage): string[] {
  const base = new URL(page.url);
  const host = base.hostname.replace(/^www\./, "");
  const ranked: Array<{ rank: number; url: string }> = [];
  for (const match of page.html.matchAll(
    /<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/gi,
  )) {
    const href = decodeEntities(match[1] ?? match[2] ?? "").trim();
    if (
      !href ||
      href.startsWith("#") ||
      /^(mailto|tel|javascript):/i.test(href)
    )
      continue;
    let url: URL;
    try {
      url = new URL(href, base);
    } catch {
      continue;
    }
    if (!["http:", "https:"].includes(url.protocol)) continue;
    if (url.hostname.replace(/^www\./, "") !== host) continue;
    if (FILE_EXTENSIONS.test(url.pathname)) continue;
    url.hash = "";
    url.search = "";
    const path = url.pathname.toLowerCase();
    const rank = CONTACT_HINTS.findIndex((hint) => path.includes(hint));
    if (rank >= 0) ranked.push({ rank, url: url.href });
  }
  return ranked
    .sort((a, b) => a.rank - b.rank || a.url.localeCompare(b.url))
    .map((entry) => entry.url);
}

function canonical(url: string): string {
  const parsed = new URL(url);
  return `${parsed.hostname.replace(/^www\./, "")}${parsed.pathname.replace(/\/+$/, "")}`;
}

function sameSite(emailDomain: string, siteDomain: string | null): boolean {
  if (!siteDomain) return false;
  return (
    emailDomain === siteDomain ||
    emailDomain.endsWith(`.${siteDomain}`) ||
    siteDomain.endsWith(`.${emailDomain}`)
  );
}

function scoreEmail(
  email: string,
  pageUrl: string,
  siteDomain: string | null,
  seen: number,
): number {
  const [local, domain] = [
    email.slice(0, email.lastIndexOf("@")),
    email.slice(email.lastIndexOf("@") + 1),
  ];
  let score = 50 + Math.min(seen, 5) * 3;
  if (sameSite(domain, siteDomain)) score += 20;
  if (PREFERRED_LOCAL_PARTS.some((part) => local.includes(part))) score += 15;
  const path = new URL(pageUrl).pathname.toLowerCase();
  if (CONTACT_HINTS.some((hint) => path.includes(hint))) score += 10;
  if (UNWANTED_LOCAL_PARTS.some((part) => local.includes(part))) score -= 15;
  return Math.min(score, 95);
}

export interface PublicWebsiteContactFinderOptions {
  maxPages?: number;
  /** Stop starting new page reads after this long. */
  deadlineMs?: number;
}

export class PublicWebsiteContactFinder implements WebsiteContactFinder {
  private readonly maxPages: number;
  private readonly deadlineMs: number;

  constructor(
    private readonly fetcher: PageFetcher,
    options: PublicWebsiteContactFinderOptions = {},
  ) {
    this.maxPages = options.maxPages ?? 6;
    this.deadlineMs = options.deadlineMs ?? 45_000;
  }

  async find(website: string): Promise<WebsiteContacts> {
    const start = parseWebsite(website);
    if (!start) return failed("The website address is not usable", 0);
    const startedAt = Date.now();

    const home = await this.read(start.href);
    if (!home) return failed("The website could not be read", 0);

    const pages: FetchedPage[] = [home];
    const seen = new Set([canonical(home.url)]);
    const siteDomain = normalizeDomain(home.url) ?? normalizeDomain(website);
    const origin = new URL(home.url).origin;
    const queue = [
      ...contactLinks(home),
      ...GUESSED_PATHS.map((path) => `${origin}${path}`),
    ];

    for (const url of queue) {
      if (pages.length >= this.maxPages) break;
      if (Date.now() - startedAt > this.deadlineMs) break;
      // Enough has been found: no need to read more of their site.
      const sofar = collect(pages, siteDomain);
      if (
        sofar.emails.some((email) =>
          sameSite(email.address.split("@")[1], siteDomain),
        ) &&
        sofar.phones.length > 0
      )
        break;
      const key = canonical(url);
      if (seen.has(key)) continue;
      seen.add(key);
      const page = await this.read(url);
      if (page) pages.push(page);
    }

    const { emails, phones } = collect(pages, siteDomain);
    return {
      status: emails.length > 0 ? "email_found" : "email_missing",
      emails,
      phones,
      pagesChecked: pages.length,
      error: null,
    };
  }

  private async read(url: string): Promise<FetchedPage | null> {
    try {
      return await this.fetcher.fetchPage(url);
    } catch {
      return null;
    }
  }
}

function failed(error: string, pagesChecked: number): WebsiteContacts {
  return { status: "failed", emails: [], phones: [], pagesChecked, error };
}

/** The ranked emails and phones across every page read. */
function collect(
  pages: FetchedPage[],
  siteDomain: string | null,
): { emails: FoundEmail[]; phones: string[] } {
  const emails = new Map<string, { count: number; best: FoundEmail }>();
  const phones = new Map<
    string,
    { phone: string; weight: number; count: number }
  >();
  for (const page of pages) {
    for (const address of extractEmails(page.html)) {
      const known = emails.get(address);
      const count = (known?.count ?? 0) + 1;
      const score = scoreEmail(address, page.url, siteDomain, count);
      emails.set(address, {
        count,
        best:
          !known || score > known.best.score
            ? { address, score, foundOn: page.url }
            : known.best,
      });
    }
    for (const sighting of extractPhones(page.html)) {
      const known = phones.get(sighting.key);
      phones.set(sighting.key, {
        phone: known?.phone ?? sighting.phone,
        weight: Math.max(known?.weight ?? 0, sighting.weight),
        count: (known?.count ?? 0) + 1,
      });
    }
  }
  return {
    emails: [...emails.values()]
      .map(({ count, best }) => ({
        ...best,
        score: scoreEmail(best.address, best.foundOn, siteDomain, count),
      }))
      .sort((a, b) => b.score - a.score || a.address.localeCompare(b.address))
      .slice(0, 5),
    phones: [...phones.values()]
      .sort(
        (a, b) =>
          b.weight - a.weight ||
          b.count - a.count ||
          a.phone.localeCompare(b.phone),
      )
      .slice(0, 3)
      .map((entry) => entry.phone),
  };
}

/**
 * Local and test finder: nothing is fetched. Gives each synthetic site
 * "info@<its domain>", so a local run shows the whole pipeline.
 */
export class StubWebsiteContactFinder implements WebsiteContactFinder {
  async find(website: string): Promise<WebsiteContacts> {
    const domain = normalizeDomain(website);
    if (!domain) return failed("The website address is not usable", 0);
    return {
      status: "email_found",
      emails: [{ address: `info@${domain}`, score: 80, foundOn: website }],
      phones: [],
      pagesChecked: 1,
      error: null,
    };
  }
}
