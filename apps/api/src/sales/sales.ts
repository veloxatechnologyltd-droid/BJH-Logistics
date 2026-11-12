import type { ProspectRecord } from "../leads/campaigns";

/** A business in the lead pool: a prospect from any campaign, with where it came from. */
export interface PoolProspect extends ProspectRecord {
  campaignName: string;
  /** The campaign's score from which a business counts as a good fit. */
  qualificationThreshold: number;
  dismissedAt: string | null;
  /** The newest draft's status; null when no email was ever drafted for it. */
  draftStatus: "pending" | "approved" | "rejected" | null;
}

/**
 * new: not added to leads and not dismissed. added: already a lead. dismissed: set
 * aside. all: everything, dismissed included.
 */
export type PoolStatus = "new" | "added" | "dismissed" | "all";
export type PoolSort = "score" | "newest" | "name";

export interface PoolFilter {
  campaignId?: string;
  status: PoolStatus;
  minScore?: number;
  hasEmail?: boolean;
  /** Flagged as a possible duplicate (true) or not (false). */
  duplicate?: boolean;
  /** Part of the business name, category or address. */
  search?: string;
  sort: PoolSort;
  limit: number;
  offset: number;
}

export type OutreachDraftStatus = "pending" | "approved" | "rejected";

/** An email drafted for a prospect. Nothing here has been sent. */
export interface OutreachDraftRecord {
  id: string;
  prospectId: string;
  businessName: string;
  category: string | null;
  address: string | null;
  website: string | null;
  score: number | null;
  scoreReason: string | null;
  campaignId: string;
  campaignName: string;
  recipientEmail: string;
  subject: string;
  body: string;
  status: OutreachDraftStatus;
  /** ai: written by the model; template: the fixed wording. */
  method: "ai" | "template";
  /** A person changed the wording after it was drafted. */
  edited: boolean;
  rejectedReason: string | null;
  createdByName: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  createdAt: string;
}

export interface OutreachDraftFilter {
  status?: OutreachDraftStatus;
  limit: number;
  offset: number;
}

/** What drafting needs to know about a prospect and the campaign that found it. */
export interface ProspectDraftingInfo {
  prospectId: string;
  businessName: string;
  category: string | null;
  address: string | null;
  emails: string[];
  dismissed: boolean;
  campaign: {
    targetService: string;
    targetIndustry: string;
    targetLocation: string;
  };
}

export interface NewOutreachDraft {
  id: string;
  prospectId: string;
  recipientEmail: string;
  subject: string;
  body: string;
  method: "ai" | "template";
  createdBy: string;
}

export interface SalesOverview {
  pool: {
    /** Waiting for a decision: not added and not dismissed. */
    waiting: number;
    /** Waiting and at or above their campaign's good-fit score. */
    goodFit: number;
    /** Waiting and with an email address to write to. */
    withEmail: number;
    dismissed: number;
  };
  /** How far the businesses found went. Each step counts those that reached it or went further. */
  funnel: {
    found: number;
    goodFit: number;
    addedToLeads: number;
    contacted: number;
    quoted: number;
    won: number;
  };
  leads: {
    open: number;
    followUpsDue: number;
    won: number;
    lost: number;
  };
  drafts: Record<OutreachDraftStatus, number>;
  /** Open leads whose follow-up date has come, oldest first. */
  followUps: Array<{
    leadId: string;
    companyName: string;
    stage: string;
    ownerName: string | null;
    nextFollowUp: string;
    overdue: boolean;
  }>;
  recentActivity: Array<{
    leadId: string;
    companyName: string;
    kind: string;
    note: string;
    occurredAt: string;
    byName: string | null;
  }>;
  campaigns: Array<{
    id: string;
    name: string;
    status: string;
    found: number;
    goodFit: number;
    added: number;
  }>;
}
