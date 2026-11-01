import { authenticatedFetch } from "../auth/authenticatedFetch";

const apiBaseUrl = (
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:3001/api"
).replace(/\/$/, "");
const assistantUrl = `${apiBaseUrl}/v1/assistant`;

/** The conversation exactly as the API returned it; sent back unchanged. */
export type HelperMessage = { role: "user" | "assistant"; content: unknown };

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
    throw new Error(body?.message ?? "The helper could not answer");
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
export const askHelper = (messages: HelperMessage[]) =>
  post<{
    messages: HelperMessage[];
    reply: string;
    proposals: ProposedAction[];
  }>("/turn", { messages });
export const confirmAction = (action: ProposedAction) =>
  post<{ done: true; summary: string }>("/confirm", {
    tool: action.tool,
    input: action.input,
  });
