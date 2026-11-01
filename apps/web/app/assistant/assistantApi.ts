import { authenticatedFetch } from "../auth/authenticatedFetch";

const apiBaseUrl = (
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:3001/api"
).replace(/\/$/, "");
const assistantUrl = `${apiBaseUrl}/v1/assistant`;

/** One line on the screen: a question, an answer or a confirmed action. */
export type HelperLine = { kind: "you" | "helper" | "done"; text: string };

export type ConversationSummary = {
  id: string;
  title: string;
  updatedAt: string;
};

export type ProposedAction = {
  id: string;
  tool: string;
  input: Record<string, unknown>;
  summary: string;
};

async function read<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      message?: string;
    } | null;
    throw new Error(body?.message ?? "Bra Evans could not answer");
  }
  return (await response.json()) as T;
}

const post = async <T>(path: string, body: unknown) =>
  read<T>(
    await authenticatedFetch(`${assistantUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );

export const helperStatus = async () =>
  read<{ enabled: boolean }>(await authenticatedFetch(assistantUrl));
export const listConversations = async () =>
  read<ConversationSummary[]>(
    await authenticatedFetch(`${assistantUrl}/conversations`),
  );
export const openConversation = async (id: string) =>
  read<ConversationSummary & { lines: HelperLine[] }>(
    await authenticatedFetch(`${assistantUrl}/conversations/${id}`),
  );
export async function deleteConversation(id: string): Promise<void> {
  const response = await authenticatedFetch(
    `${assistantUrl}/conversations/${id}`,
    { method: "DELETE" },
  );
  if (!response.ok) throw new Error("The chat could not be deleted");
}
/** Without a conversation ID the API starts a new conversation. */
export const askHelper = (conversationId: string | null, message: string) =>
  post<{
    conversationId: string;
    title: string;
    reply: string;
    proposals: ProposedAction[];
  }>("/turn", { conversationId: conversationId ?? undefined, message });
export const confirmAction = (
  conversationId: string | null,
  action: ProposedAction,
) =>
  post<{ done: true; summary: string }>("/confirm", {
    tool: action.tool,
    input: action.input,
    conversationId: conversationId ?? undefined,
  });
