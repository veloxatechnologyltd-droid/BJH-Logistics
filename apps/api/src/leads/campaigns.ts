import type { CampaignStatus } from "@bjh/contracts";
import type { DuplicateKind } from "./duplicate-check";

/** One search run of a campaign, as staff see it. */
export interface LeadRunRecord {
  id: string;
  campaignId: string;
  status: "queued" | "running" | "ready" | "failed" | "cancelled";
  step: string;
  targetCount: number;
  foundCount: number;
  storedCount: number;
  duplicateCount: number;
  qualifiedCount: number;
  disqualifiedCount: number;
  failedCount: number;
  /** Safe to show staff; set when the run failed. */
  errorMessage: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

export interface LeadCampaignRecord {
  id: string;
  name: string;
  status: CampaignStatus;
  targetService: string;
  targetIndustry: string;
  targetLocation: string;
  searchKeywords: string[];
  excludedKeywords: string[];
  minRating: number | null;
  requireWebsite: boolean;
  idealCustomerProfile: string | null;
  disqualifiers: string | null;
  qualificationThreshold: number;
  maxProspects: number;
  createdBy: string;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
  prospectCount: number;
  promotedCount: number;
  latestRun: LeadRunRecord | null;
}

/** The settings of a campaign, without what the database fills in. */
export type NewLeadCampaign = Pick<
  LeadCampaignRecord,
  | "id"
  | "name"
  | "targetService"
  | "targetIndustry"
  | "targetLocation"
  | "searchKeywords"
  | "excludedKeywords"
  | "minRating"
  | "requireWebsite"
  | "idealCustomerProfile"
  | "disqualifiers"
  | "qualificationThreshold"
  | "maxProspects"
  | "createdBy"
>;

export type LeadCampaignChange = Partial<
  Omit<NewLeadCampaign, "id" | "createdBy"> & { status: CampaignStatus }
>;

/** A business a campaign found: kept for staff to review, not yet a lead. */
export interface ProspectRecord {
  id: string;
  campaignId: string;
  runId: string | null;
  businessName: string;
  website: string | null;
  address: string | null;
  phones: string[];
  emails: string[];
  rating: number | null;
  category: string | null;
  /** "stub" rows are sample data and must be shown as such. */
  source: "google_maps" | "stub";
  duplicateKind: DuplicateKind | null;
  duplicateRef: string | null;
  duplicateReason: string | null;
  enrichmentStatus: "pending" | "email_found" | "email_missing" | "failed";
  enrichmentError: string | null;
  score: number | null;
  scoreReason: string | null;
  /** "rules" means no AI was used for this score. */
  scoreMethod: "ai" | "rules" | null;
  scoredAt: string | null;
  promotedLeadId: string | null;
  promotedAt: string | null;
  createdAt: string;
}

export interface ProspectFilter {
  runId?: string;
  /** Part of the business name. */
  search?: string;
  minScore?: number;
  /** At or above (true) or below (false) the campaign's threshold. */
  qualified?: boolean;
  /** Flagged as a possible duplicate (true) or not (false). */
  duplicate?: boolean;
  enrichment?: ProspectRecord["enrichmentStatus"];
  promoted?: boolean;
  limit: number;
  offset: number;
}

export type StartRunResult =
  LeadRunRecord | "not_found" | "not_active" | "already_running";

export type PromoteResult =
  | { outcome: "promoted" | "already_promoted"; leadId: string }
  | { outcome: "not_found" };
