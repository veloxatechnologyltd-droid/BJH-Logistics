# Implementation checklist — working plan

Derived from [audit-2026-09-29.md](audit-2026-09-29.md). This is the **ordered work plan**; [CHECKLIST.md](../CHECKLIST.md) stays the master acceptance/evidence ledger. Tick an item here when its "done when" is met, then record evidence in CHECKLIST.md.

Ordering assumes the proposed **"job file first"** release shape (audit §3.3). If Evans keeps the current delivery-plan order, move Workstream D (quotes) ahead of B/C. Items marked **⚑** are blocked on a decision.

Each item: requirement IDs · done when.

---

## A — Housekeeping and foundation gaps (do first)

- [ ] **A1** Commit the uncommitted department-assignment slice (22 files + migration) · `git status` clean; migration in history.
- [x] **A2** Gitignore `.playwright-mcp/` · not listed by `git status`.
- [x] **A3** Fix `AGENTS.md` formatting · `pnpm format:check` passes.
- [x] **A4** Align docs with D04: remove "invitation-based" wording from `docs/security-operations.md` and CHECKLIST Phase 1 · no doc contradicts D04.
- [x] **A5** Split `test` vs `test:e2e` scripts (currently identical) · each script runs a distinct set.
- [x] **A6** Retire SQLite adapter (confirmed 2026-09-29): run API tests against local Supabase Postgres with per-test isolation; delete `sqlite-database.service.ts` + SQLite migrations (confirm deletion at the time) · all API tests pass on Postgres; one adapter remains.
- [x] **A7** Add `packages/contracts` with schema validation (e.g. zod) shared by API and web; migrate existing customer/quote-request/staff bodies · API rejects invalid bodies via shared schemas; web imports types from contracts.
- [ ] **A8** CI on GitHub Actions: install (frozen lockfile), lint, format, typecheck, tests against Postgres service, pgTAP, build · green run on a PR. _(2026-09-29: `.github/workflows/ci.yml` written; steps verified locally; green PR run pending)_
- [x] **A9** API hardening: env-driven listen host and CORS origins, security headers, rate limit on auth/bootstrap routes, redacted structured logging · config verified by test; no hard-coded localhost in production path.
- [x] **A10** Resolve roles + memberships once per request into request context; guards read context · one role lookup per request; existing access tests still pass.

## B — Job file core (Release 1) · P03, P04, P14

- [x] **B1** ⚑ Confirm job-number format (D12 open) — propose e.g. `BJH/{SI|SE|AI|AE}/{YYYY}/{seq}` · decision logged.
- [x] **B2** Migration: `job` (file number unique, service/direction/mode, customer company, owner role, status, dates), `number_sequence` with transactional allocation · concurrent-create test yields unique numbers.
- [x] **B3** Job API: create directly without a quote (confirmed: any staff role; reps within their own service line — assumption), list/search, detail; company scoping for customers; department scoping by role · cross-company and wrong-department denial tests.
- [x] **B4** `job_party` (shipper, consignee, notify, agents) and `shipment_reference` with **master/house hierarchy** (MBL/HBL, MAWB/HAWB, booking, container + seal) · one master → many houses supported; search by any reference.
- [x] **B5** Milestone template for **sea import** (D02 draft from `docs/workflows.md`); `milestone_event` append-only with actor, time, source, note · events can't be edited/deleted; correction = new event.
- [x] **B6** Job status transitions (`open → in_progress → on_hold → ready_to_close → closed/cancelled`), reopen needs a reason and the department in charge (or super admin) - per Evans 2026-09-29 · invalid transition tests.
- [x] **B7** Web: job list, create form, job detail with timeline and parties/references · browser check at 390px/1280px. _(2026-09-29: checked in a browser at 1280px and 390px as a sea-import rep: opened a job, recorded a milestone, added a party and a booking; no horizontal page scroll at 390px. Activity log page checked only as a non-admin, which correctly shows the denial.)_
- [x] **B8** Audit events for job create/status/owner changes · audit rows asserted in tests. _(2026-09-29: covered by the activity log — job create, status, milestone, party and reference requests — plus `job_status_history`; there is no separate owner field because ownership is the service line.)_

