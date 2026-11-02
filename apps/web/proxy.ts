import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { contentSecurityPolicy } from "./app/security/contentSecurityPolicy";

/**
 * Gives every page request its own nonce and the Content Security Policy that
 * goes with it. Next reads the nonce from the policy and puts it on the scripts
 * it renders, which is why the pages render per request (see `app/layout.tsx`).
 * Development is left alone: it needs `eval` and a websocket for hot reload.
 */
export function proxy(request: NextRequest) {
  if (process.env.NODE_ENV === "development") return NextResponse.next();
  const nonce = btoa(crypto.randomUUID());
  // Named in full so Next puts the build-time values in (a lookup through a
  // variable would find nothing where the variables exist only at build).
  const policy = contentSecurityPolicy(nonce, {
    NEXT_PUBLIC_API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  });
  const headers = new Headers(request.headers);
  headers.set("content-security-policy", policy);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("content-security-policy", policy);
  return response;
}

export const config = {
  matcher: [
    {
      source: "/((?!api|_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
