/**
 * Reads the synthetic documents from make-demo-documents.ts with the PDF text
 * reader and, when ANTHROPIC_API_KEY is set, with Claude, and scores each
 * against expected.json. Only for synthetic documents: never point it at real
 * client files.
 *
 *   corepack pnpm --filter @bjh/api exec dotenv -e ../../.env -- tsx scripts/try-ai-reading.ts
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  extractFields,
  readPdfText,
} from "../src/documents/document-extraction";
import type { ExtractionFieldRecord } from "../src/database/database.port";
import {
  ClaudeDocumentReader,
  createDocumentReader,
} from "../src/documents/document-reader";

const DIR = resolve(process.cwd(), "../../.local/demo-documents");

const partyKeys = ["shipper", "consignee", "notify_party", "agent"];

type Expected = Record<
  string,
  Array<{ key: string; value: string; seal?: string }>
>;

function score(found: ExtractionFieldRecord[], expected: Expected[string]) {
  const same = (got: ExtractionFieldRecord, want: Expected[string][number]) =>
    got.key === want.key &&
    (partyKeys.includes(got.key)
      ? got.value.toLowerCase().includes(want.value.toLowerCase())
      : got.value === want.value);
  const match = (want: Expected[string][number]) =>
    found.find((got) => same(got, want));
  const missing = expected.filter((want) => !match(want));
  const wrongSeal = expected.filter(
    (want) => want.seal && match(want) && match(want)?.sealNumber !== want.seal,
  );
  const extra = found.filter(
    (got) => !expected.some((want) => same(got, want)),
  );
  return {
    right: expected.length - missing.length - wrongSeal.length,
    missing,
    wrongSeal,
    extra,
  };
}

function report(
  reader: string,
  found: ExtractionFieldRecord[] | Error,
  expected: Expected[string],
  seconds: number,
) {
  if (found instanceof Error) {
    console.log(`  ${reader.padEnd(18)} failed: ${found.message}`);
    return;
  }
  const { right, missing, wrongSeal, extra } = score(found, expected);
  console.log(
    `  ${reader.padEnd(18)} ${right}/${expected.length} right` +
      `, ${extra.length} extra, ${seconds.toFixed(1)} s`,
  );
  for (const item of missing) {
    console.log(
      `    missing ${item.key} ${item.value}${item.seal ? ` (seal ${item.seal})` : ""}`,
    );
  }
  for (const item of wrongSeal) {
    const got = found.find(
      (field) => field.key === item.key && field.value === item.value,
    );
    console.log(
      `    seal    ${item.value}: read ${got?.sealNumber ?? "none"}, expected ${item.seal}`,
    );
  }
  for (const item of extra) {
    console.log(`    extra   ${item.key} ${item.value}`);
  }
}

async function timed<T>(work: () => Promise<T>): Promise<[T | Error, number]> {
  const start = performance.now();
  try {
    return [await work(), (performance.now() - start) / 1000];
  } catch (error) {
    return [
      error instanceof Error ? error : new Error(String(error)),
      (performance.now() - start) / 1000,
    ];
  }
}

async function main() {
  const expected = JSON.parse(
    readFileSync(join(DIR, "expected.json"), "utf8"),
  ) as Expected;
  const reader = createDocumentReader();
  if (!(reader instanceof ClaudeDocumentReader)) {
    console.log(
      "ANTHROPIC_API_KEY is not set: only the PDF text reader runs.\n",
    );
  }
  for (const [file, want] of Object.entries(expected)) {
    const bytes = readFileSync(join(DIR, file));
    const contentType = file.endsWith(".pdf")
      ? "application/pdf"
      : "image/jpeg";
    console.log(file);
    if (contentType === "application/pdf") {
      const [found, seconds] = await timed(async () =>
        extractFields(await readPdfText(bytes)),
      );
      report("PDF text reader", found, want, seconds);
    } else {
      console.log("  PDF text reader    cannot read images");
    }
    if (reader instanceof ClaudeDocumentReader) {
      const [found, seconds] = await timed(() =>
        reader.read({ bytes, contentType }),
      );
      report(reader.model, found, want, seconds);
    }
  }
}

void main();
