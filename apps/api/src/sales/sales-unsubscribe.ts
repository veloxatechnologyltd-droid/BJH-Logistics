import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export function salesUnsubscribeSetup(environment: NodeJS.ProcessEnv) {
  const keyText = environment.OUTREACH_UNSUBSCRIBE_KEY?.trim();
  const baseUrl = environment.PUBLIC_API_URL?.trim().replace(/\/$/, "");
  if (!keyText || !/^[a-f0-9]{64}$/i.test(keyText) || !baseUrl) return null;
  try {
    const url = new URL(baseUrl);
    if (
      !url.pathname.endsWith("/api") ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      return null;
    if (
      url.protocol !== "https:" &&
      !(
        environment.NODE_ENV !== "production" &&
        url.protocol === "http:" &&
        ["localhost", "127.0.0.1"].includes(url.hostname)
      )
    )
      return null;
    return { key: Buffer.from(keyText, "hex"), baseUrl };
  } catch {
    return null;
  }
}

export function salesUnsubscribeToken(email: string, key: Buffer) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const encrypted = Buffer.concat([
    cipher.update(email.toLowerCase(), "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([nonce, cipher.getAuthTag(), encrypted]).toString(
    "base64url",
  );
}

export function salesUnsubscribeEmail(
  token: string,
  key: Buffer,
): string | null {
  if (!/^[A-Za-z0-9_-]{38,700}$/.test(token)) return null;
  try {
    const raw = Buffer.from(token, "base64url");
    const decipher = createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    const email = Buffer.concat([
      decipher.update(raw.subarray(28)),
      decipher.final(),
    ]).toString("utf8");
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
  } catch {
    return null;
  }
}
