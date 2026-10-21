# Demo walkthrough: AI in the BJH operations platform

A 10-minute walkthrough of what AI does in the system and where people stay in
charge. **Everything shown is synthetic**: invented companies on reserved
`.example` email domains, invented ships and numbers, and documents stamped
"SYNTHETIC SAMPLE". Never use a real client's emails or documents in a demo.

## What it shows

1. A customer emails `quote@bjhlogistics.com` with "see attached". AI reads the
   email **and the packing list** and fills in the request.
2. The quote starts from BJH's own most similar past quote, then a person
   checks and issues it.
3. A second customer asks for the same route, and the quote prefills from the
   one just issued ("same route").
4. A phone photo of a bill of lading becomes the job's references, seals and
   parties, after a person ticks and applies them.

## Before the demo (about 15 minutes)

1. **The hosted site runs the current `main`.** On Render, set
   `ANTHROPIC_API_KEY` and `INBOUND_EMAIL_SECRET` (a long random value).
2. **Customer messages:** the demo jobs' contacts must not receive real email or
   SMS. Check that their addresses are `example.test` ones or that their
   messages are switched off (Customers, then the company). Applying an ETA,
   issuing a quote or recording a payment messages the customer's contacts.
3. **Make the files** on your machine:
   ```sh
   corepack pnpm --filter @bjh/api exec tsx scripts/make-demo-documents.ts
   ```
   They land in `.local/demo-documents/` (the scans need `pdftoppm`).
4. **Add two customers** (Customers, then New customer):
   `Akwaaba Synthetic Garments Ltd` and `Kpone Synthetic Hardware`.
5. **Send the demo emails** to the hosted API, with the same secret as Render:
   ```sh
   INBOUND_EMAIL_SECRET=... corepack pnpm --filter @bjh/api exec tsx \
     scripts/demo-emails.ts --api https://<api-host>/api --yes
   ```
   Four requests arrive, two to `quote@` and two to `inquiries@`. Sending them
   again changes nothing; add `--fresh` to send new copies for another demo.
   The first request after the free Render service has slept can take a minute.
6. Sign in as the super admin and open **Requests**: four show
   **Email · Needs checking**. Pick a demo sea-import job for step 4 and note it.

## The walkthrough

### 1. An email with an attachment becomes a request (2 minutes)

- Open **Rate request - Ningbo to Tema** from Efua Owusu. The email only says
  "for the goods on the attached packing list".
- Under **Details from the email**, AI filled: sea import, Ningbo to Tema, woven
  cotton fabric rolls, 1,240 cartons in 2 x 40' HC, 22,480 kg and 136 CBM, FOB,
  and the phone number. Open `packing-list.pdf` to show where they came from.
- Press **Looks right**. The request records who checked it and when.
- Point out: if AI could not read the email, it would still be saved and say why.

### 2. The quote starts from past pricing (3 minutes)

- Link the request to **Akwaaba Synthetic Garments Ltd**, then **Create quote**.
- Press **Prefill from a similar past quote**. The notice names the quote it
  copied, the customer it was for and how it matched. Charges, prices, container
  sizes and terms come from that quote, and the shipment line from the request.
- When the match is not the same route, the notice warns to remove or reprice
  route charges such as haulage. Do that, save the draft, and **Issue** it.

### 3. The next customer on the same route (1 minute)

- Open **Quotation needed: 1 x 40ft Ningbo to Tema** from Yaw Darko. AI read:
  ceramic floor tiles, 1 x 40ft HC, about 26 tonnes, FOB, ready early December.
- Link it to **Kpone Synthetic Hardware**, **Create quote**, **Prefill**. This
  time it says **same route**: it copied the quote issued a minute ago. Pricing
  follows BJH's own latest quote for that lane.
- The `inquiries@` emails (air export to Amsterdam, a truck to Tamale) show the
  same reading for other services; open one if there is time.

### 4. A photo of a bill of lading fills the job (3 minutes)

- Open the demo sea-import job, **Documents**, upload `sea-bl-photo.jpg` as a
  bill of lading.
- **Shipment details**, then **Details read from documents**: choose the photo
  and press **Read details (draft)**. In a few seconds AI proposes the B/L and
  booking numbers, both containers with their seals, and the shipper, consignee
  and notify party with addresses, each with the words it read them from.
- Untick anything wrong, correct a value, then **Apply the ticked details**. The
  references and parties appear on the job.
- Contrast: the same B/L as a scan (`sea-bl-scanned.pdf`) has no text inside, so
  the old reader found nothing; AI reads it the same as the photo.
- Optional, only after checking step 2 of the preparation:
  `sea-arrival-notice.pdf` proposes the ETA (2 November, 14:30, not the sailing
  date). Applying it records the ETA and messages the customer.

### 5. Close (1 minute)

- AI reads and proposes; a person checks, corrects and applies. Nothing reaches
  a job, a quote or a customer without that step, and the activity log shows who
  did what.
- Every number shown is traceable: the words AI read it from, or the past quote
  it came from.

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

## After the demo

Requests, quotes and applied details stay in the database (they are records,
not scratch data). Discard any open document drafts. For another demo, send the
emails again with `--fresh`.
