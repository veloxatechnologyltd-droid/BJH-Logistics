// The browser asks the platform API directly (not a route on this site), so
// the API's per-address limit counts each visitor, not this server.
// A production build without the variable still points at the live API, never
// at localhost.
const apiBase = (
  process.env.NEXT_PUBLIC_TRACKING_API_URL ??
  (process.env.NODE_ENV === "production"
    ? "https://bjh-logistics-api.onrender.com/api"
    : "http://127.0.0.1:3001/api")
).replace(/\/$/, "");

export function trackingEndpoint(typed: string): string {
  return `${apiBase}/v1/track/${encodeURIComponent(typed.trim())}`;
}

/** What the API returns for a tracking number; nothing else is ever sent. */
export interface PublicTracking {
  trackingNumber: string;
  service: string;
  status: string;
  openedAt: string;
  etaAt: string | null;
  steps: Array<{ text: string; done: boolean; occurredAt: string | null }>;
}

/** Ghana is on GMT all year, so the time shown is unambiguous. */
export function formatGhanaTime(iso: string): string {
  return `${new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Africa/Accra",
  }).format(new Date(iso))} (Ghana time)`;
}
