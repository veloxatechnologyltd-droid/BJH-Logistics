/**
 * Whether a sender might already be one of BJH's customers when their email
 * address is new to us. Plain rules, no AI: the same inputs always give the same
 * answer, a person can see why, and the customer directory goes nowhere. A match
 * here is only ever a suggestion for staff to confirm, never a reason to link.
 */

/** The parts of a customer these rules look at. */
export interface KnownCustomer {
  id: string;
  companyName: string;
  tradingName?: string | null;
  companyEmail?: string | null;
  contacts: Array<{ email: string }>;
}

export interface PossibleMatch {
  id: string;
  companyName: string;
  reasons: Array<"similar name" | "same email domain">;
}

const MAX_MATCHES = 3;

/** Words that say what kind of company it is, not which one. */
const ENDINGS = new Set([
  "ltd",
  "limited",
  "llc",
  "inc",
  "incorporated",
  "corp",
  "corporation",
  "co",
  "company",
  "plc",
  "gh",
  "ghana",
  "the",
  "and",
  "of",
]);

/** Mailboxes anyone can open: sharing one says nothing about the company. */
const FREE_MAIL = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "yahoo.co.uk",
  "ymail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "icloud.com",
  "me.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "zoho.com",
  "gmx.com",
  "mail.com",
]);

/** Endings where the company's own name sits one label further left. */
const SECOND_LEVEL = new Set([
  "com.gh",
  "org.gh",
  "edu.gh",
  "gov.gh",
  "net.gh",
  "co.uk",
  "org.uk",
  "co.za",
  "com.ng",
  "co.ke",
]);

function words(name: string): string[] {
  return name
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter(Boolean);
}

/** "Veloxa Technology Ltd." and "VELOXA  TECHNOLOGY LIMITED" both become "veloxa technology". */
export function normalizeCompanyName(name: string): string {
  const all = words(name);
  const kept = all.filter((word) => !ENDINGS.has(word));
  return (kept.length > 0 ? kept : all).join(" ");
}

function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(
        (previous[j] ?? 0) + 1,
        (current[j - 1] ?? 0) + 1,
        (previous[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[b.length] ?? 0;
}

/** The same word, or one that is the start of the other ("tech" and "technology"), or a plural or other ending. */
function sameWord(a: string, b: string): boolean {
  if (a === b) return true;
  const shortest = Math.min(a.length, b.length);
  if (shortest >= 4 && (a.startsWith(b) || b.startsWith(a))) return true;
  let shared = 0;
  while (shared < shortest && a[shared] === b[shared]) shared += 1;
  return shared >= 6 && shared / shortest >= 0.75;
}

/** Every word of the shorter name appears, in some form, in the longer one. */
function covers(small: string[], large: string[]): boolean {
  const free = [...large];
  return small.every((word) => {
    const index = free.findIndex((other) => sameWord(word, other));
    if (index < 0) return false;
    free.splice(index, 1);
    return true;
  });
}

/**
 * Whether two company names are probably the same company: the same once
 * endings are dropped, one a shortening of the other ("Veloxa Tech" and "Veloxa
 * Technology Ltd", or run together as "VeloxaTech"), or one letter apart. A name
 * too short to tell apart never matches.
 */
export function similarCompanyNames(a: string, b: string): boolean {
  const first = normalizeCompanyName(a);
  const second = normalizeCompanyName(b);
  if (!first || !second) return false;
  if (first === second) return true;
  const joinedFirst = first.replace(/ /g, "");
  const joinedSecond = second.replace(/ /g, "");
  const shortest = Math.min(joinedFirst.length, joinedSecond.length);
  if (shortest < 5) return false;
  if (
    joinedFirst.startsWith(joinedSecond) ||
    joinedSecond.startsWith(joinedFirst)
  ) {
    return true;
  }
  if (shortest >= 6 && editDistance(joinedFirst, joinedSecond) <= 1) {
    return true;
  }
  const wordsFirst = first.split(" ");
  const wordsSecond = second.split(" ");
  return wordsFirst.length <= wordsSecond.length
    ? covers(wordsFirst, wordsSecond)
    : covers(wordsSecond, wordsFirst);
}

/** The company's own domain from an email address; null for a free mailbox or a malformed address. */
export function businessDomain(email: string): string | null {
  const [, host, ...extra] = email.trim().toLowerCase().split("@");
  if (!host || extra.length > 0) return null;
  const labels = host.split(".");
  if (labels.length < 2 || labels.some((label) => !label)) return null;
  const lastTwo = labels.slice(-2).join(".");
  const domain = SECOND_LEVEL.has(lastTwo)
    ? labels.slice(-3).join(".")
    : lastTwo;
  return FREE_MAIL.has(domain) ? null : domain;
}

/**
 * The customers this sender might be, best first (a similar name and the same
 * business email domain together beat either alone), at most a few.
 */
export function findPossibleMatches(
  sender: { companyName: string; email: string },
  customers: KnownCustomer[],
): PossibleMatch[] {
  const domain = businessDomain(sender.email);
  const matches: PossibleMatch[] = [];
  for (const customer of customers) {
    const reasons: PossibleMatch["reasons"] = [];
    const names = [customer.companyName, customer.tradingName].filter(
      (name): name is string => Boolean(name),
    );
    if (names.some((name) => similarCompanyNames(sender.companyName, name))) {
      reasons.push("similar name");
    }
    const addresses = [
      ...customer.contacts.map((contact) => contact.email),
      customer.companyEmail,
    ].filter((address): address is string => Boolean(address));
    if (
      domain &&
      addresses.some((address) => businessDomain(address) === domain)
    ) {
      reasons.push("same email domain");
    }
    if (reasons.length > 0) {
      matches.push({
        id: customer.id,
        companyName: customer.companyName,
        reasons,
      });
    }
  }
  return matches
    .sort((a, b) => b.reasons.length - a.reasons.length)
    .slice(0, MAX_MATCHES);
}
