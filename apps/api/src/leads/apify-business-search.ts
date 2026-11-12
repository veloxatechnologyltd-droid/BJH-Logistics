import { Logger } from "@nestjs/common";
import {
  BusinessSearchProvider,
  BusinessSearchQuery,
  SearchProgress,
  SearchResults,
  StubBusinessSearchProvider,
  processPlaces,
  searchTerms,
} from "./business-search";

/**
 * Apify's Google Maps scrapers, checked against Apify's API reference, the actors'
 * published input schemas and the Run Actor and Get run pages on 2026-11-11, and the
 * contact-details actor's schema, pricing and a real run on 2026-11-12.
 * Authentication is a Bearer header; `/v2/actors/` replaces the deprecated
 * `/v2/acts/` (Venariq still uses the old path); the run statuses are READY, RUNNING,
 * SUCCEEDED, FAILED, TIMING-OUT, TIMED-OUT, ABORTING and ABORTED.
 *
 * The default actor, `lukaskrivka/google-maps-with-contact-details` (Google Maps Email
 * Extractor), reads each business's website itself and returns `emails` and social
 * pages (`facebooks`, `instagrams`, `linkedIns`, ...) with the place; about $0.01 per
 * business. Its paid add-ons (business-lead enrichment, social profile enrichment)
 * are left off. `compass/crawler-google-places` still works but found no emails in
 * BJH's first real search; its own "contacts from website" add-on is left off too.
 * The website contact finder (plan item 1.4) still runs afterwards and adds what it finds.
 */

const DEFAULT_ACTOR = "lukaskrivka/google-maps-with-contact-details";
const DEFAULT_MAX_CHARGE_USD = 5;
const RUN_TIMEOUT_SECONDS = 900;
const REQUEST_TIMEOUT_MS = 30_000;

/** The actor's star filter accepts these steps only; the nearest step at or below. */
const STAR_STEPS: Array<[number, string]> = [
  [4.5, "fourAndHalf"],
  [4, "four"],
  [3.5, "threeAndHalf"],
  [3, "three"],
  [2.5, "twoAndHalf"],
  [2, "two"],
];

export function minimumStarsFor(minRating: number | null): string | null {
  if (minRating === null) return null;
  return STAR_STEPS.find(([step]) => minRating >= step)?.[1] ?? null;
}

/**
 * The Apify call failed; the message is safe to show staff (no secrets, no raw body).
 * `retryable`: a busy service, a server problem or a network failure that a later
 * attempt may get past. A rejected token, no credit, an unknown actor or a bad
 * request will fail the same way again.
 */
export class ApifyError extends Error {
  constructor(
    message: string,
    readonly retryable = false,
  ) {
    super(message);
  }
}

function problemFor(status: number, errorType: string | null): string {
  if (status === 401 || status === 403) {
    return "Apify did not accept the token that was set up";
  }
  if (status === 402) {
    return "The Apify account has no credit left or is over its plan limit";
  }
  if (status === 404) {
    return "Apify could not find the search tool or the run (check APIFY_ACTOR_ID)";
  }
  if (status === 429) return "Apify is busy; try again in a few minutes";
  return `Apify request failed (${status}${errorType ? `: ${errorType}` : ""})`;
}

export interface ApifySetup {
  token: string;
  actorId: string;
  maxChargeUsd: number;
  baseUrl?: string;
  fetch?: typeof fetch;
}

export class ApifyBusinessSearchProvider implements BusinessSearchProvider {
  readonly name = "apify";
  private readonly baseUrl: string;
  private readonly fetcher: typeof fetch;

  constructor(private readonly setup: ApifySetup) {
    this.baseUrl = setup.baseUrl ?? "https://api.apify.com";
    this.fetcher = setup.fetch ?? fetch;
  }

