import { authenticatedFetch } from "../auth/authenticatedFetch";
import type { Prospect } from "../campaigns/campaignApi";

/** A business in the lead pool: a prospect from any campaign. */
export type PoolProspect = Prospect & {
  campaignName: string;
  /** The campaign's score from which a business counts as a good fit. */
  qualificationThreshold: number;
  dismissedAt: string | null;
  /** The newest email draft's state; null when none was drafted. */
  draftStatus: DraftStatus | null;
};

export type PoolStatus = "new" | "added" | "dismissed" | "all";
export type PoolSort = "score" | "newest" | "name";

export type PoolFilter = {
  campaignId?: string;
  status: PoolStatus;
  minScore?: number;
  hasEmail?: boolean;
  search?: string;
  sort: PoolSort;
  limit: number;
  offset: number;
};

export type PoolPage = { items: PoolProspect[]; total: number };

export type DraftStatus = "pending" | "approved" | "rejected";

export type Draft = {
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
  status: DraftStatus;
  /** ai: written by the model; template: the fixed wording. */
  method: "ai" | "template";
  /** A person changed the wording after it was drafted. */
  edited: boolean;
  rejectedReason: string | null;
  createdByName: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  createdAt: string;
};

export type DraftPage = {
  items: Draft[];
  total: number;
  counts: Record<DraftStatus, number>;
};

export type DraftSkipReason =
  "not_found" | "dismissed" | "no_email" | "already_drafted";

export type DraftResult = {
  created: Draft[];
  skipped: Array<{
    prospectId: string;
    businessName: string | null;
    reason: DraftSkipReason;
  }>;
};

export type SalesOverview = {
  pool: {
    waiting: number;
    goodFit: number;
    withEmail: number;
    dismissed: number;
  };
  funnel: {
    found: number;
    goodFit: number;
    addedToLeads: number;
    contacted: number;
    quoted: number;
    won: number;
  };
  leads: { open: number; followUpsDue: number; won: number; lost: number };
  drafts: Record<DraftStatus, number>;
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
};

const apiBaseUrl =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:3001/api";
const salesUrl = `${apiBaseUrl.replace(/\/$/, "")}/v1/sales`;

async function readResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      message?: string | string[];
    } | null;
    const message = Array.isArray(body?.message)
      ? body.message.join(", ")
      : body?.message;
    throw new Error(message ?? "The request could not be completed");
  }
  return (await response.json()) as T;
}

const jsonInit = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

const draftUrl = (id: string) => `${salesUrl}/drafts/${encodeURIComponent(id)}`;

export async function getSalesOverview(): Promise<SalesOverview> {
  return readResponse(await authenticatedFetch(`${salesUrl}/overview`));
}

/** The query string of the pool: only what is set, so the URL stays short. */
export function poolQuery(filter: PoolFilter): string {
  const params = new URLSearchParams();
  params.set("status", filter.status);
  params.set("sort", filter.sort);
  params.set("limit", String(filter.limit));
  params.set("offset", String(filter.offset));
  if (filter.campaignId) params.set("campaignId", filter.campaignId);
  if (filter.minScore) params.set("minScore", String(filter.minScore));
  if (filter.hasEmail) params.set("hasEmail", "true");
  if (filter.search?.trim()) params.set("search", filter.search.trim());
  return `?${params.toString()}`;
}

export async function listPool(filter: PoolFilter): Promise<PoolPage> {
  return readResponse(
    await authenticatedFetch(`${salesUrl}/pool${poolQuery(filter)}`),
  );
}

export async function dismissProspects(
  prospectIds: string[],
  dismissed: boolean,
): Promise<{ changed: number; unchanged: number }> {
  return readResponse(
    await authenticatedFetch(
      `${salesUrl}/pool/dismiss`,
      jsonInit("POST", { prospectIds, dismissed }),
    ),
  );
}

/** Drafts at most 20 at a time (the API's limit); the AI writes each one, so it takes a moment. */
export async function createDrafts(
  prospectIds: string[],
): Promise<DraftResult> {
  return readResponse(
    await authenticatedFetch(
      `${salesUrl}/drafts`,
      jsonInit("POST", { prospectIds }),
    ),
  );
}

export async function listDrafts(
  status: DraftStatus | undefined,
  limit = 50,
  offset = 0,
): Promise<DraftPage> {
  const params = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
  });
  if (status) params.set("status", status);
  return readResponse(
    await authenticatedFetch(`${salesUrl}/drafts?${params.toString()}`),
  );
}

export async function editDraft(
  id: string,
  change: { recipientEmail: string; subject: string; body: string },
): Promise<Draft> {
  return readResponse(
    await authenticatedFetch(draftUrl(id), jsonInit("PATCH", change)),
  );
}

export async function approveDraft(id: string): Promise<Draft> {
  return readResponse(
    await authenticatedFetch(`${draftUrl(id)}/approve`, jsonInit("POST", {})),
  );
}

export async function rejectDraft(id: string, reason: string): Promise<Draft> {
  return readResponse(
    await authenticatedFetch(
      `${draftUrl(id)}/reject`,
      jsonInit("POST", { reason }),
    ),
  );
}

export async function approveDrafts(
  draftIds: string[],
): Promise<{ approved: number; notPending: number; notFound: number }> {
  return readResponse(
    await authenticatedFetch(
      `${salesUrl}/drafts/approve`,
      jsonInit("POST", { draftIds }),
    ),
  );
}

/** Tells the tab bar that the number of emails waiting for approval may have changed. */
export const DRAFTS_CHANGED = "bjh:sales-drafts-changed";
export function announceDraftsChanged() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(DRAFTS_CHANGED));
  }
}
