import type { QuoteBasis, ServiceLine } from "@bjh/contracts";
import { authenticatedFetch } from "../auth/authenticatedFetch";

export type QuoteLine = {
  id: string;
  position: number;
  section: string | null;
  description: string;
  details: string | null;
  basis: QuoteBasis;
  basisNote: string | null;
  /** Unit price; the line total is this times `quantity`. */
  amountMinor: number | null;
  quantity: number;
  containerSize: string | null;
  sizeAmountsMinor: number[] | null;
};

export type QuoteVersion = {
  id: string;
  versionNumber: number;
  status: "draft" | "issued";
  currency: string;
  title: string;
  subtitle: string | null;
  shipmentScope: string | null;
  intro: string | null;
  atCostNote: string | null;
  procedureSteps: string[];
  requiredDocuments: string[];
  documentsNote: string | null;
  timeline: string | null;
  terms: string[];
  sizeLabels: string[];
  issuedAt: string | null;
  lines: QuoteLine[];
};

export type QuoteSummary = {
  id: string;
  quoteNumber: string | null;
  serviceLine: ServiceLine;
  customerCompanyName: string;
  createdAt: string;
  latestVersionNumber: number;
  latestStatus: "draft" | "issued";
  title: string;
  currency: string;
};

export type QuoteDecision = {
  id: string;
  versionNumber: number;
  decision: "accepted" | "rejected";
  clientSignatory: string;
  decidedAt: string;
  note: string | null;
};

export type Quote = {
  id: string;
  quoteNumber: string | null;
  serviceLine: ServiceLine;
  customerCompanyId: string;
  customerCompanyName: string;
  createdAt: string;
  versions: QuoteVersion[];
  decisions: QuoteDecision[];
  jobId: string | null;
};

/** The request body for a version, in minor units. */
export type QuoteVersionBody = {
  currency: string;
  title: string;
  subtitle?: string;
  shipmentScope?: string;
  intro?: string;
  atCostNote?: string;
  procedureSteps: string[];
  requiredDocuments: string[];
  documentsNote?: string;
  timeline?: string;
  terms: string[];
  sizeLabels: string[];
  lines: Array<{
    section?: string;
    description: string;
    details?: string;
    basis: QuoteBasis;
    basisNote?: string;
    containerSize?: string;
    quantity?: number;
    amountMinor?: number;
    sizeAmountsMinor?: number[];
  }>;
};

const apiBaseUrl =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:3001/api";
const quotesUrl = `${apiBaseUrl.replace(/\/$/, "")}/v1/quotes`;

async function send<T>(
  path: string,
  method: string,
  body?: unknown,
): Promise<T> {
  const response = await authenticatedFetch(`${quotesUrl}${path}`, {
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
  return (await response.json()) as T;
}

export const listQuotes = () => send<QuoteSummary[]>("", "GET");
export const getQuote = (id: string) =>
  send<Quote>(`/${encodeURIComponent(id)}`, "GET");
export const createQuote = (input: {
  customerCompanyId: string;
  serviceLine: ServiceLine;
  /** The customer request this quote answers, if any. */
  quoteRequestId?: string;
  version: QuoteVersionBody;
}) => send<Quote>("", "POST", input);
export const saveQuoteDraft = (id: string, body: QuoteVersionBody) =>
  send<Quote>(`/${encodeURIComponent(id)}/draft`, "PUT", body);
export const startQuoteVersion = (id: string) =>
  send<Quote>(`/${encodeURIComponent(id)}/versions`, "POST", {});
export const issueQuote = (id: string) =>
  send<Quote>(`/${encodeURIComponent(id)}/issue`, "POST", {});

export const recordQuoteDecision = (
  id: string,
  input: {
    versionNumber: number;
    decision: "accepted" | "rejected";
    clientSignatory: string;
    decidedAt?: string;
    note?: string;
  },
) =>
  send<{
    decision: QuoteDecision;
    job: { id: string; fileNumber: string } | null;
  }>(`/${encodeURIComponent(id)}/decision`, "POST", input);

/** A customer answers the latest issued version of their own company's quote. */
export const respondToQuote = (
  id: string,
  input: {
    versionNumber: number;
    decision: "accepted" | "rejected";
    clientSignatory: string;
    note?: string;
  },
) =>
  send<{
    decision: QuoteDecision;
    job: { id: string; fileNumber: string } | null;
  }>(`/${encodeURIComponent(id)}/respond`, "POST", input);

/** The quote version as a PDF file. */
export async function fetchQuotePdf(
  id: string,
  versionNumber: number,
): Promise<Blob> {
  const response = await authenticatedFetch(
    `${quotesUrl}/${encodeURIComponent(id)}/pdf?version=${versionNumber}`,
  );
  if (!response.ok) throw new Error("The PDF could not be created");
  return response.blob();
}

/** Minor units to a display string, e.g. 25000 + USD -> "$250.00". */
export function formatMoney(minor: number, currency: string): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
  }).format(minor / 100);
}

/** "250.5" -> 25050; empty -> undefined; anything else -> NaN. */
export function toMinor(value: string): number | undefined {
  const text = value.trim();
  if (!text) return undefined;
  return /^\d+(\.\d{1,2})?$/.test(text) ? Math.round(Number(text) * 100) : NaN;
}
