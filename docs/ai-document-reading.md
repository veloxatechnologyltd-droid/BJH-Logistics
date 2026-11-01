# AI reading of job documents

On a job's Shipment details tab, **Details read from documents → Read details
(draft)** proposes from one document: master and house B/L, master and house air
waybill, booking number, containers with their seals and, with AI, the parties
(shipper, consignee, notify party, agent, with address lines) and the expected
arrival (ETA).

| Set up                                         | What reads the document                                                                                                                   | Files                       |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| `ANTHROPIC_API_KEY` and `CLAUDE_MODEL` are set | Claude reads the whole file, so scans and photos work; if it fails and `OPENAI_API_KEY` + `OPENAI_MODEL` are set, OpenAI reads it instead | PDF, PNG, JPEG, up to 20 MB |
| No key                                         | The PDF's text layer is read inside the API (nothing leaves it); scans give an empty draft                                                | PDF with text only          |

Either way the result is a **draft**: nothing reaches the job until a person
checks each value against the document, corrects it if needed and applies the
ones they tick. The draft records which model read it (`readBy`; empty means the
text layer), and the screen says "Read by AI" on those drafts. Container numbers
must pass the ISO 6346 check digit (others are dropped), a master air waybill is
written `NNN-NNNNNNNN`, repeats are merged. If the AI fails (busy, key refused,
too slow) the API answers 503 with the reason and no draft is saved: try again
or add the references by hand.

Applying a **party** adds it beside the parties already on the job; one with the
same role and name is reported as "already on the job" and not added twice.
Applying the **ETA** records a new ETA entry (source "Document: <file name>",
note saying it was read by AI and checked by staff), which messages the customer
like any ETA change; the ETA that is already current is not recorded again.
Dates on documents are read as Ghana time (GMT, no daylight saving). Both rules
are assumptions to confirm with BJH (MEMORY.md, 2026-10-21).

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
- Browser check (21 October 2026, local app, live key): the synthetic photo became
  a draft with all references, seals, three parties and their addresses. Each
  detail is one row (label, full-width boxes, where it was found), checked at 1280px
  and 390px with nothing wider than the card.
- Second live run with parties and the ETA: 33/33 right on six synthetic files,
  including the ETA on an arrival notice (not the sailing date); one extra, an
  "agent" read from "BJH Logistics (as agent)".
- Vessel and voyage, ports and cargo are not read: the job has no fields for them
  (they live only in the house B/L editor), so they need a schema decision first.
- Email attachments: Claude reads the PDFs and images that come with an emailed
  request into the request's details (see [email-intake.md](email-intake.md)), not
  into a job.