## C — Document archive (Release 1) · P08, P14

- [x] **C1** Private Supabase Storage bucket via migration; no public access · pgTAP/storage policy test denies anon/authenticated direct access.
- [x] **C2** Upload API: authenticated, job-bound, type/size and magic-byte validation, checksum, random object key, `document` + `document_version` rows · invalid type/oversize rejected.
- [x] **C3** Document types incl. **supplier invoice / disbursement evidence** distinct from BJH invoices · type required on upload.
- [x] **C4** Download via API authorization → short-lived signed URL · cross-company download denied by known ID.
- [x] **C5** Search across file number, customer, B/L/AWB, container, document type, date · synthetic "3-year-old job" retrievable in one search.
- [x] **C6** Web: upload/list/download on job detail; global search · browser check.
- [x] **C7** Document library: one search across every document, standalone or job-bound, company-scoped for customers · cross-company download denied by known ID. _(2026-10-04: `/documents`, `GET/POST /api/v1/documents`, `.../:id/download`; see CHECKLIST evidence log. Web page typechecked and built, not yet checked in a browser.)_

## D — Structured quotations · P02

- [ ] **D1** Replace free-text draft with `quote_version` + `quote_line` (basis: fixed / per B/L / per container / at cost; quote-specific size labels and per-size minor-unit amounts; ISO currency); keep notes field · migration + API tests. _(2026-09-29: the sample quotation was initially interpreted as fixed 20ft/40ft columns; Evans clarified 2026-10-01 that these are examples and quotes must allow multiple different sizes. Migration, editor, customer view, PDF and quote-to-job import must all use the quote's own size labels. The old free-text draft was retired 2026-09-30; requests now link to the real quote. Re-opened 2026-10-01 to verify the expanded size rules in a migrated local database and browser.)_
- [x] **D2** Rep prepares and issues directly to the customer (no approval step, per Evans 2026-09-29); the super admin sees every quote, draft and action; issued version is immutable · edit of issued version rejected. _(2026-09-29: DB triggers and API both refuse edits; a change is a new version.)_
- [x] **D3** Record acceptance/rejection against a specific version (actor, time) · D12 behaviour tested. _(2026-09-29: any rep on the quote's service line or the super admin records it on the client's behalf, with the client's named signatory; only the latest issued version can be decided; append-only. Web form typechecked and built, not yet checked in a browser.)_
- [x] **D4** Accepted quote → at most one job (idempotent under retry) · concurrent-accept test yields one job. _(2026-09-29: accepting opens the job in the same transaction; four simultaneous accepts return the same decision and job. The e2e harness shares one connection, so true parallel connections are covered by the database uniqueness tests, not the HTTP test.)_
- [x] **D5** Quote PDF from approved template, marked draft until D03 settings configured · preview matches `/documents-preview` layout. _(2026-09-29: `GET /api/v1/quotes/:id/pdf?version=N`; layout follows the preview page and was checked by rendering pages to images; marked DRAFT until the version is issued and settings exist. Not yet done: a logo (the supplied logo is client material that may not be committed), and a stored copy at issue time, so a PDF regenerated later uses the settings current then. "Approved template" is my reading of the two sample quotations; the client has not signed off the layout.)_

## E — Remaining shipment flows and ETA · P04, P05

- [x] **E1** Sea export milestone template (D02).
- [x] **E2** Air import and air export templates; no EIR requirement for air (D02).
- [x] **E3** Manual ETA entry with source and correction history; exceptions (missing docs, damage, delay) as tasks · correction never overwrites history. _(2026-09-29: API, migration and tests done; the web ETA and task sections are typechecked but not yet checked in a browser.)_
- [x] **E4** Tasks per job assigned to role, with due dates · list "my department's open tasks". _(2026-09-29: `GET /api/v1/tasks?assignedRole=` lists open work, scoped to the caller's service lines; web check pending as above.)_

## F — Finance records · P06

- [x] **F1** Issuer/tax/currency settings screen (D03) — VAT/levies, currencies, numbering; no hard-coded values · settings required before any invoice issues. _(2026-09-29: settings, revisions, currency restriction and quote-number prefix done and tested. "Required before any invoice issues" is enforced when invoices are built (F3). Web form typechecked and built, not yet checked in a browser.)_
- [x] **F2** Charges: quoted vs actual; disbursements linked to supplier-invoice documents; exchange rate captured per transaction. _(2026-09-29: charges with quoted amounts, append-only actual amounts, supplier-document link (optional, flagged when missing), exchange rate and converted amount fixed per entry, copy from the accepted quote. Web section typechecked and built, not yet checked in a browser.)_
- [x] **F3** Customer invoice versions with unique numbering, due date, tax lines from settings; corrections via revision/credit · issued invoice immutable. _(2026-09-30: draft, issue, void; number `{invoicePrefix}/{YYYY}/{seq}` allocated at issue; due date from the invoice or the settings' payment terms; tax lines from Settings, each a percentage of the taxable amount, total rounded once as on the client's sample; issued invoice immutable in the API and the database. Correction is void-and-reissue, not versions or credit notes: revisit if BJH wants credit notes. Web section typechecked and built, not yet checked in a browser. **Changed 2026-11-25 (client request):** the number is allocated when the invoice (or quote) is created, not at issue, because staff print drafts; an issued invoice with no payment standing can be edited (same number, issue date, currency and tax rates; `revision` counts edits, replaced versions kept in `app.invoice_revision`); with a payment standing it stays locked until the payment is reversed. Void is unchanged.)_
- [x] **F4** Staff-recorded external payments (partial/multiple), method/reference/evidence, reversal with reason; outstanding balance derived from ledger · arithmetic + over-allocation tests; money in minor units only. _(2026-09-30: append-only payments with method, reference, date received and optional evidence document on the same job; reversal with a reason; over-payment refused in the API and the database; balance derived from standing payments; payments still accepted after the job is closed.)_
- [x] **F5** Receipt PDF (conventional receipt, D06) · never implies bank verification. _(2026-09-30: each payment recorded from now on gets a receipt number `{receiptPrefix}/{YYYY}/{seq}` (default `BJH/RCT`); `GET /api/v1/jobs/:id/invoices/:invoiceId/payments/:paymentId/receipt` prints a plain acknowledgement (amount, date, method, reference, invoice, balance now) that states it is not a bank confirmation; a reversed payment's receipt is stamped REVERSED with the reason. Staff-only for now: customers get no payment list to pick a receipt from. Payments recorded before this migration have no number and no receipt. Web button typechecked and built, not yet checked in a browser.)_
- [x] **F6** D15 answered by Evans 2026-09-29: BJH invoices do not go through GRA e-VAT; no integration needed.

## G — Delivery paperwork and closure · P07

- [x] **G1** Drivers/vehicles; numbered waybill with frozen driver/vehicle/cargo snapshot. _(2026-09-29: drivers and vehicles as records, numbered waybill with the driver, vehicle and cargo frozen at dispatch. The waybill number `BJH/WB/{YYYY}/{seq}` and its fields are assumptions: no BJH waybill sample was supplied, so there is no printable waybill yet. Web screens typechecked and built, not yet checked in a browser.)_
- [x] **G2** POD upload (scanned) with receiver, date/time, damage notes. _(2026-09-29: recorded once on the delivery: receiver, phone, time, damage notes and the signed delivery note document. Customers can read their own company's waybills and proofs.)_
- [ ] **G3** Container return + EIR for containerised imports. _(2026-09-29: largely covered by existing pieces: the `empty_container_returned` and `eir_received` milestones and the EIR document type. Not built: tracking which of several containers was returned.)_
- [x] **G4** Closure gate: dropped 2026-09-30 by Evans ("make it open"). Closing a job is not blocked by missing evidence; reopen/override reasons stay as built. No work needed.
- [x] **G5** D14: house B/L / HAWB / manifest generation — only if BJH confirms authority and template. _(2026-09-30: `/api/v1/jobs/:id/transport-documents` prepares BJH's own house B/L (sea jobs), house air waybill and air manifest (air jobs) as printable PDFs laid out from the client's samples. A document starts from what the job holds (parties, master/house references, containers and seals, issuer) via `prefill`; staff fill in the rest (ports, vessel, goods, weights, freight terms). Staff type the document number (the samples follow no single pattern); it must be unused among issued documents of that kind, and voiding a document frees its number. Draft, then issued (frozen), then void; customers read issued ones of their own company. Assumptions to confirm with BJH: the field lists, the number rule, and the layout, which follow the three samples only; no client logo. Web editor typechecked and built, not yet checked in a browser.)_

## H — Client portal and notifications · P10, P11

- [x] **H1** Super admin creates customer-user accounts like staff accounts and links them to a company (confirmed 2026-09-29) · customer signs in and sees only their company. _(2026-09-30: `GET/POST /api/v1/admin/customer-accounts`, `PATCH .../:userId/password`, `POST .../:userId/suspend|activate` (super admin only); creating an account makes the login and links it to one company in one step, with no staff role; more companies via the existing membership endpoints; a staff account cannot be managed here. Web page `/settings/customer-accounts` typechecked and built, not yet checked in a browser. A real Supabase Auth sign-in with a customer account has not been run.)_
- [x] **H2** Customer routes: own jobs, milestones/ETA, documents, invoices, quote requests · guessed-ID denial tests for every resource. _(2026-09-30: the session endpoint now answers customers (with their companies) so sign-in works; customers read their own company's jobs, milestones, ETA, parties, references, documents, deliveries/waybills, invoices, quotes and quote requests, and can send a quote request (`POST /api/v1/quote-requests/mine`, company and email taken from the account). `apps/api/test/portal.e2e-spec.ts` asserts, for 16 resource routes with known IDs, 200 for the owner and 404 for another company, empty lists for another company, 403 on every staff-only read and write, and 404 for guessed or malformed IDs. Web: customer menu, `/portal` home with the request form; typechecked and built, not browser-checked. Customers cannot yet see the payment ledger or receipts, and staff-entered tasks stay internal.)_
- [x] **H3** Email provider adapter (D08): job-linked messages, templates, consent, delivery attempts, dedupe · sandbox tests only. _(2026-09-30: email goes out by plain SMTP (`EMAIL_SMTP_*`, `EMAIL_FROM`), so any mailbox provider works; without them emails are only recorded (stub). Every message goes through one outbox with a delivery per contact and channel, a dedupe key so an event is never sent twice, retries with a growing delay and a visible failed state. The super admin chooses email, SMS or both in Business settings; a log page (`/settings/notifications`) shows every delivery, errors and a Retry button. Tested with recording stubs only; a real SMTP send has not been run.)_
- [x] **H4** SMS provider with Ghana coverage (D08) · sandbox tests only. _(2026-09-30: SMS through Arkesel (`ARKESEL_API_KEY`, `SMS_SENDER_ID`), request shape checked against Arkesel's developer guide and covered by a unit test with a mocked fetch; Ghana numbers are normalised to +233. Every SMS ends with a link to the customer's page (job, quotation). Moolre is not implemented: its API documentation could not be read from here. Without the key SMS is only recorded (stub). 2026-11-16: a real test SMS to two Evans-approved numbers was accepted by Arkesel and received, sender ID `BJH Logist`; sent through the provider directly, not yet through the outbox, and not yet configured on Render.)_
- [x] **H5** Manual correspondence log on job (email/WhatsApp notes + attachments) — covers client's current WhatsApp habit until D13. _(2026-09-30: `GET/POST /api/v1/jobs/:id/correspondence`; append-only entries with channel (email, WhatsApp, SMS, phone, letter, other), direction, when it happened, counterparty, subject, text and an optional attachment from the job's own documents; staff only and hidden from customers; logging stays open after the job is closed; staff can find a job by what was logged in the job search, customers cannot. Nothing is sent from here. Web section typechecked and built, not yet checked in a browser.)_
- [x] **H6** Worker process + Redis/BullMQ for sends and reminders; idempotent, retry, failure view. _(2026-09-30: built without Redis/BullMQ: a database outbox and a dispatcher inside the API process (claims deliveries with row locks, so several instances are safe; a lease returns a delivery if a worker dies; 5 attempts at 1, 4, 9 and 16 minute gaps). Move to a separate worker and queue if volume or reliability needs it.)_

## I — Later services and automation · P05, P09, P12, P13

- [x] **I1** Text-layer extraction for B/L / HAWB PDFs → draft fields → human review → approved apply (D09). _(2026-09-30: `POST /api/v1/jobs/:id/documents/:documentId/extract` reads a PDF's text layer on the server (pdfjs; no third party) and stores a DRAFT of proposed references: master/house B/L and AWB numbers, booking numbers, and containers with seals (only containers whose ISO 6346 check digit is right). A draft never touches the job; `POST .../extractions/:id/approve` applies the fields a person ticked, with their corrections, masters first so house documents link to their master, reporting per field what happened (added, already on the job, refused and why); `.../reject` discards it. Scanned PDFs and images give an empty draft or a refusal: OCR is not enabled (I2). Parties and other fields are not read. Web review section on the job page typechecked, built and used in a browser.)_
- [ ] **I2** ⚑ OCR for scanned documents only after Evans permits it and a provider trial on redacted samples.
- [x] **I3** Dropped by Evans 2026-10-04: carrier/airline tracking cannot be done now; ETAs stay staff-entered. No work needed.
- [x] **I4** Warehousing, light scope (confirmed 2026-09-29): goods received/released per customer, simple location, quantity, no negative stock, basic stock report — no full inventory system · managed by existing staff roles (confirmed). _(2026-09-30: new `warehousing` service line (file numbers `BJH/WH/{YYYY}/{seq}`, quotes `.../Q/WH/...`), named locations, and an append-only ledger of goods received and released per job, location, item and unit, with condition notes and a delivery-note/release-order reference. The balance never goes below zero at any date, including backdated entries; a dated stock report per customer; customers read their own company's stock. Any rep manages it (no separate role). Storage is billed with ordinary invoice lines. Corrections are an opposite movement, not an edit. Web (`/warehouse`, job stock section) typechecked and built, not yet checked in a browser.)_
- [x] **I5** Standalone road transport, simple scope: assign driver/truck, waybill, delivery confirmation, charges · staff assign a driver record (name, phone); drivers do not sign in (confirmed). _(2026-09-30: new `road_transport` service line (`BJH/RT/{YYYY}/{seq}`, quotes `.../Q/RT/...`); a standalone road job uses the existing driver/vehicle records, numbered waybill with frozen details, proof of delivery, waybill PDF, charges, quotes and invoices; no milestone list (deliveries carry the progress). Any rep can open and work it. The waybill layout is still the interim one built from the client's samples.)_

## J — Production readiness (before any real data)

- [ ] **J1** ⚑ Hosting provider/region, staging + production projects (D11).
- [ ] **J2** Least-privilege API DB role; verify isolation on staging.
- [ ] **J3** Backup **and Storage** restore drill with agreed RPO/RTO.
- [ ] **J4** Monitoring, alerts, runbooks; MFA for admin accounts.
- [ ] **J5** Security review (ID enumeration, signed URLs, sessions, finance edits, audit integrity).
- [ ] **J6** Staff training, UAT sign-off, controlled launch.

---

## Client questions to send / chase

- D01, D02, D05 cancelled by Evans 2026-09-29 (full system; workflows from client messages; company owns its data). Nothing outstanding from `questions.md` blocks the build.
- **New D14:** Does BJH issue house B/Ls / house AWBs / manifests itself, and should the system generate them? Numbering format?
- ~~**New D15:** Are BJH customer invoices required to be GRA e-VAT invoices?~~ Answered 2026-09-29: no.
- Confirm R1 communications = app email/SMS + manual log (WhatsApp later), and R1 tracking = staff-entered ETA.
