import { authenticatedFetch } from "../auth/authenticatedFetch";
import { prospectQuery } from "./campaignView";
import type { CampaignCreateInput, CampaignUpdateInput } from "@bjh/contracts";

export type CampaignStatus = "active" | "paused" | "archived";

export type CampaignRun = {
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
  /** Safe to show; set when the run failed. */
  errorMessage: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
};

export type Campaign = {
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
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
  prospectCount: number;
  promotedCount: number;
  latestRun: CampaignRun | null;
};

export type Prospect = {
  id: string;
  campaignId: string;
  businessName: string;
  website: string | null;
  address: string | null;
  phones: string[];
  emails: string[];
  rating: number | null;
  category: string | null;
  /** "stub" rows are sample data. */
  source: "google_maps" | "stub";
  duplicateKind: "prospect" | "customer" | "lead" | null;
  duplicateReason: string | null;
  enrichmentStatus: "pending" | "email_found" | "email_missing" | "failed";
  enrichmentError: string | null;
  score: number | null;
  scoreReason: string | null;
  /** "rules" means no AI was used for this score. */
  scoreMethod: "ai" | "rules" | null;
  promotedLeadId: string | null;
};

export type ProspectFilter = {
  search?: string;
  qualified?: boolean;
  duplicate?: boolean;
  promoted?: boolean;
  limit?: number;
  offset?: number;
};

export type ProspectPage = { items: Prospect[]; total: number };

export type CampaignConfig = {
  searchProvider: string;
  /** The search gives made-up businesses: nothing found is real. */
  sampleData: boolean;
  /** "rules" when no AI is set up. */
  scorer: string;
};

export type PromoteResult = {
  promoted: number;
  alreadyPromoted: number;
  notFound: number;
};

const apiBaseUrl =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:3001/api";
const campaignsUrl = `${apiBaseUrl.replace(/\/$/, "")}/v1/campaigns`;

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

const one = (id: string) => `${campaignsUrl}/${encodeURIComponent(id)}`;

export async function getCampaignConfig(): Promise<CampaignConfig> {
  return readResponse(await authenticatedFetch(`${campaignsUrl}/config`));
}

export async function listCampaigns(): Promise<Campaign[]> {
  return readResponse(await authenticatedFetch(campaignsUrl));
}

export async function getCampaign(id: string): Promise<Campaign> {
  return readResponse(await authenticatedFetch(one(id)));
}

export async function createCampaign(
  input: CampaignCreateInput,
): Promise<Campaign> {
  return readResponse(
    await authenticatedFetch(campaignsUrl, jsonInit("POST", input)),
  );
}

export async function updateCampaign(
  id: string,
  update: CampaignUpdateInput,
): Promise<Campaign> {
  return readResponse(
    await authenticatedFetch(one(id), jsonInit("PATCH", update)),
  );
}

export async function deleteCampaign(id: string): Promise<void> {
  await readResponse(await authenticatedFetch(one(id), { method: "DELETE" }));
}

/** Queues a search. A real one spends BJH's money, up to the cap the API sets. */
export async function startSearch(id: string): Promise<CampaignRun> {
  return readResponse(
    await authenticatedFetch(`${one(id)}/runs`, jsonInit("POST", {})),
  );
}

export async function cancelSearch(
  id: string,
  runId: string,
): Promise<CampaignRun> {
  return readResponse(
    await authenticatedFetch(
      `${one(id)}/runs/${encodeURIComponent(runId)}/cancel`,
      jsonInit("POST", {}),
    ),
  );
}

export async function listProspects(
  id: string,
  filter: ProspectFilter,
): Promise<ProspectPage> {
  return readResponse(
    await authenticatedFetch(`${one(id)}/prospects${prospectQuery(filter)}`),
  );
}

export async function promoteProspects(
  id: string,
  prospectIds: string[],
): Promise<PromoteResult> {
  return readResponse(
    await authenticatedFetch(
      `${one(id)}/prospects/promote`,
      jsonInit("POST", { prospectIds }),
    ),
  );
}
