import { authenticatedFetch } from "./auth/authenticatedFetch";

const apiBaseUrl = (
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:3001/api"
).replace(/\/$/, "");

/** The numbers beside the staff menu, counted by the API. */
export type WorkspaceBadges = {
  newQuoteRequests: number;
  inquiriesForAPerson: number;
  draftQuotes: number;
  failedMessages: number;
  /** Zero for anyone outside customer service. */
  chatUnread: number;
};

export async function getWorkspaceBadges(): Promise<WorkspaceBadges> {
  const response = await authenticatedFetch(
    `${apiBaseUrl}/v1/workspace/badges`,
  );
  if (!response.ok) throw new Error("Menu counts are unavailable");
  return (await response.json()) as WorkspaceBadges;
}
