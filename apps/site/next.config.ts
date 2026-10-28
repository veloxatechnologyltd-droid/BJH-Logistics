import type { NextConfig } from "next";

// A hosted (Vercel) build must link "Log in" to the hosted platform, not to
// the local development address.
if (process.env.VERCEL) {
  const platform = process.env.NEXT_PUBLIC_PLATFORM_URL?.trim();
  if (!platform || /^https?:\/\/(localhost|127\.0\.0\.1)/.test(platform)) {
    throw new Error(
      "Set NEXT_PUBLIC_PLATFORM_URL to the hosted platform address in Vercel before building",
    );
  }
}

const nextConfig: NextConfig = {
  headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
