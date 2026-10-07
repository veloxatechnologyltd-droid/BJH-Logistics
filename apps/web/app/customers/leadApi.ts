import { authenticatedFetch } from "../auth/authenticatedFetch";
import type {
  LeadCreateInput,
  LeadSource,
  LeadStage,
  LeadUpdateInput,
} from "@bjh/contracts";

export type Lead = {
  id: string;
  companyName: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  source: LeadSource;
  stage: LeadStage;
  ownerId: string | null;
  ownerEmail: string | null;
  /** YYYY-MM-DD */
  nextFollowUp: string | null;
  notes: string | null;
  lostReason: string | null;
  quoteRequestId: string | null;
  customerCompanyId: string | null;
  customerCompanyName: string | null;
  createdAt: string;
  updatedAt: string;
  stageChangedAt: string;
  /** A follow-up date has passed on a lead that is still open. */
  followUpOverdue: boolean;
};

export const stageLabels: Record<LeadStage, string> = {
  new: "New",
  contacted: "Contacted",
  quoted: "Quoted",
  won: "Won",
  lost: "Lost",
};

export const sourceLabels: Record<LeadSource, string> = {
  quote_request: "Quote request",
  referral: "Referral",
  walk_in: "Walk-in",
  phone: "Phone",
  email: "Email",
  other: "Other",
};

const apiBaseUrl =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:3001/api";
const leadsUrl = `${apiBaseUrl.replace(/\/$/, "")}/v1/leads`;

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

export async function listLeads(): Promise<Lead[]> {
  return readResponse<Lead[]>(await authenticatedFetch(leadsUrl));
}

export async function createLead(
  lead: Partial<LeadCreateInput> & { companyName: string },
): Promise<Lead> {
  return readResponse<Lead>(
    await authenticatedFetch(leadsUrl, jsonInit("POST", lead)),
  );
}

export async function updateLead(
  id: string,
  update: LeadUpdateInput,
): Promise<Lead> {
  return readResponse<Lead>(
    await authenticatedFetch(
      `${leadsUrl}/${encodeURIComponent(id)}`,
      jsonInit("PATCH", update),
    ),
  );
}
