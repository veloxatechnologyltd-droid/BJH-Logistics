import {
  normalizeBusinessName,
  normalizeDomain,
  normalizePhoneKey,
  parseWebsite,
} from "./business-normalize";
import { socialLinksOf } from "./social-links";
import type { SocialLinks } from "./social-links";

export const BUSINESS_SEARCH_PROVIDER = Symbol("BUSINESS_SEARCH_PROVIDER");

/** The campaign's search settings, as the provider needs them. */
export interface BusinessSearchQuery {
  industry: string;
  location: string;
  /** Search terms; the industry is searched when there are none. */
  keywords: string[];
  excludedKeywords: string[];
  minRating: number | null;
  requireWebsite: boolean;
  maxResults: number;
}

/** A business found by a search, shaped like a row of `app.prospect`. */
export interface FoundBusiness {
  businessName: string;
  website: string | null;
  address: string | null;
  phones: string[];
  emails: string[];
  /** Social media pages from the business's website; platforms with none are absent. */
  socialLinks: SocialLinks;
  rating: number | null;
  category: string | null;
  /** `app.prospect.source`: "stub" rows are synthetic and must never look real. */
  source: "google_maps" | "stub";
  sourceId: string | null;
  normalizedName: string;
  normalizedDomain: string | null;
  normalizedPhone: string | null;
}

export type RejectionReason =
  | "unusable"
  | "closed"
  | "missing_website"
  | "below_min_rating"
  | "excluded_keyword";

export interface SearchResults {
  /** Businesses that passed the filters, at most `maxResults`. */
  businesses: FoundBusiness[];
  /** Places the provider returned before filtering. */
  rawCount: number;
  rejected: Partial<Record<RejectionReason, number>>;
}

export type SearchProgress =
  | { state: "running" }
  | { state: "succeeded"; datasetId: string }
  | { state: "failed"; message: string };

/**
 * Finds businesses for a campaign. A search can take minutes, so it is three calls
 * that the run pipeline makes on separate ticks, keeping `providerRunId` and
 * `datasetId` on the run between them. Any call may throw (network, quota). An error
 * with a boolean `retryable` has a message that is safe to show staff and never
 * contains a secret: `true` is tried again later, `false` fails the run at once. Any
 * other error is tried again and shown to staff only as an unexpected problem.
 */
export interface BusinessSearchProvider {
  /** "apify", or "stub" when no search account is configured. */
  readonly name: string;
  start(query: BusinessSearchQuery): Promise<{ providerRunId: string }>;
  poll(providerRunId: string): Promise<SearchProgress>;
  /** Maps and filters the places of a finished search. */
  fetchResults(
    datasetId: string,
    query: BusinessSearchQuery,
  ): Promise<SearchResults>;
}

type RawPlace = Record<string, unknown>;

function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function emailsOf(place: RawPlace): string[] {
  const found = new Set<string>();
  const candidates = [
    place.email,
    ...(Array.isArray(place.emails) ? place.emails : []),
  ];
  for (const candidate of candidates) {
    const email = text(candidate, 254)?.toLowerCase();
    if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) found.add(email);
  }
  return [...found].slice(0, 10);
}

function phonesOf(place: RawPlace): string[] {
  const byKey = new Map<string, string>();
  // The unformatted number is international ("+233...") and so is preferred.
  for (const candidate of [place.phoneUnformatted, place.phone]) {
    const phone = text(candidate, 40);
    const key = normalizePhoneKey(phone);
    if (phone && key && !byKey.has(key)) byKey.set(key, phone);
  }
  return [...byKey.values()].slice(0, 10);
}

function ratingOf(place: RawPlace): number | null {
  const value = place.totalScore ?? place.rating;
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  // `app.prospect.rating` holds one decimal between 0 and 5.
  return Math.min(5, Math.max(0, Math.round(value * 10) / 10));
}

/** One place from the provider, or null when it has no name to show. */
export function mapPlace(
  place: unknown,
  source: FoundBusiness["source"],
): FoundBusiness | null {
  if (typeof place !== "object" || place === null) return null;
  const raw = place as RawPlace;
  const businessName = text(raw.title ?? raw.name, 200);
  const normalizedName = normalizeBusinessName(businessName);
  if (!businessName || !normalizedName) return null;
  const websiteText = text(raw.website, 500);
  const phones = phonesOf(raw);
  const sourceId = raw.placeId ?? raw.cid;
  return {
    businessName,
    website: parseWebsite(websiteText) ? websiteText : null,
    address: text(raw.address ?? raw.street, 500),
    phones,
    emails: emailsOf(raw),
    socialLinks: socialLinksOf(raw),
    rating: ratingOf(raw),
    category: text(raw.categoryName, 160),
    source,
    sourceId:
      typeof sourceId === "string" || typeof sourceId === "number"
        ? String(sourceId).slice(0, 300)
        : null,
    normalizedName,
    normalizedDomain: normalizeDomain(websiteText),
    normalizedPhone: phones.length > 0 ? normalizePhoneKey(phones[0]) : null,
  };
}

