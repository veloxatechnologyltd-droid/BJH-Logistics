import type { NextConfig } from "next";

// A hosted (Vercel) build must point at the hosted API and Supabase project.
// Without these the pages fall back to the local development addresses and
// would call the visitor's own machine.
if (process.env.VERCEL) {
  const missing = [
    "NEXT_PUBLIC_API_BASE_URL",
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  ].filter((name) => {
    const value = process.env[name]?.trim();
    return !value || /^https?:\/\/(localhost|127\.0\.0\.1)/.test(value);
  });
  if (missing.length > 0) {
    throw new Error(
      `Set ${missing.join(", ")} to the hosted values in Vercel before building`,
    );
  }
}

const nextConfig: NextConfig = {};

export default nextConfig;
