import type { KnowledgeEntryInput } from "@bjh/contracts";
import { authenticatedFetch } from "../../auth/authenticatedFetch";

export type KnowledgeEntry = {
  id: string;
  title: string;
  answer: string;
  updatedAt: string;
  updatedBy: string | null;
  /** Drafted from BJH's website and company profile; not yet checked. */
  needsReview: boolean;
};

const apiBaseUrl =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:3001/api";
const knowledgeUrl = `${apiBaseUrl.replace(/\/$/, "")}/v1/knowledge`;

async function send<T>(
  path: string,
  method: string,
  body?: unknown,
): Promise<T> {
  const response = await authenticatedFetch(`${knowledgeUrl}${path}`, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const failure = (await response.json().catch(() => null)) as {
      message?: string | string[];
    } | null;
    const message = Array.isArray(failure?.message)
      ? failure.message.join(", ")
      : failure?.message;
    throw new Error(message ?? "The request could not be completed");
  }
  return response.status === 204
    ? (undefined as T)
    : ((await response.json()) as T);
}

export const listKnowledge = () => send<KnowledgeEntry[]>("", "GET");
export const createKnowledge = (entry: KnowledgeEntryInput) =>
  send<KnowledgeEntry>("", "POST", entry);
export const updateKnowledge = (id: string, entry: KnowledgeEntryInput) =>
  send<KnowledgeEntry>(`/${encodeURIComponent(id)}`, "PUT", entry);
export const markKnowledgeReviewed = (id: string) =>
  send<KnowledgeEntry>(`/${encodeURIComponent(id)}/reviewed`, "POST");
export const deleteKnowledge = (id: string) =>
  send<void>(`/${encodeURIComponent(id)}`, "DELETE");
