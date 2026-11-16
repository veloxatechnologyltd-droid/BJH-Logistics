/** Eight characters from an alphabet without look-alikes (no 0/O, 1/I/L). */
const code = /^[2-9A-HJKMNP-Z]{8}$/;

/**
 * Turns what a visitor typed ("bjh k3q7 9xmd", "K3Q79XMD", a pasted link's
 * last part) into the stored form BJH-XXXX-XXXX, or null when it cannot be a
 * tracking number. The result is only ever used as a database parameter.
 */
export function normalizeTrackingNumber(input: unknown): string | null {
  if (typeof input !== "string" || input.length > 40) return null;
  const compact = input.toUpperCase().replace(/[\s-]/g, "");
  const body =
    compact.length === 11 && compact.startsWith("BJH")
      ? compact.slice(3)
      : compact;
  if (!code.test(body)) return null;
  return `BJH-${body.slice(0, 4)}-${body.slice(4)}`;
}

/** Where the customer follows the shipment: the public site, not the platform. */
export function publicTrackingUrl(
  trackingNumber: string,
  environment: NodeJS.ProcessEnv = process.env,
): string {
  // A production API that has no PUBLIC_SITE_URL must still send a working
  // link, never a localhost one.
  const fallback =
    environment.NODE_ENV === "production"
      ? "https://www.bjhlogistics.com"
      : "http://127.0.0.1:3003";
  const base = (environment.PUBLIC_SITE_URL?.trim() || fallback).replace(
    /\/$/,
    "",
  );
  return `${base}/track/${trackingNumber}`;
}
