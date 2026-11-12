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

export type SalesEmailSendStatus =
  | "mailbox"
  | "queued"
  | "sending"
  | "accepted"
  | "failed"
  | "unknown"
  | "stubbed";

export interface SalesEmailAddress {
  name: string | null;
  email: string;
}

export interface SalesEmailAttachment {
  id: string;
  filename: string;
  sizeBytes: number;
  available: boolean;
}

export interface SalesEmailMessage {
  id: string;
  folder: string | null;
  direction: "incoming" | "outgoing";
  source: "mailbox" | "platform";
  sendStatus: SalesEmailSendStatus;
  messageId: string | null;
  inReplyTo: string | null;
  references: string[];
  fromName: string | null;
  fromEmail: string;
  to: SalesEmailAddress[];
  cc: SalesEmailAddress[];
  subject: string;
  body: string;
  bodyTruncated: boolean;
  receivedAt: string | null;
  acceptedAt: string | null;
  createdAt: string;
  error: string | null;
}

export interface SyncedSalesEmail {
  folder: string;
  uidValidity: string;
  uid: number;
  messageId: string | null;
  inReplyTo: string | null;
  references: string[];
  direction: "incoming" | "outgoing";
  fromName: string | null;
  fromEmail: string;
  to: SalesEmailAddress[];
  cc: SalesEmailAddress[];
  subject: string;
  body: string;
  receivedAt: string;
}

export interface NewSalesEmailSend {
  id: string;
  draftId?: string;
  fromEmail: string;
  recipientEmail: string;
  subject: string;
  body: string;
  campaignIds: string[];
  createdBy: string;
  inReplyTo?: string;
  references?: string[];
}

export interface SalesEmailSendRequestResult {
  payloadHash: string;
  queued: number;
  suppressed: number;
}

export interface ClaimedSalesEmailSend {
  id: string;
  recipientEmail: string;
  subject: string;
  body: string;
  inReplyTo: string | null;
  references: string[];
}

export interface SalesEmailFilter {
  folder?: string;
  search?: string;
  limit: number;
  offset: number;
}

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
  prospectId?: string;
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
    emailContext: string | null;
    callToAction: string | null;
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

export interface PipelinePerformance {
  total: number;
  open: number;
  won: number;
  lost: number;
  /** Average days from a lead being logged to it being won; null when none is won. */
  avgDaysToWin: number | null;
  /** Leads now in each stage. */
  byStage: Record<string, number>;
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
  /** Generated (campaign) leads only. */
  leads: {
    open: number;
    followUpsDue: number;
    won: number;
    lost: number;
  };
  /** Manual and generated leads side by side; the two are never added together. */
  pipelines: Record<"manual" | "generated", PipelinePerformance>;
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
