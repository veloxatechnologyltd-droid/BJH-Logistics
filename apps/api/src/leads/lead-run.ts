import type { FoundBusiness } from "./business-search";
import type { DuplicateKind } from "./duplicate-check";
import type {
  FitRules,
  FitScore,
  ProspectForScoring,
} from "./prospect-scoring";

/** The working steps of a running campaign run (`app.lead_campaign_run.current_step`). */
export type LeadRunStep =
  "searching" | "enriching" | "scoring" | "qualifying" | "drafting";

/** The campaign's settings a run needs: what to search for, and the fit rules. */
export interface LeadRunCampaign extends FitRules {
  campaignId: string;
  /** Whether the run ends by drafting emails for the businesses that qualify. */
  generateEmails: boolean;
  searchKeywords: string[];
  excludedKeywords: string[];
  minRating: number | null;
  requireWebsite: boolean;
}

/** A run the pipeline holds for one tick. `claimId` proves it is still this worker's. */
export interface ClaimedLeadRun {
  runId: string;
  claimId: string;
  /** The person who started the run: the drafts it writes are made in their name. */
  createdBy: string;
  step: LeadRunStep;
  /** The most prospects the run may store (the campaign's maximum when it started). */
  targetCount: number;
  providerRunId: string | null;
  providerDatasetId: string | null;
  /** Failed attempts in a row; a claim that took over from a dead worker counts as one. */
  attemptCount: number;
  campaign: LeadRunCampaign;
}

/** One business to store, with the id its row will have and any duplicate flag. */
export interface NewProspect {
  prospectId: string;
  business: FoundBusiness;
  duplicate: { kind: DuplicateKind; ref: string; reason: string } | null;
}

export interface ProspectToEnrich {
  prospectId: string;
  website: string | null;
  emails: string[];
  phones: string[];
}

/** What reading a prospect's website found; written to the prospect row. */
export interface ProspectEnrichment {
  status: "email_found" | "email_missing" | "failed";
  error: string | null;
  /** All addresses and numbers the prospect now has, best first. */
  emails: string[];
  phones: string[];
  /** Kept only until the prospect is scored. */
  excerpt: string | null;
}

export interface ProspectToScore {
  prospectId: string;
  prospect: ProspectForScoring;
}

export type { FitScore };
