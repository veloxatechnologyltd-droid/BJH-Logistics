import type { ReferenceKind } from "@bjh/contracts";

/** A shipment reference read from a document's text; only ever a proposal. */
export interface ExtractedField {
  /** Same as the shipment reference kind it would become. */
  key: ReferenceKind;
  label: string;
  value: string;
  sealNumber: string | null;
  /** The words in the document the value came from, so a person can check it. */
  evidence: string;
}

const labels: Record<ReferenceKind, string> = {
  master_bl: "Master B/L or booking number",
  house_bl: "House B/L number",
  master_awb: "Master air waybill (MAWB)",
  house_awb: "House air waybill (HAWB)",
  booking: "Booking number",
  container: "Container",
};

/** ISO 6346 letter values: 11 and its multiples are skipped. */
const letterValues: Record<string, number> = {};
{
  let value = 10;
  for (const letter of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") {
    if (value % 11 === 0) value += 1;
    letterValues[letter] = value;
    value += 1;
  }
}

/** True for a container number whose check digit (ISO 6346) is right. */
export function isValidContainerNumber(code: string): boolean {
  if (!/^[A-Z]{3}[UJZ]\d{7}$/.test(code)) return false;
  let sum = 0;
  for (let index = 0; index < 10; index += 1) {
    const character = code[index];
    const value = index < 4 ? letterValues[character] : Number(character);
    sum += value * 2 ** index;
  }
  return (sum % 11) % 10 === Number(code[10]);
}

const REFERENCE = "([A-Z0-9][A-Z0-9-]{4,24})";
const GAP = "\\s*[.:]*\\s*";

const patterns: Array<{
  key: ReferenceKind;
  pattern: RegExp;
  value: (match: RegExpExecArray) => string;
}> = [
  {
    key: "master_awb",
    pattern: new RegExp(
      `\\bMAWB\\s*(?:NUMBER|NO)?${GAP}(\\d{3})[-\\s]?(\\d{8})\\b`,
      "g",
    ),
    value: (match) => `${match[1]}-${match[2]}`,
  },
  {
    key: "house_awb",
    pattern: new RegExp(
      `\\bHAWB\\s*(?:NUMBER|NO)?${GAP}([A-Z0-9][A-Z0-9-]{3,24})\\b`,
      "g",
    ),
    value: (match) => match[1],
  },
  {
    key: "master_bl",
    pattern: new RegExp(
      `\\bMBL\\b(?:\\s*BK)?\\s*(?:NO|NUMBER)?${GAP}${REFERENCE}\\b`,
      "g",
    ),
    value: (match) => match[1],
  },
  {
    // Carrier B/Ls print "B/L No." or "Bill of Lading No."; the number word is
    // required so a heading such as "BILL OF LADING ORIGINAL" is not read.
    key: "master_bl",
    pattern: new RegExp(
      `(?<!HOUSE\\s)\\b(?:B/L|BILL OF LADING)\\s*(?:NO\\b|NUMBER\\b|#)${GAP}${REFERENCE}\\b`,
      "g",
    ),
    value: (match) => match[1],
  },
  {
    key: "house_bl",
    pattern: new RegExp(
      `\\bHBL\\b\\s*(?:NO|NUMBER)?${GAP}${REFERENCE}\\b`,
      "g",
    ),
    value: (match) => match[1],
  },
  {
    key: "booking",
    pattern: new RegExp(
      `\\bBOOKING\\s*(?:NO|NUMBER|REF(?:ERENCE)?)${GAP}${REFERENCE}\\b`,
      "g",
    ),
    value: (match) => match[1],
  },
];

/**
 * Proposes shipment references from the text of a bill of lading or air
 * waybill: master/house B/L and AWB numbers, booking numbers, and containers
 * (only those with a valid ISO 6346 check digit) with the seal written near
 * them. Reading text is imprecise, so these are drafts for a person to check.
 */
export function extractFields(text: string): ExtractedField[] {
  const source = text.replace(/\s+/g, " ").toUpperCase();
  const found = new Map<string, ExtractedField>();
  const add = (field: ExtractedField) => {
    const id = `${field.key}:${field.value}`;
    if (!found.has(id)) found.set(id, field);
  };

  for (const { key, pattern, value } of patterns) {
    for (const match of source.matchAll(pattern)) {
      add({
        key,
        label: labels[key],
        value: value(match as RegExpExecArray),
        sealNumber: null,
        evidence: match[0].slice(0, 120),
      });
    }
  }

  for (const match of source.matchAll(
    /\b([A-Z]{3}[UJZ])\s?(\d{6})\s?(\d)\b/g,
  )) {
    const code = `${match[1]}${match[2]}${match[3]}`;
    if (!isValidContainerNumber(code)) continue;
    const after = source.slice(
      (match.index ?? 0) + match[0].length,
      (match.index ?? 0) + match[0].length + 80,
    );
    const seal = /SEAL\s*(?:NO|NUMBER)?\s*[.:]*\s*([A-Z0-9-]{3,20})/.exec(
      after,
    );
    add({
      key: "container",
      label: labels.container,
      value: code,
      sealNumber: seal?.[1] ?? null,
      evidence: `${match[0]}${seal ? ` ${seal[0]}` : ""}`.slice(0, 120),
    });
  }
  return [...found.values()];
}

/** The text layer of a PDF. Empty for a scanned PDF (which would need OCR). */
export async function readPdfText(bytes: Buffer): Promise<string> {
  // A real dynamic import: this project compiles to CommonJS, which cannot require the ESM-only reader.
  const load = new Function("specifier", "return import(specifier)") as (
    specifier: string,
  ) => Promise<{
    getDocument: (options: Record<string, unknown>) => {
      promise: Promise<{
        numPages: number;
        getPage: (n: number) => Promise<{
          getTextContent: () => Promise<{ items: Array<{ str?: string }> }>;
        }>;
      }>;
    };
  }>;
  const pdfjs = await load("pdfjs-dist/legacy/build/pdf.mjs");
  const pdf = await pdfjs.getDocument({
    data: new Uint8Array(bytes),
    isEvalSupported: false,
    verbosity: 0,
  }).promise;
  const parts: string[] = [];
  for (let number = 1; number <= Math.min(pdf.numPages, 30); number += 1) {
    const page = await pdf.getPage(number);
    const content = await page.getTextContent();
    parts.push(content.items.map((item) => item.str ?? "").join(" "));
  }
  return parts.join("\n");
}