/** The first rule a place breaks, or null when it is worth keeping. */
function rejectionFor(
  business: FoundBusiness,
  place: RawPlace,
  query: BusinessSearchQuery,
): RejectionReason | null {
  if (place.permanentlyClosed === true || place.temporarilyClosed === true) {
    return "closed";
  }
  if (query.requireWebsite && !business.website) return "missing_website";
  if (
    query.minRating !== null &&
    (business.rating === null || business.rating < query.minRating)
  ) {
    return "below_min_rating";
  }
  const haystack = [
    business.businessName,
    business.category,
    business.address,
    business.website,
    text(place.description, 1000),
  ]
    .join(" ")
    .toLowerCase();
  for (const keyword of query.excludedKeywords) {
    const needle = keyword.trim().toLowerCase();
    if (needle && haystack.includes(needle)) return "excluded_keyword";
  }
  return null;
}

/**
 * Maps the places a provider returned, drops the ones the campaign excludes and
 * keeps at most `maxResults`. Shared by every provider so the rules are the same
 * with the stub as with the real search. Rejections are counted, never silent.
 */
export function processPlaces(
  places: unknown[],
  query: BusinessSearchQuery,
  source: FoundBusiness["source"],
): SearchResults {
  const businesses: FoundBusiness[] = [];
  const rejected: SearchResults["rejected"] = {};
  const reject = (reason: RejectionReason) => {
    rejected[reason] = (rejected[reason] ?? 0) + 1;
  };
  for (const place of places) {
    const business = mapPlace(place, source);
    if (!business) {
      reject("unusable");
      continue;
    }
    const reason = rejectionFor(business, place as RawPlace, query);
    if (reason) reject(reason);
    else if (businesses.length < query.maxResults) businesses.push(business);
  }
  return { businesses, rawCount: places.length, rejected };
}

/** The search terms: the campaign's keywords, or its industry when it has none. */
export function searchTerms(query: BusinessSearchQuery): string[] {
  const keywords = query.keywords.map((word) => word.trim()).filter(Boolean);
  return keywords.length > 0 ? keywords : [query.industry];
}

/** The stub's n-th place, shaped like the real provider's output. */
function syntheticPlace(index: number): RawPlace {
  const number = index + 1;
  const place: RawPlace = {
    title: `Synthetic Business ${number} Ltd`,
    placeId: `stub-place-${number}`,
    address: `${number} Synthetic Road, Accra`,
    phoneUnformatted: `+23320000${String(number).padStart(4, "0")}`,
    website: `https://www.synthetic-business-${number}.example`,
    totalScore: 4.2,
    categoryName: "Import company",
  };
  // Every few places break one rule, so a local run shows the filters working.
  if (number % 7 === 3) delete place.website;
  // Some have social pages, so a local run shows them.
  if (number % 2 === 1) {
    place.facebooks = [`https://www.facebook.com/synthetic.business.${number}`];
    place.instagrams = [
      `https://www.instagram.com/synthetic_business_${number}`,
    ];
  }
  if (number % 7 === 5) place.totalScore = 2.8;
  if (number % 11 === 0) place.permanentlyClosed = true;
  if (number % 13 === 0) place.categoryName = "Bank";
  return place;
}

/**
 * Local and test provider: nothing leaves the machine and every business is
 * synthetic (source "stub"). Used whenever no Apify token is configured.
 */
export class StubBusinessSearchProvider implements BusinessSearchProvider {
  readonly name = "stub";
  readonly started: BusinessSearchQuery[] = [];
  /** Answers "running" this many times before a search finishes, for tests. */
  pendingPolls = 0;
  /** Makes searches fail with this message, for tests. */
  failWith: string | null = null;
  /** Makes starting a search throw this message, for tests. */
  failStartWith: string | null = null;

  async start(query: BusinessSearchQuery) {
    if (this.failStartWith) throw new Error(this.failStartWith);
    this.started.push(query);
    return { providerRunId: `stub-run-${this.started.length}` };
  }

  async poll(providerRunId: string): Promise<SearchProgress> {
    if (this.pendingPolls > 0) {
      this.pendingPolls -= 1;
      return { state: "running" };
    }
    if (this.failWith) return { state: "failed", message: this.failWith };
    return {
      state: "succeeded",
      datasetId: providerRunId.replace("run", "dataset"),
    };
  }

  async fetchResults(
    _datasetId: string,
    query: BusinessSearchQuery,
  ): Promise<SearchResults> {
    // Ask for more than wanted, as a real search can, so the filters have work to do.
    const places = Array.from({ length: query.maxResults + 3 }, (_, index) =>
      syntheticPlace(index),
    );
    return processPlaces(places, query, "stub");
  }
}
