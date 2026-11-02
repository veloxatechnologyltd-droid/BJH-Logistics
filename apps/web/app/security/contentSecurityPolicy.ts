/** The origin of a configured URL, or null when it is missing or not a URL. */
function originOf(value: string | undefined): string | null {
  try {
    return value?.trim() ? new URL(value.trim()).origin : null;
  } catch {
    return null;
  }
}

/**
 * The part of the page's Content Security Policy that changes on every request
 * or with where the app is hosted (audit S10); the rest is fixed in
 * `next.config.ts`.
 *
 * - `script-src`: a script runs only if it carries this request's one-time
 *   nonce, or was loaded by one that does (`strict-dynamic`). Markup an
 *   attacker injects into a page has no nonce, so it cannot run.
 * - `connect-src`: the page may open connections only to itself, the API and
 *   Supabase (sign-in), so injected code cannot send what it reads elsewhere.
 *
 * Frames, objects, images and styles are left unrestricted on purpose: staff
 * open PDFs in a new tab from a blob URL, which inherits this policy, and the
 * app styles elements inline.
 */
export function contentSecurityPolicy(
  nonce: string,
  environment: Record<string, string | undefined> = process.env,
): string {
  const connect = new Set(["'self'"]);
  for (const configured of [
    environment.NEXT_PUBLIC_API_BASE_URL,
    environment.NEXT_PUBLIC_SUPABASE_URL,
  ]) {
    const origin = originOf(configured);
    if (!origin) continue;
    connect.add(origin);
    // Supabase can also open a websocket to its own address.
    connect.add(origin.replace(/^http/, "ws"));
  }
  return [
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    `connect-src ${[...connect].join(" ")}`,
  ].join("; ");
}
