import { authenticatedFetch } from "../auth/authenticatedFetch";

import type {
  QuoteRequestInput,
  RequestDetails,
  RequestKind,
  RequestReplyInput,
  ServiceLine,
} from "@bjh/contracts";
import type { QuoteLine, QuoteVersion } from "../quotes/quoteApi";

/** How a request reached BJH; staff only, and null on requests from before it was recorded. */
export type RequestSource = "portal" | "staff" | "email" | "website";

export const requestSourceLabels: Record<RequestSource, string> = {
  portal: "Client portal",
  staff: "Entered by staff",
  email: "Email",
  website: "Website form",
};

export type RequestMailbox = "quotes" | "inquiries";

export type QuoteRequest = {
  id: string;
  companyName: string;
  contactName: string;
  email: string;
  message: string;
  createdAt: string;
  source: RequestSource | null;
  /** The inbox it belongs to: quote requests, or questions (inquiries). */
  mailbox: RequestMailbox;
  customerCompanyId: string | null;
  customerCompanyName: string | null;
  /** The quote prepared for this request (the newest one), if any. */
  quoteId: string | null;
  quoteNumber: string | null;
  quoteStatus: "draft" | "issued" | null;
  /** Service, route, cargo and so on; every detail may be unknown. */
  details: RequestDetails;
  /** Set only on a request that arrived by email, and only for staff. */
  intake: RequestIntake | null;
  /** On a staff view of an email request: whether they may check, correct and re-read it (the super admin, or the rep in charge of its service). */
  canCheck?: boolean;
  /** On a staff view of an unlinked email request: the customer whose contact wrote it. */
  suggestedCustomer?: { id: string; companyName: string } | null;
};

export type RequestIntake = {
  subject: string;
  fromName: string | null;
  fromEmail: string;
  receivedAt: string;
  extractionStatus: "pending" | "done" | "failed";
  extractionError: string | null;
  reviewedAt: string | null;
  reviewedBy: string | null;
  attachments: Array<{
    id: string;
    filename: string;
    contentType: string;
    sizeBytes: number;
  }>;
  skippedAttachments: Array<{ filename: string; reason: string }>;
  /** A request for a quote, a question, or something else, as AI read it. */
  kind: RequestKind | null;
  /** What the assistant did with the email, in order. */
  assistantNotes: string[];
  /** The reply the assistant drafted, as last saved; null until one is drafted. */
  reply: {
    subject: string;
    body: string;
    model: string | null;
    draftedAt: string | null;
    sentAt: string | null;
    sentBy: string | null;
    sentByAssistant: boolean;
    /** Titles of the knowledge entries the drafted reply drew on. */
    sources: string[];
  } | null;
  /** The assistant could not answer by itself, and why: a person must read and send the reply. */
  escalation: { at: string; reason: string } | null;
};

/** The assistant thinks the email reached the wrong mailbox. */
export function misfiledLabel(request: QuoteRequest): string | null {
  const kind = request.intake?.kind;
  if (request.mailbox === "quotes" && kind === "inquiry") {
    return "Looks like a question: move to Inquiries";
  }
  if (request.mailbox === "inquiries" && kind === "quote") {
    return "Looks like a quote request: move to Requests";
  }
  return null;
}

export type NewQuoteRequest = QuoteRequestInput;

const apiBaseUrl =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:3001/api";
const quoteRequestsUrl = `${apiBaseUrl.replace(/\/$/, "")}/v1/quote-requests`;

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

/** One inbox's requests: quote requests unless inquiries are asked for. */
export async function listQuoteRequests(
  customerCompanyId?: string,
  mailbox: RequestMailbox = "quotes",
): Promise<QuoteRequest[]> {
  const query = new URLSearchParams();
  if (customerCompanyId) {
    query.set("customerCompanyId", customerCompanyId);
  }
  if (mailbox !== "quotes") query.set("mailbox", mailbox);
  const queryString = query.size > 0 ? `?${query}` : "";
  return readResponse<QuoteRequest[]>(
    await authenticatedFetch(`${quoteRequestsUrl}${queryString}`),
  );
}

export async function getQuoteRequest(id: string): Promise<QuoteRequest> {
  return readResponse<QuoteRequest>(
    await authenticatedFetch(`${quoteRequestsUrl}/${encodeURIComponent(id)}`),
  );
}

export async function createQuoteRequest(
  request: NewQuoteRequest,
): Promise<QuoteRequest> {
  return readResponse<QuoteRequest>(
    await authenticatedFetch(quoteRequestsUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    }),
  );
}

/** A customer's own request: the company and email come from their account. */
export async function createPortalQuoteRequest(request: {
  contactName: string;
  message: string;
  companyId?: string;
}): Promise<QuoteRequest> {
  return readResponse<QuoteRequest>(
    await authenticatedFetch(`${quoteRequestsUrl}/mine`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    }),
  );
}

