/**
 * A message Bra Evans drafted, waiting for Client chat to open. It is kept in
 * memory only, so it lasts for the in-app page change and is never stored on
 * the computer.
 */
let pending: { companyId: string; draft: string } | null = null;

export function handOffChatDraft(companyId: string, draft: string): void {
  pending = { companyId, draft };
}

/** The draft for this client, once; null when there is none. */
export function takeChatDraft(companyId: string): string | null {
  if (pending?.companyId !== companyId) return null;
  const { draft } = pending;
  pending = null;
  return draft;
}
