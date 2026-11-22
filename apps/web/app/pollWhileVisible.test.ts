import assert from "node:assert/strict";
import { test } from "node:test";
import { pollWhileVisible } from "./pollWhileVisible.ts";

function fakePage(state: "visible" | "hidden") {
  const listeners = new Set<() => void>();
  return {
    visibilityState: state as DocumentVisibilityState,
    addEventListener: (_: string, listener: () => void) =>
      listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) =>
      listeners.delete(listener),
    show() {
      this.visibilityState = "visible";
      listeners.forEach((listener) => listener());
    },
    hide() {
      this.visibilityState = "hidden";
      listeners.forEach((listener) => listener());
    },
    listeners,
  };
}

test("polls while visible, not while hidden, and catches up once shown", (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const page = fakePage("visible");
  let loads = 0;
  const stop = pollWhileVisible(() => (loads += 1), 1000, page as never);

  t.mock.timers.tick(2000);
  assert.equal(loads, 2);

  page.hide();
  t.mock.timers.tick(5000);
  assert.equal(loads, 2, "a hidden tab makes no requests");

  page.show();
  assert.equal(loads, 3, "one catch-up load when shown again");
  page.hide();
  page.show();
  assert.equal(loads, 3, "no extra load when nothing was missed");

  stop();
  t.mock.timers.tick(5000);
  assert.equal(loads, 3);
  assert.equal(page.listeners.size, 0);
});
