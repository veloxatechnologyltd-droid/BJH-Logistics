import { authenticatedFetch } from "../auth/authenticatedFetch";

const apiBaseUrl = (
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:3001/api"
).replace(/\/$/, "");
const supportUrl = `${apiBaseUrl}/v1/support`;

export type SupportKind = "problem" | "feature" | "question";
export type SupportStatus = "new" | "in_progress" | "done";

export type SupportMessage = {
  id: string;
  /** The super admin answering, or the person who sent the request. */
  authorRole: "support" | "reporter";
  authorName: string | null;
  body: string;
  createdAt: string;
};

export type SupportRequest = {
  id: string;
  reporterName: string | null;
  reporterKind: "staff" | "customer";
  companyName: string | null;
  kind: SupportKind;
  description: string;
  pagePath: string | null;
  userAgent: string | null;
  lastError: string | null;
  status: SupportStatus;
  messages: SupportMessage[];
  createdAt: string;
  updatedAt: string;
};

export const kindLabels: Record<SupportKind, string> = {
  problem: "Problem",
  feature: "Feature request",
  question: "Question",
};

export const statusLabels: Record<SupportStatus, string> = {
  new: "Received",
  in_progress: "Being worked on",
  done: "Done",
};

async function read<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      message?: string;
    } | null;
    throw new Error(body?.message ?? "The request could not be completed");
  }
  return (await response.json()) as T;
}

const send = async <T>(url: string, method: string, body: unknown) =>
  read<T>(
    await authenticatedFetch(url, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );

export const createSupportRequest = (input: {
  kind: SupportKind;
  description: string;
  pagePath: string;
  userAgent: string;
  lastError: string | null;
}) => send<SupportRequest>(supportUrl, "POST", input);

export const listMySupportRequests = async () =>
  read<SupportRequest[]>(await authenticatedFetch(`${supportUrl}/mine`));

export const listAllSupportRequests = async () =>
  read<SupportRequest[]>(await authenticatedFetch(supportUrl));

export const setSupportStatus = (id: string, status: SupportStatus) =>
  send<SupportRequest>(`${supportUrl}/${encodeURIComponent(id)}`, "PATCH", {
    status,
  });

/** The super admin answers a request; its sender is emailed. */
export const replyAsSupport = (id: string, body: string) =>
  send<SupportRequest>(
    `${supportUrl}/${encodeURIComponent(id)}/replies`,
    "POST",
    { body },
  );

/** The person who sent a request writes again on it. */
export const replyToMyRequest = (id: string, body: string) =>
  send<SupportRequest>(
    `${supportUrl}/mine/${encodeURIComponent(id)}/replies`,
    "POST",
    { body },
  );

/**
 * The last error the error popup showed in this tab, so a report can carry it.
 * Kept in memory only: it may hold business wording, and office PCs are shared.
 */
let lastShownError: string | null = null;
export const rememberShownError = (message: string) => {
  lastShownError = message.slice(0, 1000);
};
export const shownError = () => lastShownError;

/** Asks the Get help button to open, already set to "Problem". */
export const openSupportEvent = "bjh:open-support";

/** Whether a Get help button is on screen (not on the sign-in pages). */
let supportButtons = 0;
export const supportButtonMounted = () => {
  supportButtons += 1;
  return () => {
    supportButtons -= 1;
  };
};
export const supportAvailable = () => supportButtons > 0;
