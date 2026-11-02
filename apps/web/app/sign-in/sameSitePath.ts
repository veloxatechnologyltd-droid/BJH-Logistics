/**
 * Whether `value` (from the `next` query parameter) is a path of this site and
 * nothing else. Browsers read `\` as `/`, so `/\evil.example` would otherwise
 * leave the site.
 */
export function isSameSitePath(value: string): boolean {
  if (!value.startsWith("/") || value.startsWith("//")) return false;
  if (value.includes("\\")) return false;
  for (const character of value) {
    if (character.charCodeAt(0) < 32) return false;
  }
  try {
    return (
      new URL(value, "https://site.invalid").origin === "https://site.invalid"
    );
  } catch {
    return false;
  }
}
