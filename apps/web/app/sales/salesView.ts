import type { Draft, DraftSkipReason, PoolProspect } from "./salesApi.ts";

/** How a score reads: from the campaign's good-fit line up is good, within 15 below it is middling. */
export function scoreTone(
  score: number | null,
  threshold: number,
): "good" | "mid" | "low" | "none" {
  if (score === null) return "none";
  if (score >= threshold) return "good";
  if (score >= threshold - 15) return "mid";
  return "low";
}

/**
 * A spreadsheet cell as text. Quoted when needed, and a value that starts with =, +, -
 * or @ gets a leading apostrophe so a spreadsheet never runs it as a formula (a business
 * can put anything in its public name).
 */
export function csvCell(value: string | number | null | undefined): string {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const csvColumns = [
  "Business",
  "Category",
  "Address",
  "Website",
  "Emails",
  "Phones",
  "Social media",
  "Rating",
  "Fit score",
  "Why",
  "Campaign",
] as const;

/** The pool rows as CSV text (with the header row). */
export function poolToCsv(rows: PoolProspect[]): string {
  const lines = [csvColumns.join(",")];
  for (const row of rows) {
    lines.push(
      [
        row.businessName,
        row.category,
        row.address,
        row.website,
        row.emails.join("; "),
        row.phones.join("; "),
        Object.values(row.socialLinks).flat().join("; "),
        row.rating,
        row.score,
        row.scoreReason,
        row.campaignName,
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return `${lines.join("\r\n")}\r\n`;
}

export const draftStatusLabels = {
  pending: "Draft waiting",
  approved: "Approved",
  rejected: "Rejected",
} as const;

const skipReasons: Record<DraftSkipReason, string> = {
  not_found: "no longer exists",
  dismissed: "was set aside",
  no_email: "has no email address",
  already_drafted: "already has a draft",
};

/** One sentence for what drafting did, e.g. "Drafted 3 emails. Skipped 2: Acme has no email address." */
export function draftOutcome(
  created: number,
  skipped: Array<{ businessName: string | null; reason: DraftSkipReason }>,
): string {
  const made = `Drafted ${created} ${created === 1 ? "email" : "emails"}.`;
  if (skipped.length === 0) return made;
  const shown = skipped
    .slice(0, 3)
    .map(
      (skip) =>
        `${skip.businessName ?? "A business"} ${skipReasons[skip.reason]}`,
    )
    .join("; ");
  const more = skipped.length > 3 ? ` and ${skipped.length - 3} more` : "";
  return `${made} Skipped ${skipped.length}: ${shown}${more}.`;
}

/** Splits a list into groups of at most `size`. */
export function inGroups<T>(items: T[], size: number): T[][] {
  const groups: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    groups.push(items.slice(index, index + size));
  }
  return groups;
}

/** Whether a draft's text differs from what the form started with (to enable Save). */
export function draftChanged(
  draft: Pick<Draft, "recipientEmail" | "subject" | "body">,
  form: { recipientEmail: string; subject: string; body: string },
): boolean {
  return (
    draft.recipientEmail !== form.recipientEmail.trim() ||
    draft.subject !== form.subject.trim() ||
    draft.body !== form.body.trim()
  );
}
