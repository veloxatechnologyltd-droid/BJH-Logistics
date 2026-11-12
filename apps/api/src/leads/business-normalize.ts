import { normalizePhone } from "../notifications/phone";

/**
 * Keys that make two records about the same business comparable (stored on
 * `app.prospect`, compared by the duplicate check against prospects, customers
 * and leads). Ported from Venariq's `apify_service.py`, with the differences noted.
 */

const COMPANY_SUFFIXES = new Set([
  "ltd",
  "limited",
  "llc",
  "inc",
  "plc",
  "corp",
  "corporation",
  "co",
  "company",
]);

/**
 * Lower case, `&` as "and", punctuation removed, and legal suffixes dropped from the
 * end ("Acme Ltd" and "ACME Limited." match). Null when nothing is left.
 */
export function normalizeBusinessName(
  name: string | null | undefined,
): string | null {
  if (!name) return null;
  const words = name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  while (words.length > 1 && COMPANY_SUFFIXES.has(words[words.length - 1])) {
    words.pop();
  }
  const normalized = words.join(" ");
  return normalized || null;
}

/** Sites that say nothing about which business it is: many businesses share them. */
const SHARED_HOSTS = [
  "facebook.com",
  "fb.com",
  "instagram.com",
  "linkedin.com",
  "twitter.com",
  "x.com",
  "tiktok.com",
  "youtube.com",
  "wa.me",
  "whatsapp.com",
  "linktr.ee",
  "business.site",
  "google.com",
  "goo.gl",
  "wixsite.com",
  "blogspot.com",
  "wordpress.com",
];

/**
 * The web address as a URL, or null when it is not a usable http(s) address.
 * "www.acme.com" is accepted as "https://www.acme.com".
 */
export function parseWebsite(website: string | null | undefined): URL | null {
  const raw = website?.trim();
  if (!raw) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    return url.hostname.includes(".") ? url : null;
  } catch {
    return null;
  }
}

/**
 * The website's host without "www.", or null when the address is unusable or is a
 * social or page-builder host (matching on "facebook.com" would call every business
 * with a Facebook page the same one). Venariq compared host plus path; the host
 * alone is what a duplicate check should compare.
 */
export function normalizeDomain(
  website: string | null | undefined,
): string | null {
  const url = parseWebsite(website);
  if (!url) return null;
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const shared = SHARED_HOSTS.some(
    (shared) => host === shared || host.endsWith(`.${shared}`),
  );
  return shared ? null : host;
}

/**
 * Digits only, comparable across spellings: "024 405 8592", "+233 24 405 8592" and
 * "233244058592" all become "233244058592". Numbers that are not Ghanaian keep their
 * digits; fewer than seven digits is not a number worth comparing (null).
 */
export function normalizePhoneKey(
  phone: string | null | undefined,
): string | null {
  if (!phone) return null;
  const international = normalizePhone(phone);
  if (international) return international.slice(1);
  const digits = phone.replace(/\D+/g, "");
  return digits.length >= 7 ? digits : null;
}

/** Mailbox providers whose domain says nothing about which business an address belongs to. */
const FREE_MAIL_HOSTS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "yahoo.co.uk",
  "ymail.com",
  "hotmail.com",
  "hotmail.co.uk",
  "outlook.com",
  "live.com",
  "msn.com",
  "icloud.com",
  "me.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "mail.com",
]);

/**
 * The domain of a business email address ("info@acme.com" is "acme.com"), or null
 * for a free mailbox or something that is not an address.
 */
export function normalizeEmailDomain(
  email: string | null | undefined,
): string | null {
  const address = email?.trim().toLowerCase();
  const at = address ? address.lastIndexOf("@") : -1;
  if (!address || at < 1) return null;
  const host = address.slice(at + 1);
  return FREE_MAIL_HOSTS.has(host) ? null : normalizeDomain(host);
}
