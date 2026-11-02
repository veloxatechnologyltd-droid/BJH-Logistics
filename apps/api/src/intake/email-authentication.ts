/**
 * Whether the mail server that received an email vouches for its sender.
 * The server writes its checks (DKIM, SPF, DMARC) into an Authentication-Results
 * header; anyone can forge a `From:` line, so a reply that claims to be a
 * client's is only believed when those checks do not say otherwise.
 */
export type EmailAuthentication = "pass" | "fail" | "unknown";

/** `CHAT_EMAIL_AUTH`: what to do with a reply whose sender cannot be verified. */
export type EmailAuthenticationPolicy = "reject_failures" | "require" | "off";

export function emailAuthenticationPolicy(
  environment: NodeJS.ProcessEnv = process.env,
): EmailAuthenticationPolicy {
  const value = environment.CHAT_EMAIL_AUTH?.trim().toLowerCase();
  return value === "require" || value === "off" ? value : "reject_failures";
}

/**
 * Reads the topmost Authentication-Results header, the one the receiving server
 * added (older ones come from servers the email passed on the way and could be
 * forged by the sender). `pass` is a DMARC pass, or a DKIM pass signed by the
 * sender's own domain; `fail` is a failed DMARC, DKIM or SPF check with no such
 * pass; anything else, including no header at all, is `unknown`.
 */
export function emailAuthentication(
  results: string | string[] | undefined,
  fromAddress: string,
): EmailAuthentication {
  const header = Array.isArray(results) ? results[0] : results;
  if (!header) return "unknown";
  const senderDomain = fromAddress.split("@").pop()?.trim().toLowerCase() ?? "";

  let dmarc = "";
  let spf = "";
  let alignedDkimPass = false;
  let dkimFail = false;
  // The first part is the server's own name; the rest are `method=result props`.
  for (const part of header.split(";").slice(1)) {
    const method = /^\s*(dkim|spf|dmarc)\s*=\s*([a-z]+)/i.exec(part);
    if (!method) continue;
    const name = method[1].toLowerCase();
    const result = method[2].toLowerCase();
    if (name === "dmarc") dmarc = result;
    else if (name === "spf") spf = result;
    else if (result === "pass") {
      const signer = /header\.d\s*=\s*"?([^\s";]+)/i
        .exec(part)?.[1]
        ?.toLowerCase();
      if (
        signer &&
        senderDomain &&
        (senderDomain === signer || senderDomain.endsWith(`.${signer}`))
      ) {
        alignedDkimPass = true;
      }
    } else if (result === "fail") {
      dkimFail = true;
    }
  }

  if (dmarc === "pass" || alignedDkimPass) return "pass";
  if (dmarc === "fail" || spf === "fail" || dkimFail) return "fail";
  return "unknown";
}

/** Whether a reply with this verdict may join a client's conversation. */
export function mayJoinChat(
  verdict: EmailAuthentication,
  policy: EmailAuthenticationPolicy,
): boolean {
  if (policy === "off") return true;
  if (policy === "require") return verdict === "pass";
  return verdict !== "fail";
}
