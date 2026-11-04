import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

const source = readFileSync(
  new URL("../../public/sw.js", import.meta.url),
  "utf8",
);

type Shown = {
  title: string;
  options: {
    body: string;
    tag?: string;
    renotify: boolean;
    requireInteraction: boolean;
    data: { url: string; count: number };
  };
};
type FakeWindow = {
  url: string;
  focused: boolean;
  visibilityState: string;
  focus: () => Promise<void>;
  navigate: (url: string) => Promise<void>;
};

/** Runs the real sw.js against a fake browser. */
function worker(windows: Partial<FakeWindow>[] = []) {
  const listeners: Record<string, (event: unknown) => void> = {};
  const shown: Shown[] = [];
  const opened: string[] = [];
  const navigated: string[] = [];
  let current: Array<{ tag?: string; data: Shown["options"]["data"] }> = [];
  const clients = windows.map((item) => ({
    url: "https://app.test/",
    focused: false,
    visibilityState: "hidden",
    focus: async () => undefined,
    navigate: async (url: string) => {
      navigated.push(url);
    },
    ...item,
  }));
  const fake = {
    location: { origin: "https://app.test" },
    addEventListener: (type: string, listener: (event: unknown) => void) => {
      listeners[type] = listener;
    },
    skipWaiting: () => undefined,
    clients: {
      claim: async () => undefined,
      matchAll: async () => clients,
      openWindow: async (url: string) => {
        opened.push(url);
      },
    },
    registration: {
      getNotifications: async ({ tag }: { tag: string }) =>
        current.filter((item) => item.tag === tag),
      showNotification: async (title: string, options: Shown["options"]) => {
        shown.push({ title, options });
        current = current
          .filter((item) => item.tag !== options.tag)
          .concat([{ tag: options.tag, data: options.data }]);
      },
    },
  };
  runInNewContext(source, { self: fake, URL });

  const run = async (event: Record<string, unknown>, type: string) => {
    const waiting: Promise<unknown>[] = [];
    listeners[type]({
      ...event,
      waitUntil: (p: Promise<unknown>) => waiting.push(p),
    });
    await Promise.all(waiting);
  };
  return {
    shown,
    opened,
    navigated,
    push: (message: unknown) =>
      run(
        {
          data: {
            json: () => {
              if (message === "broken") throw new SyntaxError("bad json");
              return message;
            },
          },
        },
        "push",
      ),
    pushNothing: () => run({ data: null }, "push"),
    click: (url: unknown) => {
      const closed: boolean[] = [];
      return run(
        {
          notification: { close: () => closed.push(true), data: { url } },
        },
        "notificationclick",
      ).then(() => closed.length);
    },
  };
}

test("shows the message and keeps it until it is clicked", async () => {
  const sw = worker();
  await sw.push({
    title: "Ops huddle",
    body: "Ama: Container is at the port",
    url: "/team-chat?c=abc",
    tag: "team-chat:abc",
  });
  assert.equal(sw.shown.length, 1);
  const [{ title, options }] = sw.shown;
  assert.equal(title, "Ops huddle");
  assert.equal(options.body, "Ama: Container is at the port");
  assert.equal(options.requireInteraction, true);
  assert.equal(options.tag, "team-chat:abc");
  assert.equal(options.data.url, "/team-chat?c=abc");
});

test("messages with the same tag are one notification that counts them", async () => {
  const sw = worker();
  const message = (body: string) => ({
    title: "Ops huddle",
    body,
    url: "/team-chat?c=abc",
    tag: "team-chat:abc",
  });
  await sw.push(message("one"));
  await sw.push(message("two"));
  await sw.push(message("three"));
  assert.deepEqual(
    sw.shown.map((item) => item.title),
    ["Ops huddle", "Ops huddle (2 new)", "Ops huddle (3 new)"],
  );
  // The newest text is shown, and each one alerts again.
  assert.equal(sw.shown[2].options.body, "three");
  assert.ok(sw.shown.every((item) => item.options.renotify));

  // Another conversation counts for itself.
  await sw.push({ ...message("hello"), tag: "team-chat:other" });
  assert.equal(sw.shown[3].title, "Ops huddle");
});

test("a push with nothing readable still shows something, as the browser requires", async () => {
  for (const send of [
    (sw: ReturnType<typeof worker>) => sw.push("broken"),
    (sw: ReturnType<typeof worker>) => sw.pushNothing(),
    (sw: ReturnType<typeof worker>) => sw.push({ body: "no title" }),
  ]) {
    const sw = worker();
    await send(sw);
    assert.equal(sw.shown.length, 1);
    assert.equal(sw.shown[0].title, "BJH Logistics");
  }
});

test("stays quiet only when that very page is open, visible and focused", async () => {
  const message = { title: "New inquiry", body: "From Ama", url: "/inquiries" };
  const here = {
    url: "https://app.test/inquiries",
    focused: true,
    visibilityState: "visible",
  };

  const watching = worker([here]);
  await watching.push(message);
  assert.equal(watching.shown.length, 0);

  for (const other of [
    { ...here, url: "https://app.test/jobs" },
    { ...here, focused: false },
    { ...here, visibilityState: "hidden" },
  ]) {
    const sw = worker([other]);
    await sw.push(message);
    assert.equal(sw.shown.length, 1, JSON.stringify(other));
  }
});

test("a notification can only lead into this site", async () => {
  const sw = worker();
  await sw.push({ title: "Hi", body: "", url: "https://evil.example/phish" });
  assert.equal(sw.shown[0].options.data.url, "/");

  const clicked = worker();
  assert.equal(await clicked.click("https://evil.example/phish"), 1);
  assert.deepEqual(clicked.opened, []);
  assert.deepEqual(clicked.navigated, []);
});

test("a click closes the notification and takes the person to the page", async () => {
  // No BJH window open: one is opened.
  const closed = worker();
  assert.equal(await closed.click("/team-chat?c=abc"), 1);
  assert.deepEqual(closed.opened, ["https://app.test/team-chat?c=abc"]);

  // A BJH window is open: it is used, not a second one.
  const reuse = worker([{ url: "https://app.test/jobs" }]);
  await reuse.click("/quotations");
  assert.deepEqual(reuse.navigated, ["https://app.test/quotations"]);
  assert.deepEqual(reuse.opened, []);
});
