import { authenticatedFetch } from "../auth/authenticatedFetch";

const apiBaseUrl = (
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:3001/api"
).replace(/\/$/, "");
const chatUrl = `${apiBaseUrl}/v1/team-chat`;

export type TeamTagKind = "user" | "job" | "invoice" | "document";

/** A tag as this person may see it; `href` is null when they cannot open it. */
export type TeamTag = {
  kind: TeamTagKind;
  id: string;
  label: string;
  href: string | null;
};

export type TeamMessage = {
  id: string;
  authorUserId: string | null;
  /** Null for a message the system posted. */
  authorName: string | null;
  /** Written by the person reading it. */
  mine: boolean;
  body: string;
  tags: TeamTag[];
  createdAt: string;
};

export type TeamConversationSummary = {
  id: string;
  kind: "direct" | "group" | "team";
  teamKey: string | null;
  title: string;
  personId: string | null;
  memberCount: number;
  lastMessage: {
    body: string;
    authorName: string | null;
    mine: boolean;
    createdAt: string;
  } | null;
  unread: number;
};

export type TeamConversation = {
  id: string;
  kind: TeamConversationSummary["kind"];
  teamKey: string | null;
  title: string;
  members: Array<{ userId: string; name: string }>;
  messages: TeamMessage[];
  hasEarlier: boolean;
};

export type TeamPerson = {
  userId: string;
  name: string;
  teams: string[];
  you: boolean;
  online: boolean;
  /** Null when not seen since the API last started. */
  lastSeen: string | null;
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

const get = async <T>(path: string) =>
  read<T>(await authenticatedFetch(`${chatUrl}${path}`));
const post = async <T>(path: string, body: unknown = {}) =>
  read<T>(
    await authenticatedFetch(`${chatUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );

export const getTeamUnread = () => get<{ unread: number }>("/unread");
export const listTeamConversations = () =>
  get<TeamConversationSummary[]>("/conversations");
export const listTeamPeople = () => get<TeamPerson[]>("/people");
export const searchTeamTags = (term: string) =>
  get<TeamTag[]>(`/tags?q=${encodeURIComponent(term)}`);
export const openTeamConversation = (id: string, before?: string) =>
  get<TeamConversation>(
    `/conversations/${encodeURIComponent(id)}${
      before ? `?before=${encodeURIComponent(before)}` : ""
    }`,
  );
export const sendTeamMessage = (
  id: string,
  body: string,
  tags: Array<{ kind: TeamTagKind; id: string }>,
) =>
  post<TeamMessage>(`/conversations/${encodeURIComponent(id)}/messages`, {
    body,
    tags,
  });
export const startDirect = (userId: string) =>
  post<{ id: string }>("/conversations/direct", { userId });
export const createGroup = (title: string, memberIds: string[]) =>
  post<{ id: string }>("/conversations/group", { title, memberIds });
export const addGroupMember = (id: string, userId: string) =>
  post<{ added: boolean }>(`/conversations/${encodeURIComponent(id)}/members`, {
    userId,
  });
export const leaveGroup = (id: string) =>
  post<{ left: boolean }>(`/conversations/${encodeURIComponent(id)}/leave`);