export async function associateQuoteRequestCustomer(
  requestId: string,
  customerCompanyId: string,
): Promise<QuoteRequest> {
  return readResponse<QuoteRequest>(
    await authenticatedFetch(
      `${quoteRequestsUrl}/${encodeURIComponent(requestId)}/customer`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ customerCompanyId }),
      },
    ),
  );
}

/** A person's corrected details; saving them marks the request as checked. */
export async function saveRequestDetails(
  requestId: string,
  details: RequestDetails,
): Promise<QuoteRequest> {
  return readResponse<QuoteRequest>(
    await authenticatedFetch(
      `${quoteRequestsUrl}/${encodeURIComponent(requestId)}/details`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(details),
      },
    ),
  );
}

export async function readRequestEmailAgain(
  requestId: string,
): Promise<QuoteRequest> {
  return readResponse<QuoteRequest>(
    await authenticatedFetch(
      `${quoteRequestsUrl}/${encodeURIComponent(requestId)}/read-email`,
      { method: "POST" },
    ),
  );
}

export async function getRequestAttachmentLink(
  requestId: string,
  attachmentId: string,
): Promise<{ url: string; filename: string }> {
  return readResponse<{ url: string; filename: string }>(
    await authenticatedFetch(
      `${quoteRequestsUrl}/${encodeURIComponent(requestId)}/attachments/${encodeURIComponent(attachmentId)}`,
    ),
  );
}

/** Moves an email request to the other inbox. */
export async function moveRequestMailbox(
  requestId: string,
  mailbox: RequestMailbox,
): Promise<QuoteRequest> {
  return readResponse<QuoteRequest>(
    await authenticatedFetch(
      `${quoteRequestsUrl}/${encodeURIComponent(requestId)}/mailbox`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mailbox }),
      },
    ),
  );
}

/** Drafts the reply to an email request again. */
export async function draftRequestReply(
  requestId: string,
): Promise<QuoteRequest> {
  return readResponse<QuoteRequest>(
    await authenticatedFetch(
      `${quoteRequestsUrl}/${encodeURIComponent(requestId)}/reply/draft`,
      { method: "POST" },
    ),
  );
}

/** Saves a person's edit of the reply. */
export async function saveRequestReply(
  requestId: string,
  reply: RequestReplyInput,
): Promise<QuoteRequest> {
  return readResponse<QuoteRequest>(
    await authenticatedFetch(
      `${quoteRequestsUrl}/${encodeURIComponent(requestId)}/reply`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(reply),
      },
    ),
  );
}

/** Sends the reply by email to the sender; a request's reply is sent once. */
export async function sendRequestReply(
  requestId: string,
  reply: RequestReplyInput,
): Promise<QuoteRequest> {
  return readResponse<QuoteRequest>(
    await authenticatedFetch(
      `${quoteRequestsUrl}/${encodeURIComponent(requestId)}/reply/send`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(reply),
      },
    ),
  );
}

/** A starting draft for a request's quote, copied from the most similar past issued quote; nothing is saved. */
export type QuoteSuggestion = {
  serviceLine: ServiceLine;
  basedOn: {
    quoteId: string;
    quoteNumber: string | null;
    versionNumber: number;
    customerCompanyName: string;
    match: "same route" | "same destination" | "same service";
  } | null;
  version: Omit<
    QuoteVersion,
    "id" | "versionNumber" | "status" | "issuedAt" | "lines"
  > & {
    lines: Array<Omit<QuoteLine, "id" | "position">>;
  };
};

export async function getQuoteSuggestion(
  requestId: string,
): Promise<QuoteSuggestion> {
  return readResponse<QuoteSuggestion>(
    await authenticatedFetch(
      `${quoteRequestsUrl}/${encodeURIComponent(requestId)}/quote-suggestion`,
    ),
  );
}

const apiRoot = apiBaseUrl.replace(/\/$/, "");

export type StaffNotice = {
  id: string;
  kind: "request_overdue" | "inquiry_overdue" | "reminder";
  quoteRequestId: string | null;
  title: string;
  note: string | null;
  dueAt: string;
};

/** The signed-in person's notices: due now, and reminders still to come. */
export async function listStaffNotices(): Promise<{
  due: StaffNotice[];
  upcoming: StaffNotice[];
}> {
  return readResponse(
    await authenticatedFetch(`${apiRoot}/v1/staff-notifications`),
  );
}

async function postNotice(path: string, body: unknown = {}) {
  return readResponse<StaffNotice>(
    await authenticatedFetch(`${apiRoot}/v1${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

export const dismissStaffNotice = (id: string) =>
  postNotice(`/staff-notifications/${encodeURIComponent(id)}/dismiss`);
export const snoozeStaffNotice = (id: string, minutes: number) =>
  postNotice(`/staff-notifications/${encodeURIComponent(id)}/snooze`, {
    minutes,
  });
/** "I will attend to this on <date, time>": pops up for this person then. */
export const remindAboutRequest = (
  requestId: string,
  remindAt: string,
  note?: string,
) =>
  postNotice(`/quote-requests/${encodeURIComponent(requestId)}/reminders`, {
    remindAt,
    note,
  });
