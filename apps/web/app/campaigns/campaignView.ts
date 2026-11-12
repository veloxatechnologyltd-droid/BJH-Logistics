import type {
  Campaign,
  CampaignRun,
  CampaignStatus,
  Prospect,
  ProspectFilter,
} from "./campaignApi";

/** The steps of a search, in order, as staff read them. */
export const searchSteps = [
  { key: "searching", label: "Finding businesses" },
  { key: "enriching", label: "Reading their websites" },
  { key: "scoring", label: "Scoring the fit" },
] as const;

/** A search that is still going: waiting its turn or working. */
export const isActiveRun = (run: CampaignRun | null): boolean =>
  run !== null && (run.status === "queued" || run.status === "running");

/** One line saying where a search is. */
export function runLabel(run: CampaignRun): string {
  switch (run.status) {
    case "queued":
      return "Waiting to start";
    case "running":
      return (
        searchSteps.find((step) => step.key === run.step)?.label ?? "Working"
      );
    case "ready":
      return "Finished";
    case "failed":
      return "Failed";
    case "cancelled":
      return "Cancelled";
  }
}

/** How far a running search is, for the step list: -1 before it starts, 3 when it is over. */
export function stepsDone(run: CampaignRun): number {
  if (run.status === "queued") return -1;
  if (run.status === "running") {
    return searchSteps.findIndex((step) => step.key === run.step);
  }
  return run.status === "ready" ? searchSteps.length : -1;
}

const plural = (count: number, one: string, many: string) =>
  `${count} ${count === 1 ? one : many}`;

/** What a finished (or part-done) search came up with, in plain words. */
export function runSummary(run: CampaignRun): string {
  if (run.status === "queued") return "Waiting for its turn.";
  if (run.status === "failed") {
    return run.errorMessage ?? "The search failed.";
  }
  if (run.status === "cancelled" && run.foundCount === 0) {
    return "Stopped before any businesses were found.";
  }
  // Nothing is known until the search comes back, so there is nothing to count yet.
  if (run.status === "running" && run.step === "searching") {
    return "Looking for businesses…";
  }
  const parts = [`Found ${plural(run.foundCount, "business", "businesses")}`];
  if (run.duplicateCount > 0) {
    parts.push(
      `${plural(run.duplicateCount, "looks", "look")} like ${
        run.duplicateCount === 1 ? "one" : "ones"
      } BJH already has`,
    );
  }
  if (run.status === "ready") {
    parts.push(
      `${run.qualifiedCount} fit${run.qualifiedCount === 1 ? "s" : ""} the campaign`,
    );
    if (run.failedCount > 0) {
      parts.push(
        `${plural(run.failedCount, "website", "websites")} could not be read`,
      );
    }
  }
  return `${parts.join("; ")}.`;
}

export const statusLabels: Record<CampaignStatus, string> = {
  active: "Active",
  paused: "Paused",
  archived: "Archived",
};

/** "Simple rules" means no AI was used; the reason is still the rules' own. */
export const scoreMethodLabel = (method: Prospect["scoreMethod"]): string =>
  method === "ai" ? "AI" : method === "rules" ? "Simple rules" : "Not scored";

/** One line a person can read about a campaign's search. */
export const campaignAbout = (
  campaign: Pick<
    Campaign,
    "targetService" | "targetIndustry" | "targetLocation"
  >,
): string =>
  `${campaign.targetService} · ${campaign.targetIndustry} · ${campaign.targetLocation}`;

/** A textarea's lines or comma-separated words as a list: trimmed, no blanks, no repeats. */
export function parseWords(text: string): string[] {
  return [
    ...new Set(
      text
        .split(/[\n,]/)
        .map((word) => word.trim())
        .filter(Boolean),
    ),
  ];
}

export const joinWords = (words: string[]): string => words.join("\n");

/** The query string for the prospect list; nothing chosen means nothing sent. */
export function prospectQuery(filter: ProspectFilter): string {
  const params = new URLSearchParams();
  const search = filter.search?.trim();
  if (search) params.set("search", search);
  for (const name of ["qualified", "duplicate", "promoted"] as const) {
    if (filter[name] !== undefined) params.set(name, String(filter[name]));
  }
  if (filter.limit !== undefined) params.set("limit", String(filter.limit));
  if (filter.offset) params.set("offset", String(filter.offset));
  const text = params.toString();
  return text ? `?${text}` : "";
}

/** The minimum ratings a campaign can ask for (the search tool takes these steps only). */
export const ratingSteps = [3, 3.5, 4, 4.5] as const;

export const startSearchWarning =
  "This starts a search. When BJH's Apify account is connected, a search is charged to it, up to the limit set for each search.";

/**
 * A business's website is text from the open web: it is a link only when it is a
 * plain http or https address (never `javascript:` or the like), otherwise null.
 */
export function safeWebUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.href
      : null;
  } catch {
    return null;
  }
}

/**
 * For the Leads board: which campaign a lead came from. Null for any other source. A link
 * only when this person may open campaigns; a deleted campaign is said so.
 */
export function leadCampaignNote(
  lead: {
    source: string;
    campaignId: string | null;
    campaignName: string | null;
  },
  canOpen: boolean,
): { text: string; href: string | null } | null {
  if (lead.source !== "campaign") return null;
  if (!lead.campaignId || !lead.campaignName) {
    return { text: "The campaign was deleted", href: null };
  }
  return {
    text: lead.campaignName,
    href: canOpen ? `/campaigns/${lead.campaignId}` : null,
  };
}
