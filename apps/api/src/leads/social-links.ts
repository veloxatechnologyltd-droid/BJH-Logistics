/**
 * Social media pages of a found business, as the search tool reports them (it reads
 * them from the business's website). Every link is checked before it is stored: it
 * must be a web address on the platform it is filed under, so a link that points
 * somewhere else is dropped rather than shown to staff as a Facebook page.
 */

export const SOCIAL_PLATFORMS = [
  "facebook",
  "instagram",
  "linkedin",
  "twitter",
  "youtube",
  "tiktok",
] as const;

export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

/** Platform -> page links, at most `MAX_PER_PLATFORM` each; a platform with none is absent. */
export type SocialLinks = Partial<Record<SocialPlatform, string[]>>;

const MAX_PER_PLATFORM = 3;
const MAX_LINK_CHARS = 300;

const HOSTS: Record<SocialPlatform, string[]> = {
  facebook: ["facebook.com", "fb.com", "fb.me"],
  instagram: ["instagram.com"],
  linkedin: ["linkedin.com"],
  twitter: ["twitter.com", "x.com"],
  youtube: ["youtube.com", "youtu.be"],
  tiktok: ["tiktok.com"],
};

/** The field of a Google Maps contact-details place that holds each platform's links. */
const PLACE_FIELDS: Record<SocialPlatform, string> = {
  facebook: "facebooks",
  instagram: "instagrams",
  linkedin: "linkedIns",
  twitter: "twitters",
  youtube: "youtubes",
  tiktok: "tiktoks",
};

/** One link on this platform as a clean https address, or null when it is not one. */
export function socialLink(
  platform: SocialPlatform,
  value: unknown,
): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_LINK_CHARS) return null;
  // The tool sometimes drops the scheme ("facebook.com/page").
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password) return null;
  const host = url.hostname.toLowerCase();
  const onPlatform = HOSTS[platform].some(
    (domain) => host === domain || host.endsWith(`.${domain}`),
  );
  if (!onPlatform) return null;
  url.protocol = "https:";
  url.hash = "";
  const clean = url.toString();
  return clean.length <= MAX_LINK_CHARS ? clean : null;
}

/** The valid social links of a place from the search tool; empty when it reported none. */
export function socialLinksOf(place: Record<string, unknown>): SocialLinks {
  const links: SocialLinks = {};
  for (const platform of SOCIAL_PLATFORMS) {
    const reported = place[PLACE_FIELDS[platform]];
    if (!Array.isArray(reported)) continue;
    const clean = [
      ...new Set(
        reported
          .map((value) => socialLink(platform, value))
          .filter((value): value is string => value !== null),
      ),
    ].slice(0, MAX_PER_PLATFORM);
    if (clean.length > 0) links[platform] = clean;
  }
  return links;
}

/** Read back from the database: anything that is not a valid link is ignored. */
export function socialLinksFromStored(stored: unknown): SocialLinks {
  if (typeof stored !== "object" || stored === null || Array.isArray(stored)) {
    return {};
  }
  const record = stored as Record<string, unknown>;
  const links: SocialLinks = {};
  for (const platform of SOCIAL_PLATFORMS) {
    const list = record[platform];
    if (!Array.isArray(list)) continue;
    const clean = list
      .map((value) => socialLink(platform, value))
      .filter((value): value is string => value !== null)
      .slice(0, MAX_PER_PLATFORM);
    if (clean.length > 0) links[platform] = clean;
  }
  return links;
}

const LABELS: Record<SocialPlatform, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  linkedin: "LinkedIn",
  twitter: "X",
  youtube: "YouTube",
  tiktok: "TikTok",
};

/** For a lead's notes: "Facebook: https://...; Instagram: https://...". Empty when none. */
export function socialLinksAsText(links: SocialLinks): string {
  return SOCIAL_PLATFORMS.filter((platform) => links[platform]?.length)
    .map((platform) => `${LABELS[platform]}: ${links[platform]!.join(", ")}`)
    .join("; ");
}
