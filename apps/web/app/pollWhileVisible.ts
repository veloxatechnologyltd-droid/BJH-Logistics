/**
 * Runs `load` every `everyMs` while the page is on screen. A tab in the
 * background makes no requests, and catches up as soon as it is shown again.
 * Polls from forgotten tabs used up the hosted database's transfer allowance
 * (2026-11-22). Returns the function that stops it.
 */
export function pollWhileVisible(
  load: () => unknown,
  everyMs: number,
  page: Pick<
    Document,
    "visibilityState" | "addEventListener" | "removeEventListener"
  > = document,
): () => void {
  let missed = false;
  const visible = () => page.visibilityState === "visible";
  const timer = setInterval(() => {
    if (visible()) void load();
    else missed = true;
  }, everyMs);
  const shown = () => {
    if (!visible() || !missed) return;
    missed = false;
    void load();
  };
  page.addEventListener("visibilitychange", shown);
  return () => {
    clearInterval(timer);
    page.removeEventListener("visibilitychange", shown);
  };
}
