# Demo walkthrough: AI in the BJH operations platform

A 10-minute walkthrough of what AI does in the system and where people stay in
charge. **Everything shown is synthetic**: invented companies on reserved
`.example` email domains, invented ships and numbers, and documents stamped
"SYNTHETIC SAMPLE". Never use a real client's emails or documents in a demo.

## What it shows

1. A customer emails `quote@bjhlogistics.com` with "see attached". Before anyone
   touches it, AI has read the email **and the packing list**, created the
   customer, drafted the quote from BJH's own most similar past quote, and drafted
   the reply. A person checks, issues and sends.
2. A second customer asks for the same route; the draft quote now follows the one
   just issued ("same route").
3. A question ("which documents, what hours?") gets a drafted answer from BJH's
   own wording in Settings.
4. A phone photo of a bill of lading becomes the job's references, seals, parties
   and ETA, after a person ticks and applies them.
5. The first customer asks "when does it arrive?" and the drafted reply gives
   their own job's file number and that ETA, and nobody else's.

## Before the demo (about 15 minutes)

1. **The hosted site runs the current `main`**, with the production migrations
   applied (`20261027000000_email_assistant.sql` is new). On Render, set
   `ANTHROPIC_API_KEY` and `INBOUND_EMAIL_SECRET` (a long random value).
2. **Business settings, Email assistant:** paste the text BJH wants customers to be
   told (services, documents for clearing, office hours, quote validity). The
   rehearsal used an invented sample marked "SAMPLE FOR THE DEMO"; BJH must replace
   it with its own wording before real use.
3. **Customer messages:** replies and other messages go only to the synthetic
   `.example` addresses of the demo senders. Until email credentials are set they
   are recorded, not sent (Settings, Customer messages).
4. **Make the files** on your machine:
   ```sh
   corepack pnpm --filter @bjh/api exec tsx scripts/make-demo-documents.ts
   ```
   They land in `.local/demo-documents/` (the scans need `pdftoppm`).
5. **Send the demo emails** to the hosted API, with the same secret as Render:
   ```sh
   INBOUND_EMAIL_SECRET=... corepack pnpm --filter @bjh/api exec tsx \
     scripts/demo-emails.ts --api https://<api-host>/api --yes --fresh
   ```
   Four requests arrive (one to `quote@`, three to `inquiries@`); each takes a
   few seconds, and the first after the free Render service has slept can take a
   minute. Two more are sent live during the walkthrough with `--only` (steps 2
   and 5), using the same command.
6. Sign in as the super admin and open **Requests**: they show **Email · Needs
   checking · Reply ready**.

Customers no longer need to be added by hand: the assistant creates them.

## The walkthrough

### 1. An email becomes a customer, a draft quote and a reply (3 minutes)

- Open **Rate request - Ningbo to Tema** from Efua Owusu. The email only says
  "for the goods on the attached packing list".
- **Details from the email:** sea import, Ningbo to Tema, woven cotton fabric
  rolls, 1,240 cartons in 2 x 40' HC, 22,480 kg and 136 CBM, FOB, the phone.
  Open `packing-list.pdf` to show where they came from. Press **Looks right**.
- **What the assistant did:** created the customer Akwaaba Synthetic Garments Ltd,
  drafted the quote from an earlier quote and says how it matched.
- **Check the draft quote:** charges, prices and terms are BJH's own. When the
  match is not the same route, remove or reprice route charges such as haulage
  (the rehearsal copied "Haulage Tema to Kumasi" for a Kaneshie delivery: that is
  the point of the warning). **Issue to customer**.
- Back on the request, read the reply (it restates the shipment and says the
  quotation follows), edit a word, **Send reply**. It shows as sent, and under
  Settings, Customer messages.

### 2. The next customer on the same route (1 minute)

- Send Yaw Darko's email live: the same command with `--only tiles-ningbo`.
- Open **Quotation needed: 1 x 40ft Ningbo to Tema**. A new customer, Kpone
  Synthetic Hardware, and a draft quote from the quote issued a minute ago, marked
  **same route**: pricing follows BJH's own latest quote for that lane.

