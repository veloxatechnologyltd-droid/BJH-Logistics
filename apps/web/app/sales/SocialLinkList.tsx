import { safeWebUrl } from "../campaigns/campaignView";
import type { SocialLinks } from "../campaigns/campaignApi";
import styles from "./sales.module.css";

const platforms: Array<[keyof SocialLinks, string]> = [
  ["facebook", "Facebook"],
  ["instagram", "Instagram"],
  ["linkedin", "LinkedIn"],
  ["twitter", "X"],
  ["youtube", "YouTube"],
  ["tiktok", "TikTok"],
];

/** A business's social media pages as small links; nothing when it has none. */
export function SocialLinkList({ links }: { links: SocialLinks }) {
  const shown = platforms.flatMap(([key, label]) => {
    const url = safeWebUrl(links[key]?.[0] ?? null);
    return url ? [{ key, label, url }] : [];
  });
  if (shown.length === 0) return null;
  return (
    <span className={styles.socials}>
      {shown.map((item) => (
        <a
          aria-label={`${item.label} page`}
          href={item.url}
          key={item.key}
          rel="noreferrer noopener"
          target="_blank"
        >
          {item.label}
        </a>
      ))}
    </span>
  );
}
