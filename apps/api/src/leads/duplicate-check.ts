import {
  normalizeBusinessName,
  normalizeDomain,
  normalizeEmailDomain,
  normalizePhoneKey,
} from "./business-normalize";
import type { FoundBusiness } from "./business-search";

/**
 * Duplicate check for found businesses (plan item 1.3): against the campaign's own
 * prospects, BJH's customers (company, trading name, website, contacts) and leads.
 *
 * Nothing is dropped on a guess. Only the provider's own place id in the same
 * campaign is certain, and that one is not stored again (the database refuses it
 * anyway). Every other match, however strong, is stored with a flag that names the
 * record and the reason, for staff to decide.
 */

export type DuplicateKind = "prospect" | "customer" | "lead";

/** A record BJH already holds, as the database returns it (not yet normalised). */
export interface KnownBusinessRow {
  kind: DuplicateKind;
  id: string;
  /** What staff see in the flag: "Acme Ltd". */
  label: string;
  names: string[];
  websites: string[];
  emails: string[];
  phones: string[];
  /** Prospects only: the provider and its id for the place. */
  source: string | null;
  sourceId: string | null;
}

interface KnownBusiness {
  kind: DuplicateKind;
  id: string;
  label: string;
  names: Set<string>;
  domains: Set<string>;
  phones: Set<string>;
  placeKey: string | null;
}

export type DuplicateVerdict =
  | { outcome: "unique" }
  /** The same place of this campaign is already stored: do not store it again. */
  | { outcome: "already_found"; ref: string }
  | {
      outcome: "flagged";
      kind: DuplicateKind;
      ref: string;
      /** `app.prospect.duplicate_reason`. */
      reason: string;
      strength: "strong" | "name";
    };

const KIND_RANK: Record<DuplicateKind, number> = {
  customer: 0,
  lead: 1,
  prospect: 2,
};

const KIND_WORD: Record<DuplicateKind, string> = {
  customer: "customer",
  lead: "lead",
  prospect: "prospect in this campaign",
};

function compact<T>(values: Array<T | null>): Set<T> {
  return new Set(values.filter((value): value is T => value !== null));
}

function prepare(row: KnownBusinessRow): KnownBusiness {
  return {
    kind: row.kind,
    id: row.id,
    label: row.label,
    names: compact(row.names.map((name) => normalizeBusinessName(name))),
    domains: compact([
      ...row.websites.map((site) => normalizeDomain(site)),
      ...row.emails.map((email) => normalizeEmailDomain(email)),
    ]),
    phones: compact(row.phones.map((phone) => normalizePhoneKey(phone))),
    placeKey:
      row.source && row.sourceId ? `${row.source}:${row.sourceId}` : null,
  };
}

function rowFor(id: string, business: FoundBusiness): KnownBusinessRow {
  return {
    kind: "prospect",
    id,
    label: business.businessName,
    names: [business.businessName],
    websites: business.website ? [business.website] : [],
    emails: business.emails,
    phones: business.phones,
    source: business.source,
    sourceId: business.sourceId,
  };
}

/** What a known record shares with the business, strongest first. */
function strongestMatch(
  known: KnownBusiness,
  business: KnownBusiness,
): { strength: "strong" | "name"; because: string } | null {
  for (const domain of business.domains) {
    if (known.domains.has(domain)) {
      return { strength: "strong", because: `website (${domain})` };
    }
  }
  for (const phone of business.phones) {
    if (known.phones.has(phone)) {
      return { strength: "strong", because: "phone number" };
    }
  }
  for (const name of business.names) {
    if (known.names.has(name)) {
      return { strength: "name", because: "business name" };
    }
  }
  return null;
}

/**
 * Checks each business in order against the records BJH holds and against the
 * businesses before it in the same batch (which is why each one brings the id its
 * prospect row will have: a later duplicate points at the earlier one).
 */
export function checkDuplicates(
  batch: Array<{ id: string; business: FoundBusiness }>,
  rows: KnownBusinessRow[],
): Map<string, DuplicateVerdict> {
  const known = rows.map(prepare);
  const places = new Map<string, string>();
  for (const record of known) {
    if (record.placeKey) places.set(record.placeKey, record.id);
  }
  const verdicts = new Map<string, DuplicateVerdict>();

  for (const { id, business } of batch) {
    const row = rowFor(id, business);
    const placeKey = `${business.source}:${business.sourceId}`;
    const samePlace = business.sourceId ? places.get(placeKey) : undefined;
    if (samePlace) {
      verdicts.set(id, { outcome: "already_found", ref: samePlace });
      continue;
    }

    const prepared = prepare(row);
    let best: Extract<DuplicateVerdict, { outcome: "flagged" }> | null = null;
    for (const record of known) {
      const match = strongestMatch(record, prepared);
      if (!match) continue;
      const better =
        !best ||
        (match.strength === "strong" && best.strength === "name") ||
        (match.strength === best.strength &&
          KIND_RANK[record.kind] < KIND_RANK[best.kind]);
      if (better) {
        best = {
          outcome: "flagged",
          kind: record.kind,
          ref: record.id,
          strength: match.strength,
          reason:
            `Same ${match.because} as ${KIND_WORD[record.kind]} ${record.label}`.slice(
              0,
              300,
            ),
        };
      }
    }
    verdicts.set(id, best ?? { outcome: "unique" });

    // Later businesses in this batch are compared with this one too.
    known.push(prepared);
    if (prepared.placeKey) places.set(prepared.placeKey, id);
  }
  return verdicts;
}