### 3. A question answered from BJH's own wording (1 minute)

- Open **Documents for clearing** from Kojo Asante. Sorted as a question, no
  quote. The reply lists the documents and office hours exactly as written in
  Settings, and says a colleague will confirm the permits for his goods. Without
  the Settings text it would say a colleague will confirm, never guess.

### 4. A photo of a bill of lading fills the job (3 minutes)

- Open **Jobs**, create a sea import job for **Akwaaba Synthetic Garments Ltd**,
  then **Documents**, upload `sea-bl-photo.jpg` as a bill of lading.
- **Shipment details**, **Details read from documents**: choose the photo, **Read
  details (draft)**. AI proposes the B/L and booking numbers, both containers with
  their seals, and the parties with addresses, each with the words it read.
- Untick anything wrong, correct a value, **Apply the ticked details**.
- Upload `sea-arrival-notice.pdf` and read it: it proposes the ETA (2 November,
  14:30, not the sailing date). Apply it.

### 5. The customer asks when it arrives (1 minute)

- Send the follow-up live: the same command with `--only where-is-container`.
- Open **Arrival of our container**. The assistant linked it to Akwaaba (the
  sender is its contact) and the reply gives the job's file number and the ETA
  applied a minute ago. It only ever sees that customer's jobs.

### 6. Close (1 minute)

- AI reads, sorts, prepares and drafts; a person checks, corrects, issues and
  sends. Nothing reaches a customer without that step, and every step is listed
  on the request.
- Every number is traceable: the words AI read it from, the past quote it came
  from, or the Settings text it quotes.

## Results seen in rehearsal (21 October 2026, local app, `claude-haiku-5-5`)

| Email (to)                   | Service        | Route                              | Cargo / packages / weight                                                        | Other                      |
| ---------------------------- | -------------- | ---------------------------------- | -------------------------------------------------------------------------------- | -------------------------- |
| Efua Owusu (`quote@`)        | sea import     | Ningbo to Tema                     | woven cotton fabric rolls · 1,240 cartons, 2 x 40' HC · 22,480 kg, 136 CBM (PDF) | FOB, phone                 |
| Yaw Darko (`quote@`)         | sea import     | Ningbo to Tema                     | ceramic floor tiles · 1 x 40ft HC · about 26 tonnes                              | FOB, early December, phone |
| Abena Sarpong (`inquiries@`) | air export     | Kumasi via Accra to Amsterdam      | dried cocoa products · 24 pieces · 480 kg                                        | mid-November               |
| Kwesi Mensah (`inquiries@`)  | road transport | Tema port to "our depot in Tamale" | bagged rice · 1 x 40ft container                                                 | next week                  |

Documents: 33 of 33 references, seals, parties and the arrival-notice ETA were
right across the six synthetic files (`scripts/try-ai-reading.ts`); one extra,
an "agent" read from "BJH Logistics (as agent)", which a person unticks.

## Rehearsal of the assistant (28 October 2026, local app, `claude-haiku-5-5`)

All six synthetic emails were sorted correctly (four quote requests, two
questions); five new customers were created and the follow-up was linked to the
existing contact; four draft quotes were made (two from a past sea import quote,
"same service" since the local data had no Ningbo quote; air export and road
transport with no charges, as no such quote was issued yet). Replies: the quote
requests restated the shipment and asked only for missing details (Incoterm,
volume); the documents question answered from the Settings text only after that
text was saved (before it, an earlier prompt listed "usual" documents from general
knowledge, which the prompt now forbids); the follow-up gave the file number
BJH/SI/2026/0010 and its ETA. One reply was sent from the browser: one email
delivery, to the sender only, recorded by the stub.

## After the demo

Requests, customers, quotes and applied details stay in the database (they are
records, not scratch data). Discard any open document drafts. For another demo,
send the emails again with `--fresh`.
