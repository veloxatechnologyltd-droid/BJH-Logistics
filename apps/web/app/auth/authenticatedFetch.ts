import { getSupabaseBrowserClient } from "./supabaseBrowserClient";

export async function authenticatedFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) {
    throw new Error("Sign-in is not configured for this site");
  }

  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) {
    // A link from an email or SMS lands here: sign in, then come back to it.
    if (
      typeof window !== "undefined" &&
      !window.location.pathname.startsWith("/sign-in")
    ) {
      const back = `${window.location.pathname}${window.location.search}`;
      window.location.assign(`/sign-in?next=${encodeURIComponent(back)}`);
    }
    throw new Error("Sign in to continue");
  }

  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${data.session.access_token}`);
  return fetch(input, { ...init, headers });
}
