import {
  closeReadTeamNotifications,
  pushIsOn,
  turnOnPush,
} from "../push/pushClient";
import { listTeamConversations } from "./teamChatApi";
import {
  conversationPath,
  popupText,
  whatChanged,
} from "./unreadAnnouncements";
import type { Announced, UnreadConversation } from "./unreadAnnouncements";

/**
 * Browser pop-ups for Team chat messages (Evans, 2026-11-04). They come from
 * the page's own 30-second unread poll, so they work while BJH is open in a
 * browser tab (any page, any tab), not after the browser is closed. A pop-up
 * stays on screen until it is clicked or dismissed (browsers that honour
 * `requireInteraction`) and is closed here once the conversation is read.
 */
export interface PopupState {
  announced: Announced;
  popups: Map<string, Notification>;
}

export const newPopupState = (): PopupState => ({
  announced: new Map(),
  popups: new Map(),
});

export type PopupPermission = NotificationPermission | "unsupported";

export const popupPermission = (): PopupPermission =>
  typeof window !== "undefined" && "Notification" in window
    ? Notification.permission
    : "unsupported";

/** Must run from a click: browsers refuse to ask otherwise. */
export async function askForPopups(): Promise<PopupPermission> {
  if (popupPermission() === "unsupported") return "unsupported";
  const answer = await Notification.requestPermission();
  if (answer === "granted") {
    // Also subscribe for notifications that arrive with BJH closed; where the
    // server or browser cannot, the in-page pop-ups below still work.
    await turnOnPush().catch(() => undefined);
    try {
      new Notification("Team chat pop-ups are on", {
        body: "New messages appear here and stay until you read them.",
        icon: "/icon.png",
      });
    } catch {
      // Some browsers cannot make page notifications; the setting still holds.
    }
  }
  return answer;
}

/**
 * Called with each unread poll. `watching` is true while the person is looking
 * at the Team chat page, which already shows what is new: those messages are
 * marked announced without a pop-up.
 */
export async function syncPopups(
  state: PopupState,
  unread: UnreadConversation[],
  options: { watching: boolean; open: (path: string) => void },
): Promise<void> {
  // Without permission nothing is recorded, so turning pop-ups on later
  // announces whatever is still unread.
  if (popupPermission() !== "granted") return;
  // With push on, the server's notifications announce (they also arrive with
  // BJH closed); this page only closes the ones that have been read.
  if (await pushIsOn()) {
    await closeReadTeamNotifications(new Set(unread.map((item) => item.id)));
    return;
  }
  const { announce, close } = whatChanged(state.announced, unread);
  for (const id of close) {
    state.popups.get(id)?.close();
    state.popups.delete(id);
    state.announced.delete(id);
  }
  if (announce.length === 0) return;
  // Recorded first so an overlapping poll does not announce the same message twice.
  for (const item of announce) {
    state.announced.set(item.id, item.lastMessageAt ?? "");
  }
  if (options.watching) return;
  try {
    const summaries = await listTeamConversations();
    for (const item of announce) {
      const summary = summaries.find((entry) => entry.id === item.id);
      if (!summary) continue;
      const { title, body } = popupText(summary, item.unread);
      state.popups.get(item.id)?.close();
      const popup = new Notification(title, {
        body,
        icon: "/icon.png",
        tag: `team-chat:${item.id}`,
        requireInteraction: true,
      });
      popup.onclick = () => {
        window.focus();
        popup.close();
        options.open(conversationPath(item.id));
      };
      popup.onclose = () => {
        if (state.popups.get(item.id) === popup) state.popups.delete(item.id);
      };
      state.popups.set(item.id, popup);
    }
  } catch {
    // Not announced after all (offline, or this browser cannot show page
    // notifications): try again on the next poll.
    for (const item of announce) state.announced.delete(item.id);
  }
}
