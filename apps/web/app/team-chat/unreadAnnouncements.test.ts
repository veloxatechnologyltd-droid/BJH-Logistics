import assert from "node:assert/strict";
import { test } from "node:test";
import {
  conversationPath,
  popupText,
  whatChanged,
} from "./unreadAnnouncements.ts";
import type { TeamConversationSummary } from "./teamChatApi.ts";

const unread = (id: string, lastMessageAt: string | null, count = 1) => ({
  id,
  unread: count,
  lastMessageAt,
});

test("announces an unread conversation once, and again only for a newer message", () => {
  const announced = new Map<string, string>();
  const first = whatChanged(announced, [unread("a", "2026-11-04T10:00:00Z")]);
  assert.deepEqual(
    first.announce.map((item) => item.id),
    ["a"],
  );

  announced.set("a", "2026-11-04T10:00:00Z");
  // Same message still unread: nothing new to announce.
  assert.deepEqual(
    whatChanged(announced, [unread("a", "2026-11-04T10:00:00Z")]).announce,
    [],
  );
  // A newer message in the same conversation is announced again.
  assert.deepEqual(
    whatChanged(announced, [
      unread("a", "2026-11-04T10:05:00Z", 2),
    ]).announce.map((item) => item.id),
    ["a"],
  );
});

test("closes the pop-up of a conversation that was read", () => {
  const announced = new Map([
    ["a", "2026-11-04T10:00:00Z"],
    ["b", "2026-11-04T10:01:00Z"],
  ]);
  const result = whatChanged(announced, [unread("b", "2026-11-04T10:01:00Z")]);
  assert.deepEqual(result.close, ["a"]);
  assert.deepEqual(result.announce, []);
});

test("never announces a conversation with no message time", () => {
  assert.deepEqual(whatChanged(new Map(), [unread("a", null)]).announce, []);
});

const summary = (
  overrides: Partial<TeamConversationSummary>,
): TeamConversationSummary => ({
  id: "c1",
  kind: "group",
  teamKey: null,
  title: "Ops huddle",
  personId: null,
  memberCount: 3,
  lastMessage: {
    body: "Container   is\nat the port",
    authorName: "Ama Mensah",
    mine: false,
    createdAt: "2026-11-04T10:00:00Z",
  },
  unread: 1,
  ...overrides,
});

test("a group pop-up names the sender; a direct one does not repeat the title", () => {
  assert.deepEqual(popupText(summary({}), 1), {
    title: "Ops huddle",
    body: "Ama Mensah: Container is at the port",
  });
  assert.deepEqual(
    popupText(summary({ kind: "direct", title: "Ama Mensah" }), 3),
    {
      title: "Ama Mensah (3 new)",
      body: "Container is at the port",
    },
  );
});

test("a long message is cut to a short preview", () => {
  const long = summary({
    lastMessage: {
      body: "x".repeat(400),
      authorName: null,
      mine: false,
      createdAt: "2026-11-04T10:00:00Z",
    },
  });
  const { body } = popupText(long, 1);
  assert.equal(body.length, 140);
  assert.ok(body.endsWith("…"));
});

test("the pop-up link opens that conversation", () => {
  assert.equal(conversationPath("abc-123"), "/team-chat?c=abc-123");
});