  async start(query: BusinessSearchQuery) {
    const terms = searchTerms(query);
    const stars = minimumStarsFor(query.minRating);
    // The limit is per search term, so the total is shared between the terms.
    const actor = this.setup.actorId.trim().replace("/", "~");
    const input: Record<string, unknown> = {
      searchStringsArray: terms,
      locationQuery: query.location,
      maxCrawledPlacesPerSearch: Math.ceil(query.maxResults / terms.length),
      language: "en",
      skipClosedPlaces: true,
    };
    if (actor.startsWith("compass~")) {
      // The first actor: its own add-ons that cost extra are switched off.
      Object.assign(input, {
        scrapeContacts: false,
        maxReviews: 0,
        maxImages: 0,
      });
    } else {
      // Contact details come with the place; the paid enrichment add-ons stay off.
      Object.assign(input, {
        scrapeSocialMediaProfiles: {
          facebooks: false,
          instagrams: false,
          youtubes: false,
          tiktoks: false,
          twitters: false,
        },
        maximumLeadsEnrichmentRecords: 0,
      });
    }
    if (stars) input.placeMinimumStars = stars;
    if (query.requireWebsite) input.website = "withWebsite";

    const params = new URLSearchParams({
      maxTotalChargeUsd: String(this.setup.maxChargeUsd),
      timeout: String(RUN_TIMEOUT_SECONDS),
    });
    const run = await this.request<{ id?: unknown }>(
      `/v2/actors/${encodeURIComponent(actor)}/runs?${params}`,
      { method: "POST", body: JSON.stringify(input) },
    );
    if (typeof run.id !== "string" || !run.id) {
      throw new ApifyError("Apify did not return a run id");
    }
    return { providerRunId: run.id };
  }

  async poll(providerRunId: string): Promise<SearchProgress> {
    const run = await this.request<{
      status?: unknown;
      defaultDatasetId?: unknown;
      statusMessage?: unknown;
    }>(`/v2/actor-runs/${encodeURIComponent(providerRunId)}`);
    switch (run.status) {
      case "READY":
      case "RUNNING":
      case "TIMING-OUT":
      case "ABORTING":
        return { state: "running" };
      case "SUCCEEDED":
        if (typeof run.defaultDatasetId !== "string" || !run.defaultDatasetId) {
          throw new ApifyError("Apify finished without a result set");
        }
        return { state: "succeeded", datasetId: run.defaultDatasetId };
      case "FAILED":
      case "ABORTED":
      case "TIMED-OUT": {
        const detail =
          typeof run.statusMessage === "string"
            ? `: ${run.statusMessage.slice(0, 200)}`
            : "";
        return {
          state: "failed",
          message: `The Apify search ended as ${String(run.status).toLowerCase()}${detail}`,
        };
      }
      default:
        throw new ApifyError("Apify returned a run status that is not known");
    }
  }

  async fetchResults(
    datasetId: string,
    query: BusinessSearchQuery,
  ): Promise<SearchResults> {
    // The per-term rounding can return a few more than asked for; filters drop some.
    const limit = query.maxResults + searchTerms(query).length;
    const params = new URLSearchParams({
      format: "json",
      clean: "true",
      limit: String(limit),
    });
    const items = await this.request<unknown>(
      `/v2/datasets/${encodeURIComponent(datasetId)}/items?${params}`,
      {},
      false,
    );
    if (!Array.isArray(items)) {
      throw new ApifyError("Apify returned results in an unexpected shape");
    }
    return processPlaces(items, query, "google_maps");
  }

  /** `wrapped`: run endpoints answer `{data: ...}`; the dataset answers the bare array. */
  private async request<T>(
    path: string,
    init: { method?: string; body?: string } = {},
    wrapped = true,
  ): Promise<T> {
    let response: Response;
    try {
      response = await this.fetcher(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          authorization: `Bearer ${this.setup.token}`,
          "content-type": "application/json",
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new ApifyError("Apify could not be reached", true);
    }
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const type = (body as { error?: { type?: unknown } } | null)?.error?.type;
      throw new ApifyError(
        problemFor(response.status, typeof type === "string" ? type : null),
        response.status === 408 ||
          response.status === 429 ||
          response.status >= 500,
      );
    }
    if (!wrapped) return body as T;
    const data = (body as { data?: unknown } | null)?.data;
    if (typeof data !== "object" || data === null) {
      throw new ApifyError("Apify returned an answer in an unexpected shape");
    }
    return data as T;
  }
}

/** Apify when `APIFY_API_TOKEN` is set; otherwise the synthetic stub. */
export function createBusinessSearchProvider(
  environment: NodeJS.ProcessEnv,
): BusinessSearchProvider {
  const token = environment.APIFY_API_TOKEN?.trim();
  if (!token) return new StubBusinessSearchProvider();
  const configured = Number(environment.APIFY_MAX_CHARGE_USD);
  if (environment.APIFY_MAX_CHARGE_USD && !(configured > 0)) {
    new Logger("BusinessSearch").warn(
      `APIFY_MAX_CHARGE_USD is not a positive number; using ${DEFAULT_MAX_CHARGE_USD}`,
    );
  }
  return new ApifyBusinessSearchProvider({
    token,
    actorId: environment.APIFY_ACTOR_ID?.trim() || DEFAULT_ACTOR,
    maxChargeUsd: configured > 0 ? configured : DEFAULT_MAX_CHARGE_USD,
  });
}
