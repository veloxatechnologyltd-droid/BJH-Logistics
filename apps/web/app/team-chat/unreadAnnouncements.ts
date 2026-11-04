import type { TeamConversationSummary } from "./teamChatApi";

/** One conversation holding unread messages, as the badge poll reports it. */
export type UnreadConversation = {
  id: string;
  unread: number;
  lastMessageAt: string | null;
};

/** Conversation id -> time of the newest message already announced in a pop-up. */
export type Announced = Map<string, string>;

/**
 * Team chat pop-ups (Evans, 2026-11-04). A conversation is announced when its
 * newest unread message has not been announced yet, and its pop-up is closed
 * once nothing in it is unread any more.
 */
export function whatChanged(
  announced: Announced,
  unread: UnreadConversation[],
) {
  return {
    announce: unread.filter(
      (item) =>
        item.lastMessageAt && announced.get(item.id) !== item.lastMessageAt,
    ),
    close: [...announced.keys()].filter(
      (id) => !unread.some((item) => item.id === id),
    ),
  };
}

const previewLength = 140;

/** The pop-up's title and text for a conversation's newest message. */
export function popupText(summary: TeamConversationSummary, unread: number) {
  const last = summary.lastMessage;
  const text = last?.body.replace(/\s+/g, " ").trim() ?? "";
  const shown =
    text.length > previewLength ? `${text.slice(0, previewLength - 1)}…` : text;
  // In a direct chat the title is already the other person.
  const from =
    last?.authorName && summary.kind !== "direct" ? `${last.authorName}: ` : "";
  return {
    title: unread > 1 ? `${summary.title} (${unread} new)` : summary.title,
    body: `${from}${shown}` || "New message",
  };
}

/** Where a pop-up leads: the Team chat page with that conversation open. */
export const conversationPath = (id: string) =>
  `/team-chat?c=${encodeURIComponent(id)}`;
