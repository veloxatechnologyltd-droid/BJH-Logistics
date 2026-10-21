import type {
  QuoteVersionInput,
  RequestDetails,
  ServiceLine,
} from "@bjh/contracts";
import type {
  QuoteSummaryRecord,
  QuoteVersionRecord,
} from "../database/database.port";

/** A past quote with its newest issued version and the details of the request it answered, if any. */
export interface PastQuote {
  quote: QuoteSummaryRecord;
  version: QuoteVersionRecord;
  requestDetails: RequestDetails | null;
}

export type SuggestionMatch =
  "same route" | "same destination" | "same service";

/** The default wording from Business settings, used when there is no past quote to copy. */
export type QuoteWording = Pick<
  QuoteVersionInput,
  | "intro"
  | "atCostNote"
  | "procedureSteps"
  | "requiredDocuments"
  | "documentsNote"
  | "timeline"
  | "terms"
>;

export interface QuoteSuggestion {
  serviceLine: ServiceLine;
  /** The past quote whose charges, prices and wording were copied; null when there is none. */
  basedOn: {
    quoteId: string;
    quoteNumber: string | null;
    versionNumber: number;
    customerCompanyName: string;
    match: SuggestionMatch;
  } | null;
  version: QuoteVersionInput;
}

const serviceTitles: Record<ServiceLine, string> = {
  sea_import: "Sea import quotation",
  sea_export: "Sea export quotation",
  air_import: "Air import quotation",
  air_export: "Air export quotation",
  warehousing: "Warehousing quotation",
  road_transport: "Road transport quotation",
};

/** Letters and digits only, lower case: "Tema, Ghana" and "TEMA" compare as places. */
const place = (value: string | null) =>
  (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

function samePlace(a: string | null, b: string | null): boolean {
  const left = place(a);
  const right = place(b);
  if (!left || !right) return false;
  return left === right || left.includes(right) || right.includes(left);
}

/** How a past quote compares with the request: same route beats same destination beats same service. */
function matchOf(details: RequestDetails, past: PastQuote): SuggestionMatch {
  const other = past.requestDetails;
  if (other && samePlace(details.destination, other.destination)) {
    return samePlace(details.origin, other.origin)
      ? "same route"
      : "same destination";
  }
  return "same service";
}

const rank: Record<SuggestionMatch, number> = {
  "same route": 0,
  "same destination": 1,
  "same service": 2,
};

/**
 * The past issued quote most like the request: same service, then the same
 * route or destination, newest first. Candidates are given newest first.
 */
export function mostSimilar(
  details: RequestDetails,
  service: ServiceLine,
  candidates: PastQuote[],
): { past: PastQuote; match: SuggestionMatch } | null {
  let best: { past: PastQuote; match: SuggestionMatch } | null = null;
  for (const past of candidates) {
    if (past.quote.serviceLine !== service) continue;
    const match = matchOf(details, past);
    if (!best || rank[match] < rank[best.match]) best = { past, match };
  }
  return best;
}

/** One line describing the shipment, from what the request says. */
export function scopeFromDetails(details: RequestDetails): string | null {
  const route =
    details.origin && details.destination
      ? `${details.origin} to ${details.destination}`
      : (details.origin ?? details.destination);
  const parts = [
    details.quantity,
    details.cargo,
    route,
    details.incoterm,
    details.weightVolume,
  ].filter((part): part is string => Boolean(part));
  return parts.length ? parts.join(" · ").slice(0, 500) : null;
}

/**
 * A draft for the request: its shipment described from the request, and the
 * charges, prices, size columns and wording of the most similar past issued
 * quote. Nothing is saved; staff check it in the quote editor.
 */
export function suggestQuote(
  details: RequestDetails,
  service: ServiceLine,
  candidates: PastQuote[],
  defaults: QuoteWording | null = null,
): QuoteSuggestion {
  const scope = scopeFromDetails(details);
  const found = mostSimilar(details, service, candidates);
  if (!found) {
    return {
      serviceLine: service,
      basedOn: null,
      version: {
        currency: "",
        title: serviceTitles[service],
        subtitle: null,
        shipmentScope: scope,
        intro: defaults?.intro ?? null,
        atCostNote: defaults?.atCostNote ?? null,
        procedureSteps: defaults?.procedureSteps ?? [],
        requiredDocuments: defaults?.requiredDocuments ?? [],
        documentsNote: defaults?.documentsNote ?? null,
        timeline: defaults?.timeline ?? null,
        terms: defaults?.terms ?? [],
        sizeLabels: [],
        lines: [],
      },
    };
  }
  const { quote, version } = found.past;
  return {
    serviceLine: service,
    basedOn: {
      quoteId: quote.id,
      quoteNumber: quote.quoteNumber,
      versionNumber: version.versionNumber,
      customerCompanyName: quote.customerCompanyName,
      match: found.match,
    },
    version: {
      currency: version.currency,
      title: version.title,
      // The subtitle usually describes that customer's shipment, so it is not copied.
      subtitle: null,
      shipmentScope: scope ?? version.shipmentScope,
      intro: version.intro,
      atCostNote: version.atCostNote,
      procedureSteps: version.procedureSteps,
      requiredDocuments: version.requiredDocuments,
      documentsNote: version.documentsNote,
      timeline: version.timeline,
      terms: version.terms,
      sizeLabels: version.sizeLabels,
      lines: version.lines.map((line) => ({
        section: line.section,
        description: line.description,
        details: line.details,
        basis: line.basis,
        basisNote: line.basisNote,
        amountMinor: line.amountMinor,
        sizeAmountsMinor: line.sizeAmountsMinor,
      })),
    },
  };
}
