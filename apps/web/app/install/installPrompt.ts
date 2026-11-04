/** How long "Not now" keeps the add-to-home-screen banner away. */
export const installHintSnoozeMs = 30 * 24 * 60 * 60 * 1000;

/**
 * iPhones and iPads, where Safari gives a page no install button to use, so
 * the banner explains the Share menu instead. An iPad can call itself a Mac.
 */
export function isAppleTouchDevice(
  userAgent: string,
  platform: string,
  maxTouchPoints: number,
): boolean {
  if (/iPhone|iPad|iPod/.test(userAgent)) return true;
  return platform === "MacIntel" && maxTouchPoints > 1;
}

/**
 * Whether a "Not now" saved earlier (milliseconds since 1970, as stored text)
 * still keeps the banner away. A missing, unreadable or future date does not.
 */
export function installHintSnoozed(saved: string | null, now: number): boolean {
  if (!saved) return false;
  const at = Number(saved);
  return Number.isFinite(at) && at <= now && now - at < installHintSnoozeMs;
}
