# AI reading of job documents

On a job's Documents tab, **Details read from documents → Read details (draft)**
proposes shipment references from one document: master and house B/L, master and
house air waybill, booking number, and containers with their seals.

| Set up                     | What reads the document                                                                       | Files                       |
| -------------------------- | --------------------------------------------------------------------------------------------- | --------------------------- |
| `ANTHROPIC_API_KEY` is set | Claude (`claude-haiku-5-5`, or `CLAUDE_MODEL`) reads the whole file, so scans and photos work | PDF, PNG, JPEG, up to 20 MB |
| No key                     | The PDF's text layer is read inside the API (nothing leaves it); scans give an empty draft    | PDF with text only          |

Either way the result is a **draft**: nothing reaches the job until a person
checks each value against the document, corrects it if needed and applies the
ones they tick. The draft records which model read it (`readBy`; empty means the
text layer), and the screen says "Read by AI" on those drafts. Container numbers
must pass the ISO 6346 check digit (others are dropped), a master air waybill is
written `NNN-NNNNNNNN`, repeats are merged. If the AI fails (busy, key refused,
too slow) the API answers 503 with the reason and no draft is saved: try again
or add the references by hand.

## Privacy and cost

- The chosen file goes to Anthropic's API for that one reading. The document is
  treated as untrusted text, never as instructions, and the answer is forced
  into a fixed schema and cleaned before it is saved.
- **Only synthetic or demo documents** are to be read with Evans's test key until
  BJH agrees in writing (MEMORY.md, 2026-10-20). Setting the key on the hosted
  API sends whatever staff read there to Anthropic.
- A one-to-two-page bill of lading is a few thousand tokens: well under a US cent
  per reading at Haiku 5.5's list price (an estimate, not measured yet).

## Trying it with synthetic documents

```sh
# Fictional B/L, house B/L, house AWB, a scanned copy and a photo, plus expected.json
corepack pnpm --filter @bjh/api exec tsx scripts/make-demo-documents.ts
# Reads each with the PDF text reader and, if ANTHROPIC_API_KEY is in .env, with Claude
corepack pnpm --filter @bjh/api exec dotenv -e ../../.env -- tsx scripts/try-ai-reading.ts
```

Files land in `.local/demo-documents/` (gitignored); the scans need `pdftoppm`
(poppler-utils). They also serve as demo uploads. Without a key, the text reader
scores: carrier B/L 2/4 (both container seals sit in a table column it cannot
pair), scanned B/L 0/4, photo not readable, house B/L 2/3, house AWB 2/2.

## Not done yet

- Live check (21 October 2026, `claude-haiku-5-5`, synthetic files only): 17/17
  references right with their seals, no extras, 2 to 4 seconds a file, on the
  carrier B/L, its scan, its photo, the house B/L and the house AWB. Accuracy on
  real documents (stamps, handwriting, poor photos) is not measured yet.
- The "Read details" panel has not been checked in a browser against the live API.
- Only shipment references. Parties, ports, vessel and voyage, cargo and ETA need
  their own apply paths (next step).
- Email attachments are kept but not read.
