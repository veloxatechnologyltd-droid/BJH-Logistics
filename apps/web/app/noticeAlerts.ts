import type { StaffNotice } from "./quotations/quoteRequestApi.ts";

/** How often the alert sound repeats while an "ETA reached" notice is unchecked. */
export const ETA_SOUND_EVERY_MS = 20_000;

export const linkFor = (notice: StaffNotice) =>
  notice.kind === "vehicle_due"
    ? "/transport"
    : notice.kind === "eta_due" && notice.jobId
      ? `/jobs/${notice.jobId}`
      : notice.quoteRequestId
        ? `/quotations/requests/${notice.quoteRequestId}`
        : "/quotations";

/**
 * Which notice pops up next. An unchecked "ETA reached" notice always comes
 * first and keeps coming back until it is checked, put off or dismissed; a
 * reminder pops up once per visit.
 */
export function pickPopup(
  due: StaffNotice[],
  shownReminders: ReadonlySet<string>,
): StaffNotice | null {
  return (
    due.find((notice) => notice.kind === "eta_due") ??
    due.find(
      (notice) => notice.kind === "reminder" && !shownReminders.has(notice.id),
    ) ??
    null
  );
}

let context: AudioContext | undefined;

function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  context ??= new window.AudioContext();
  return context;
}

/**
 * Browsers only let a page make sound after the person has clicked or typed on
 * it, so the first such action wakes the audio up. Returns a clean-up function.
 */
export function unlockAlertSound(): () => void {
  const wake = () =>
    void audio()
      ?.resume()
      .catch(() => undefined);
  const events = ["pointerdown", "keydown"] as const;
  for (const name of events)
    window.addEventListener(name, wake, { once: true });
  return () => {
    for (const name of events) window.removeEventListener(name, wake);
  };
}

/** Two short tones. Silent, without an error, when the browser has not allowed sound yet. */
export function playAlertSound(): void {
  try {
    const ctx = audio();
    if (!ctx || ctx.state !== "running") return;
    [880, 660].forEach((frequency, index) => {
      const start = ctx.currentTime + index * 0.28;
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.3, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.24);
      oscillator.connect(gain).connect(ctx.destination);
      oscillator.start(start);
      oscillator.stop(start + 0.26);
    });
  } catch {
    // A missing sound must never break the page.
  }
}
