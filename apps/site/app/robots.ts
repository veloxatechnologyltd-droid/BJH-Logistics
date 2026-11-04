import type { MetadataRoute } from "next";
import { SITE_URL } from "./content.ts";

// Search and AI assistant crawlers named explicitly, so BJH's policy is
// visible in one place: the public pages may be crawled, quoted and cited.
// A named group replaces the "*" group for that bot, so the /api/ rule is
// repeated. To keep a bot out, move it to its own group with `disallow: "/"`.
const aiCrawlers = [
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "ClaudeBot",
  "Claude-SearchBot",
  "Claude-User",
  "PerplexityBot",
  "Perplexity-User",
  "Google-Extended",
  "Applebot-Extended",
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: "*", allow: "/", disallow: "/api/" },
      { userAgent: aiCrawlers, allow: "/", disallow: "/api/" },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
