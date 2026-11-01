import { authenticatedFetch } from "../auth/authenticatedFetch";

const apiBaseUrl = (
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:3001/api"
).replace(/\/$/, "");
const chatUrl = `${apiBaseUrl}/v1/chat`;

export type ChatMessage = {
  id: string;
  direction: "from_client" | "to_client";
  channel: "portal" | "email";
  body: string;
  authorName: string | null;
  emailFrom: string | null;
  createdAt: string;
  readAt: string | null;
};

export type ChatThread = {
  companyId: string;
  companyName: string;
  customerNumber: string | null;
  lastMessageAt: string;
  lastBody: string;
  lastDirection: ChatMessage["direction"];
  unread: number;
};

export type Conversation = {
  company: { id: string; companyName: string; customerNumber: string | null };
  messages: ChatMessage[];
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

const post = async <T>(url: string, body: unknown) =>
  read<T>(
    await authenticatedFetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );

export const listChatThreads = async () =>
  read<ChatThread[]>(await authenticatedFetch(`${chatUrl}/threads`));
export const getConversation = async (companyId: string) =>
  read<Conversation>(
    await authenticatedFetch(
      `${chatUrl}/threads/${encodeURIComponent(companyId)}`,
    ),
  );
export const replyToClient = (companyId: string, body: string) =>
  post<ChatMessage>(`${chatUrl}/threads/${encodeURIComponent(companyId)}`, {
    body,
  });
export const getMyConversation = async () =>
  read<Conversation>(await authenticatedFetch(`${chatUrl}/mine`));
export const writeToBjh = (body: string) =>
  post<ChatMessage>(`${chatUrl}/mine`, { body });
