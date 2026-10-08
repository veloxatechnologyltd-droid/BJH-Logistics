Maintain a file called MEMORY.md. After any significant decision, about direction, format, content, approach, or strategy, add an entry:

## 2026-10-05, Errors shown as a pop-up

**What was decided:** Action and form errors appear in a centred pop-up (`apps/web/app/ErrorPopup.tsx`) with an OK button instead of a line at the top of the page. Common technical messages (network failure, server error, permission, validation) are reworded in plain language there. Full-page "could not be loaded" states keep their inline panel.
**Why:** Staff are not technical and should not have to scroll up to find out why an action failed.
**What was rejected:** A toast that disappears on its own (easy to miss) and rewording every message in each API file.

## 2026-10-04, Customer page as a lead and account workspace

**What was decided:** Treat incoming quote requests as the current lead records on the customer page. Show their company-match and quote state from existing data, alongside customer and contact counts and the searchable company directory. Do not add pipeline stages, lead ownership, or follow-up fields until those rules are agreed.
**Why:** The existing system already captures inbound quote enquiries and supports linking them to customer profiles, but has no confirmed sales-pipeline rules.
**What was rejected:** Inventing a CRM status pipeline or treating directory records alone as lead tracking.

## 2026-10-04, Customer IDs and removal of the enquiries panel

**What was decided:** Give each customer a stable readable ID in the format `CUS-0001`, assign IDs to existing companies in creation order, and show the ID in the directory and profile. Remove the quote-enquiries panel from the customer page as requested.
**Why:** Evans asked for every customer to have an ID and then asked to remove the lead panel shown in the screenshot.
**What was rejected:** Showing only an internal UUID or keeping the enquiries panel on the customer page.

## [Date], [Decision]

**What was decided:** [the choice made]
**Why:** [the reasoning]
**What was rejected:** [alternatives considered and why they were ruled out]

Read MEMORY.md at the start of every session before doing anything. Never contradict a logged decision without flagging it first.

## 2026-09-28, D04 company access and role administration

**What was decided:** The super admin creates user accounts and assigns roles in the admin section. Customer access follows explicit company assignment: each user sees all business records belonging to assigned companies and no records belonging to other companies; no per-record publication gate or document-type list.
**Why:** The user reconfirmed that each company should see all data belonging to it and no other company's data, and that role assignment is administered dynamically.
**What was rejected:** Repeating questions about role names, staff names, multi-company access, and customer-visible record types; these are superseded by the confirmed access model.

## 2026-09-28, Local super-admin bootstrap

**What was decided:** Use Supabase Auth locally for signup/sign-in. The first authenticated user can claim the single `super_admin` role once; Nest verifies Supabase JWT claims and requires that role for current staff business APIs. Store this temporary bootstrap role in local SQLite; later accounts are to be created and assigned by the super admin.
**Why:** The user wants to sign up the super admin and use that account for local testing while continuing to build.
**What was rejected:** An open repeatable super-admin signup or using the hosted Supabase project for the local testing account.

## 2026-09-28, First business-engine slice

**What was decided:** Start P02 with local SQLite persistence for quote requests and a connected staff inbox/detail form; do not include authentication, pricing, quote acceptance, or job creation in this slice.
**Why:** It turns the existing local-only intake preview into the first runnable business flow while D03/D12 pricing and job-number rules remain open.
**What was rejected:** Starting with authentication or treating this request-intake slice as the full quote-to-job engine.

## 2026-09-28, Customer record creation behavior

**What was decided:** Model customer companies and contacts separately in local SQLite; create a company with its initial contact; search across company name, contact name and email. Same-name company submissions create distinct records rather than auto-merging.
**Why:** This supports P01 while avoiding silent merging without an agreed duplicate-resolution rule.
**What was rejected:** Automatic company matching/merging during intake.

## 2026-09-28, Quote request company association

**What was decided:** Staff explicitly links a quote request to a customer company from the request detail view; the company profile then shows its linked requests.
**Why:** This connects P01 and P02 without inferring that a request and customer are the same solely because their names match.
**What was rejected:** Automatic request-to-customer matching by company-name text.

## 2026-09-28, Quote draft content and revisions

**What was decided:** The local draft slice stores one editable plain-text body per explicitly customer-associated quote request. Each save appends an immutable numbered content snapshot; request and customer history expose revision count and latest save time. Drafts cannot be read or saved before explicit association.
**Why:** This provides editable, traceable local work while D03 and D06 still govern approved pricing, tax, terms, numbering, and issued-document structure.
**What was rejected:** Inventing structured rates, currency/tax fields, legal terms, quote issuance or acceptance, or job creation in this slice.

## 2026-09-28, Supabase-first local integration and confirmed D03/D06/D12

**What was decided:** Use the local Supabase stack for Auth and business persistence during development, with a scripted start/migrate/app launch and a data-preserving stop command. D03 settings are configurable by authorized BJH users without legal/tax assumptions; department reps prepare operational records and documents for super-admin approval (D06); quote acceptance applies to the identified quote version and records actor/time, with no separate evidence attachment or historic import (D12).
**Why:** The user wants production-directed builds to exercise Supabase earlier and explicitly answered these discovery decisions.
**What was rejected:** Switching this testing slice to a hosted Supabase project, resetting or clearing local data during development, reopening answered D03/D06/D12 questions, or adding quote issuance/job creation to the draft slice.

## 2026-09-28, Operations-first dashboard presentation

**What was decided:** Present the home screen around customer and quotation tasks, with a concise request-to-draft handoff and honest local-environment labeling. Do not show invented workload metrics or unfinished jobs as active modules.
**Why:** The user said the dashboard looked too much like a demo platform; task-first navigation better reflects current usable workflows without overstating implementation.
**What was rejected:** Sample-data cards, fake counts, and an unfinished Jobs destination in primary navigation.

## 2026-09-28, Dashboard brand colors

**What was decided:** Use the documented BJH deep blue (`#0B3FAE`) and light blue (`#5C9FD6`) palette for the dashboard, with neutral surfaces and green reserved for connection status.
**Why:** The user asked for the dashboard colors to match the logo; the brand guide records these approximate logo colors.
**What was rejected:** The green-led dashboard palette.

## 2026-09-28, Local pgTAP fixture isolation

**What was decided:** Scope role and audit-event count assertions to the synthetic identities created by the test transaction so the access suite also passes against a persistent local database.
**Why:** The local database can contain a durable super-admin role and audit history; whole-table counts incorrectly treated those legitimate rows as test failures.
**What was rejected:** Resetting the local database before tests or counting unrelated durable rows as part of the fixture.

## 2026-09-28, Local web development port

**What was decided:** Run the local web app on port 3002, keep the API on 3001, and provide a web-only Supabase dev command for cases where the API is already running.
**Why:** Port 3000 was occupied by an existing web dev process, while the local API was already serving on 3001.
**What was rejected:** Replacing or terminating the existing port-3000 process to start another copy.

## 2026-09-28, D04 staff administration slice

**What was decided:** Put staff Auth administration behind super-admin-guarded Nest endpoints. Keep Supabase service-role credentials in the API process only; invite accounts into a password-setup route; preserve role assignment/revocation history; and enforce the single active `super_admin` invariant in PostgreSQL.
**Why:** The confirmed D04 workflow says the super admin creates accounts and assigns roles, while browser code must not hold privileged credentials and local tests must not send real invitations.
**What was rejected:** Calling Supabase Auth Admin from the browser, testing by sending client invitations, allowing super-admin role reassignment through the staff form, or replacing immutable role history with in-place edits.

## 2026-09-28, Persistent local singleton test fixture

**What was decided:** Before inserting pgTAP's synthetic super-admin, temporarily revoke the already-persisted local singleton inside the test's outer transaction; the final rollback restores it. Keep the database-level duplicate-role assertion and retain the no-reset local test workflow.
**Why:** The new partial unique index correctly rejected the test's fixed synthetic super-admin when a durable local admin already existed. The suite must validate the invariant against persistent local data without clearing that data.
**What was rejected:** Removing the singleton invariant, resetting the local database, or weakening the test to avoid exercising the unique constraint.

## 2026-09-28, Sidebar settings grouping

**What was decided:** Keep system status under a SETTINGS sidebar group, below the main workspace navigation, and share that group between the overview and staff-access screens. Do not add links for settings workflows that do not exist yet.
**Why:** The user wants settings grouped together in the lower sidebar area, and System status is the only available settings-related destination today.
**What was rejected:** Leaving System status in the top bar or linking to placeholder settings features.

## 2026-09-28, Settings hub clarification

**What was decided:** Treat Settings as a hub in the lower sidebar, with distinct pages for Staff management and System status. Move staff management to `/settings/staff` and redirect the former `/admin/users` path there.
**Why:** The user clarified that Settings will contain multiple settings pages and specifically includes staff management; a label grouping System status alone did not meet the requested navigation model.
**What was rejected:** A Settings heading that links directly to System status while staff administration stays in the workspace navigation.

## 2026-09-28, Super-admin account lifecycle

**What was decided:** The super admin directly creates staff accounts, chooses their initial passwords, and manually provides sign-in details. Staff administration supports password replacement and reversible suspension/reactivation; it does not send invitations. Reusing an account keeps all activity attributed to that account, not the person using it.
**Why:** The user specified administrator-managed account creation and control rather than invitation-based onboarding.
**What was rejected:** Requiring invitees to accept an email and set up their own account.

## 2026-09-28, Department staff read access

**What was decided:** Department reps can read all customer profiles and quote-request inbox/details. Customer users remain scoped to active company memberships. Department reps cannot read quote draft content or create, link, or edit records until request assignment exists; the super admin keeps those actions and approves departmental work.
**Why:** Shared customer context supports triage, while draft and write access must wait for department assignment so one role does not prepare another department's work.
**What was rejected:** Denying department staff all shared customer/request reads, or giving them unassigned draft and write access across departments.

## 2026-09-29, Manual quote-request department assignment

**What was decided:** The super admin manually assigns or clears each quote request's air/sea import/export department role. Only active representatives with that assigned role can read or revise the linked quote draft; assignment changes keep actor/time history. Drafts stay unissued for later super-admin review.
**Why:** This implements the department handoff without inferring service type from free-text requests or granting departments access to one another's drafts.
**What was rejected:** Automatic routing from request text and assigning work to named staff instead of the existing role model.

## 2026-09-29, Persistent workspace sidebar

**What was decided:** Keep the shared workspace sidebar available across operational pages, highlight the current section, and make it sticky while scrolling on desktop and mobile. Leave sign-in and account setup pages outside the workspace shell.
**Why:** The user wants navigation to stay within reach while moving among work screens.
**What was rejected:** Page-specific sidebars that disappear on customer and quotation routes or duplicate across different screens.

## 2026-09-29, Project audit deliverables kept local

**What was decided:** Write the engineering + shipping audit to `docs/audit-2026-09-29.md` and the ordered work plan to `docs/implementation-checklist.md`; keep `CHECKLIST.md` as the acceptance/evidence ledger. The audit proposes (not decides) a "job file first" release order and retiring the SQLite adapter — both await Evans's decision.
**Why:** The audit draws on confidential client material, which AGENTS.md forbids uploading without permission; a separate plan avoids rewriting the verified evidence ledger.
**What was rejected:** Publishing the report as a hosted doc/artifact; rewriting CHECKLIST.md in place.

## 2026-09-29, Retire SQLite; direct jobs; light warehouse/road scope

**What was decided:** (1) Retire the SQLite adapter; API tests move to local Supabase PostgreSQL. (2) Jobs open after a client accepts a quote, or directly without a quote for existing clients. (3) Warehousing and road transport are light: simple goods-in/out and driver/truck assignment, not a full inventory system.
**Why:** Evans confirmed each in response to the 2026-09-29 audit; dual adapters doubled work, and the client described both quote-led and direct jobs and a small warehouse operation.
**What was rejected:** Keeping SQLite for focused tests; quote-only job creation; a full stock-ledger warehouse module.

## 2026-09-29, Direct jobs, driver assignment and customer accounts

**What was decided:** Any active staff role can open a job directly without a quote. Existing staff manage warehousing, with no separate role. Road transport work is assigned to a driver. The super admin creates customer accounts the same way as staff accounts.
**Why:** Evans answered the open audit questions.
**What was rejected:** Super-admin-only direct jobs; a dedicated warehouse role; invitation-based customer onboarding.

## 2026-09-29, Drivers are records, not users

**What was decided:** Drivers are stored as name and phone records that staff assign to road trips; they have no sign-in or role.
**Why:** Evans confirmed staff handle driver assignment; drivers do not need system access.
**What was rejected:** A driver sign-in for delivery confirmation from a phone.

## 2026-09-29, Release order: job file first

**What was decided:** Build the staff-only job file first (Release 1: jobs with file numbers, milestone timeline, private document archive/search, manual ETA, supplier-invoice upload, staff notes). Then structured quotes/invoices/payments (R2), customer portal and notifications (R3), automation and other services (R4). Work order follows `docs/implementation-checklist.md`.
**Why:** Evans chose it in response to the audit; it addresses the client's stated pain (finding old job documents) before quote issuance.
**What was rejected:** Keeping the delivery-plan order that puts quote issuance/acceptance ahead of jobs. `docs/delivery-plan.md` still shows the old order and needs aligning (follow-up).

## 2026-09-29, API tests run on local Postgres in a rolled-back transaction

**What was decided:** API e2e tests use local Supabase PostgreSQL. Each test file opens one outer transaction, truncates the `app` tables, seeds synthetic `auth.users`, and rolls back at the end; the API's BEGIN/COMMIT/ROLLBACK become savepoints on one serialized connection (`apps/api/test/postgres-test-database.ts`). `test:e2e` runs files sequentially. `test` now runs only `*.unit-spec.ts`.
**Why:** Keeps local dev data untouched, needs no extra database, and gives fresh state per file like the old temp SQLite files. The `.env` `DATABASE_URL` points at a hosted project, so the harness ignores it and requires the local port.
**What was rejected:** A separate test database (auth schema/FKs make cloning impractical); truncating the dev database (destroys dev data); a `DATABASE_URL` from `.env` (hosted).

## 2026-09-29, Shared request contracts (`@bjh/contracts`)

**What was decided:** `packages/contracts` (zod 4, compiled to `dist` with tsc) holds the request-body schemas for customers, quote requests, quote drafts, department assignment and staff role/create bodies, with the API's existing error wording. API services parse through `parseContract`; web imports the types. Root `typecheck`, `test`, `test:e2e` build contracts first.
**Why:** Removes hand-written duplicate validation and gives web/API one source for shapes (A7).
**What was rejected:** Sharing TypeScript source without a build step (Nest's `tsc` build would compile it into the wrong root); class-validator DTOs (would duplicate types for the web).

## 2026-09-29, SQLite retired; job-number format; local migrations authorised

**What was decided:** SQLite adapter, its migrations, `migrate.ts`, `.local/logistics.sqlite` and `better-sqlite3` were deleted (Evans approved the listed set). `DATABASE_URL` is now required. Job numbers use `BJH/{SI|SE|AI|AE}/{YYYY}/{seq}`. Migrations may be applied to the local Supabase database only.
**Why:** Evans answered these explicitly in-session; one adapter halves feature cost and tests now match the shipping database.
**What was rejected:** Keeping the `.sqlite` file; simpler `BJH-{YYYY}-{seq}` numbering; applying anything to hosted Supabase.

## 2026-09-29, Job visibility scope (assumption pending client confirmation)

**What was decided:** Job reads are scoped: super admin sees all jobs, department reps only jobs on their own service lines, customers only their active companies' jobs. Reps may open jobs only for their own line. File-number sequence pads to 4 digits.
**Why:** B3 asks for department scoping by role; the checklist marks rep-own-line as an assumption, and it is the narrowest option consistent with the existing draft-access model.
**What was rejected:** Letting every rep see every job (as they can for customers and quote requests) until Evans/the client confirms; that would be a one-line widening later.

## 2026-09-29, Sea-import milestones derived from client messages; branch pushed

**What was decided:** B5 milestone template for sea import is taken from the client's own description (14 keys in `packages/contracts`), recorded in any order in an append-only `milestone_event` table (corrections are new events). Other service lines have no template and refuse milestones. Work was pushed to branch `chore/foundation-hardening-and-jobs`.
**Why:** Evans said the workflow should come from the client's messages rather than the earlier draft; it also unblocks B5.
**What was rejected:** Enforcing strict step order (real jobs overlap); inventing templates for the other lines; auto-recording a "file registered" milestone (the job's open time already is that).

## 2026-09-29, Department in charge controls reopen/override; admin activity log

**What was decided:** Reopening a closed/cancelled job and overriding closure are done by the rep for the job's service line (super admin also may), with a written reason; not super-admin-only. No evidence gates (D02 evidence questions were removed by Evans). All authenticated API activity, including denied attempts, goes to an append-only activity log readable only by the super admin (bodies/queries never stored).
**Why:** Evans said the person in charge of the department should hold those powers and that the admin must see everything users do.
**What was rejected:** Super-admin-only reopen (the earlier checklist wording); logging request bodies (could hold passwords); a separate "department head" role for now — if several staff share one rep role they all hold these powers, so a distinct head role may be needed later.

## 2026-09-29, Quote structure, business settings, no GRA

**What was decided:** Structured quote versions follow the EVIDENCES samples (currency, lines with basis fixed/per B/L/per container/at cost, optional 20ft/40ft size, minor-unit amounts, notes). Issuer/currency/tax/prefix/terms live in a Settings screen (super admin edits, every change kept as a revision; who edits doesn't matter to the client). BJH invoices do not go through GRA e-VAT (D15 closed). The old free-text draft stays alongside for now rather than being deleted. Evans authorised pushing the branch.
**Why:** Evans answered D1, F1 and F6 and asked for the answers to be recorded in the questions.
**What was rejected:** Hard-coded currencies/taxes (D03); a GRA e-VAT integration; deleting the free-text draft tables without confirmation.

## 2026-09-29, D01, D02 and D05 cancelled; build the full system

**What was decided:** D01 (first-release job types), D02 (workflow sequence/evidence) and D05 (data ownership/retention) are cancelled. The whole system is in scope; workflows come from the client's extracted messages; the company owns its data. Work now proceeds through everything left in `docs/implementation-checklist.md`.
**Why:** Evans said the full system is being built, the sequences are in the client messages, and a customs system's data belongs to the company.
**What was rejected:** Asking the client to phase job types or validate sequences. Kept as safe defaults (not questions): no third-party OCR of real documents without Evans's permission, and no deployment from an agent session. Region and backup targets remain engineering choices at production setup.

## 2026-09-29, ETA is an append-only history; tasks are role-assigned and internal

**What was decided:** The job's ETA is the newest row of an append-only `eta_event` history (each with a source and optional note; a correction is a new row). Tasks (including exceptions: missing documents, damage, delay) are assigned to a staff role with an optional due date, can be completed once, and are visible to staff only, not customers. Tasks and ETA changes are blocked on closed/cancelled jobs until reopened.
**Why:** E3/E4 require corrections that never overwrite history and a "my department's open tasks" list; customers seeing internal exceptions was not asked for.
**What was rejected:** Editing an ETA in place; customer visibility of tasks (can be opened later, one-line change); reopening a completed task (a new task is created instead).

## 2026-09-29, Quote structure follows the EVIDENCES samples; reps issue quotes directly

**What was decided:** (1) A quote version mirrors the two sample quotations: title/subtitle, scope, intro, charge lines grouped in sections (each line: description, basis fixed / per B/L / per container / at cost, optional basis note, and either one amount or a 20ft and a 40ft amount, in minor units), one currency per quote, at-cost note, clearance steps, required documents and note, timeline, terms, and the BJH/client acceptance block. (2) No admin approval: the rep for the quote's service line (or the super admin) issues a version straight to the customer; the super admin sees every quote, draft and action. An issued version is immutable; a change is a new version. (3) Any rep on the quote's service line, or the super admin, records the client's acceptance or rejection against a specific issued version (assumption: "the various reps"); accepting opens the job in the same step, at most one job per quote. (4) The quote number `BJH/Q/{SI|SE|AI|AE}/{YYYY}/{seq}` is allocated when a quote is first issued, not at draft time. The PDF (D5) follows after the Settings screen (F1).
**Why:** Evans answered D1-D5: match the evidence format, reps can send quotes, admin sees everything, various reps handle decisions.
**What was rejected:** The earlier "rep prepares, super admin approves" gate (D2); a single flat amount per line (the samples show 20ft and 40ft columns); allocating numbers to drafts (would leave gaps in numbers customers see). Boilerplate defaults (steps, terms) are not hard-coded; they belong in Settings (F1), and a new version starts as a copy of the previous one.

## 2026-09-29, Quote decisions: one per version, accepting opens the job and locks the quote

**What was decided:** A client decision (accepted/rejected, with the client's named signatory and time) is recorded by staff against the latest issued version, once per version, append-only. Accepting opens the job in the same transaction (`job.quote_id` is unique, so at most one job per quote) and repeating the same decision returns the same job. An accepted quote can gain no new version and issue no draft; a rejection does not lock it (the rep can issue a new version). Migrations `...09` and `...10` were applied to the local database only.
**Why:** D3/D4 answers: various reps handle decisions; accepting opens the job. Locking after acceptance keeps the accepted terms exactly as agreed.
**What was rejected:** Reversing a decision (a mistaken record needs a new quote version or the super admin's help, not an edit); a separate manual "open job" step after acceptance; letting customers accept themselves before the portal (H) exists.

## 2026-09-29, Business settings are revisioned JSON; they drive quote currency, numbering and defaults

**What was decided:** Settings (issuer, currencies + default, tax lines as basis points, payment terms, quote/invoice/receipt prefixes, quote boilerplate) are stored as append-only revisions; the newest is current. Every staff member reads them, only the super admin saves. Once a revision exists, quotes must use a configured currency, the quote number takes the configured prefix, and the quote editor starts from the defaults. Invoice and receipt prefixes and the tax lines are stored now and used by F3/F5; how levies combine on an invoice is decided with F3.
**Why:** Evans's earlier answer (D03/F1) put currencies, taxes, prefixes and terms in Settings, edited by the super admin with every change kept.
**What was rejected:** Hard-coded currencies/terms; a column per setting (jsonb validated by the shared contract is simpler for a single-tenant config); making settings mandatory before any quote (blocking quotes would stall work; invoices are where the requirement bites).

## 2026-09-29, Quote PDF built with pdfkit, generated on demand, marked draft until issued and configured

**What was decided:** Quote PDFs are generated by the API with pdfkit (no browser dependency), laid out like the `/documents-preview` page and the sample quotations (issuer header, metadata grid, charge tables grouped by heading with 20ft/40ft columns, procedure, documents, terms, BJH/client signature blocks). A copy is marked DRAFT unless the version is issued and business settings exist. PDFs are generated on request from the stored version plus the current settings, not stored. No logo yet; text is limited to what the standard PDF font can draw (Latin-1).
**Why:** Evans approved D5; on-demand generation needs no storage work and the issued content itself is immutable.
**What was rejected:** Headless-browser rendering (heavy, harder to deploy on a free tier); storing a PDF copy at issue (revisit with the document archive if BJH needs byte-identical reissues; until then a later download reflects the issuer details current at that time); committing the client's logo file (client material).

## 2026-09-29, Job costing: append-only actuals, rate fixed per entry, evidence optional but flagged

**What was decided:** A job carries charges (service or disbursement) with a currency, quantity and optional quoted unit amount. The actual amount is an append-only history (newest is current; a correction is a new entry). An actual in a different currency must give an exchange rate and the converted amount (integer arithmetic, half up) is stored at that moment. A disbursement's actual may link to a supplier-invoice or disbursement-evidence document on the same job; without one it is flagged, not blocked. "At cost" quote lines import as disbursements; a size-priced line needs a 20ft or 40ft choice; importing twice adds nothing. Costing is staff-only and read-only on closed jobs. Once Settings exist, charges use its currencies.
**Why:** F2 asks for quoted vs actual, evidence links and a per-transaction rate; making evidence mandatory would invent a rule the client has not stated.
**What was rejected:** Editing actuals in place; requiring evidence before an amount can be recorded (a business rule for Evans/BJH to set); customer visibility of internal costs; converting with floating-point numbers; using today's rate at report time (history would shift).

## 2026-09-29, Deliveries: numbered waybill with frozen snapshot, proof recorded once; G3/G4 not built

**What was decided:** Drivers (name, phone) and vehicles (registration) are records any staff member manages; taking one out of service keeps it on past waybills. Dispatching a delivery on a job allocates a waybill number `{waybillPrefix}/{YYYY}/{seq}` (prefix from Settings, default `BJH/WB`) and copies the driver, vehicle and cargo onto it; those fields cannot change afterwards. The proof of delivery (receiver, phone, time, damage notes, optional signed delivery-note document on the same job) is recorded once. Customers read their own company's waybills; only staff dispatch. G3 (container return/EIR) is treated as largely covered by the existing milestones and EIR document type. G4 (closure evidence gate) is not built because it contradicts Evans's decision that no evidence gate blocks closure. G5 (house B/L generation) stays blocked on BJH confirming authority and template (D14); the supplied "transport bill" sample is a BJH-issued house B/L.
**Why:** G1/G2 are next in the plan and unblocked; the waybill number and fields are assumptions because no BJH waybill sample was supplied and the client has not answered question 8.
**What was rejected:** A printable waybill layout (no sample to follow); editing a waybill after dispatch; reversing a recorded proof of delivery (needs a new decision); building G4 against a logged decision.

## 2026-09-30, Levy rule read from the sample invoice; SMS provider shortlist

**What was decided:** (1) Invoice tax lines (F3) are independent percentages of the same charge subtotal, not compounded: the supplied `EVIDENCES/invoice.pdf` shows NHIL 2.5%, GETFL 2.5% and VAT 15% each computed on the 2,397.80 subtotal (VAT 359.67 = 15% of the subtotal, not of subtotal plus levies). That sample is a port operator's invoice to BJH (a supplier invoice), not a BJH invoice, so it is evidence of Ghana practice, not BJH's own layout; rates still come from Settings. Its total is the unrounded levies summed then rounded once (2,877.36), so F3 will round the total once, not sum rounded lines, and show the arithmetic in tests. (2) SMS (H4) is narrowed to Arkesel or a second Ghanaian provider Evans wrote as "Moorle" (assumed to be Moolre; to confirm); the final pick and current official docs are checked when H4 starts, sandbox only. (3) `prov_of_delivery.pdf` (BJH-branded: AWB, consignee, goods, packages, weight, date/time, received-by name, phone, signature) matches the fields already on the delivery proof. No BJH waybill sample exists, so the waybill layout stays an assumption.
**Why:** Evans said the answers are in the evidence files and named the SMS providers.
**What was rejected:** Compounding levies; asking again for facts already in the samples; picking an SMS provider before checking its current docs.

## 2026-09-30, Waybill evidence found; D14 answered by the samples; SMS provider is Moolre

**What was decided:** (1) Corrects the earlier same-day entry, which said no waybill sample exists: `EVIDENCES/HBL - 125-23823984.pdf` is a BJH-issued house air waybill (HAWB `BJH-16545CV` under MAWB `125-23823984`: shipper, forwarding agent, consignee, notify, airports, flight, pieces, gross/chargeable weight, rate, freight/HAWB/origin fee, goods, departure date, issuing-carrier signature, BJH stamp) and `BJH_Air_Cargo_Manifest_125-23823984.pdf` is a BJH-issued manifest listing it. With `Transport_bill.pdf` (BJH-issued house B/L `BJH-TMA0159261A` under MBL/booking `TMA0159261`) they show BJH issues its own house B/L, HAWB and manifest, so D14 is answered by the samples and G5 is unblocked in principle. Still no sample of the road-transport waybill (truck/driver); the delivery waybill layout remains an assumption. (2) Evans gave https://moolre.com/ for the SMS provider named "Moorle": Moolre and Arkesel remain the two candidates; current official docs are checked when H4 starts.
**Why:** Evans pointed to the evidence folder for the waybill.
**What was rejected:** Treating the HAWB/manifest as unrelated to waybills; asking BJH again whether it issues house documents.

## 2026-09-30, Interim waybill PDF modelled on the client's samples

**What was decided:** Build a printable road-delivery waybill now (`GET /api/v1/jobs/:id/deliveries/:deliveryId/pdf`, pdfkit, on demand) while BJH's own waybill sample is awaited. Layout borrows from the samples: the HAWB's header/party-box/cargo-row grid, and the proof-of-delivery sheet's "goods received in apparently safe and sound condition by" block (name, telephone, date and time, signature). Shipper and consignee come from the job's parties, references from the job's shipment references, driver/vehicle/cargo from the frozen delivery snapshot; the receiver block prints blank for signing on the day and fills in once proof is recorded. Same access boundary as the delivery itself (customers only their own company's).
**Why:** Evans asked for something that resonates with the evidence in the meantime.
**What was rejected:** Waiting for the sample; copying the client's logo or any client document verbatim; hard-coding issuer details (they come from Settings, with a visible placeholder if unset). To revisit when BJH's road-waybill sample arrives: layout and numbering `{prefix}/{YYYY}/{seq}` are still assumptions.

## 2026-09-30, G4 closure gate dropped: closing stays open

**What was decided:** No closure evidence gate, and no "documents missing" reminder either. Staff can close a job without required documents; reopening and overriding still need a written reason as already built. G4 is closed as not needed.
**Why:** Evans said "make it open", consistent with his earlier decision that no evidence gate blocks closure (interpreted as the no-gate option; say so if a non-blocking reminder was meant).
**What was rejected:** A blocking gate with override, and the non-blocking reminder.

## 2026-09-30, Invoices and payments: void-and-reissue, tax per line of the same base, payments outlive job closure

**What was decided:** (1) An invoice is a draft until issued; issuing allocates `{invoicePrefix}/{YYYY}/{seq}` and freezes lines, tax lines and totals (Settings must exist and the currency must be one of theirs). An issued invoice is corrected by voiding it (only when no payment stands against it) and issuing a new one; no versions or credit notes yet. A draft can be discarded (voided) without consuming a number. (2) Tax lines come from Settings and are each a percentage of the taxable lines' total (not compounded); the total takes the tax once from the combined rate, so a printed line can differ from the total by one minor unit exactly as on the client's sample invoice. Each line has a `taxable` flag defaulting to yes; charges imported from the job become taxable lines, staff untick what is not taxed (assumption: BJH has not said whether pass-through disbursements are taxed). (3) Payments are received outside the system, append-only, with method, reference, date received and optional evidence document on the same job; a mistake is a reversal with a reason (once); the balance is total minus standing payments; over-payment is refused (API and database, with a row lock so simultaneous payments cannot over-allocate). (4) Payments and reversals are allowed after a job is closed (money arrives late); creating, editing, issuing and voiding invoices need an open job. (5) Customers see only invoices that were actually issued on their own company's jobs, with the balance but not the payment ledger; a draft voided before issue is never shown to them.
**Why:** Evans said to build F3/F4; the levy rule and rounding come from the sample invoice, and the checklist requires no over-allocation and arithmetic in minor units.
**What was rejected:** Invoice versions and credit notes for now (void-and-reissue is simpler and keeps every number auditable; revisit on request); compounding levies; editing payments in place; blocking payments on closed jobs; showing customers the payment ledger (staff-internal until Evans says otherwise); the receipt PDF (F5) in this slice.

## 2026-09-30, No default tax; credit notes not needed

**What was decided:** No tax applies by default: invoices carry tax only from the tax lines the admin configures in Settings (none are hard-coded, and a fresh install has none). The per-line "Taxed" flag only matters once tax lines exist. Credit notes are not built; void-and-reissue covers corrections. This supersedes the earlier same-day assumption that pass-through disbursements are taxed by default.
**Why:** Evans said taxes are configured by the admin when necessary and asked what credit notes would be for.
**What was rejected:** Any built-in tax rate; credit notes.

## 2026-09-30, Receipts, customer accounts and the customer portal

**What was decided:** (1) A receipt is a plain acknowledgement of one payment staff recorded: numbered `{receiptPrefix}/{YYYY}/{seq}` at the moment the payment is recorded, showing amount, date, method, reference, invoice and the invoice balance now, and stating it is not a bank confirmation; a reversed payment keeps its receipt, stamped REVERSED with the reason. Only staff print receipts for now (customers are not shown the payment ledger). (2) The super admin creates a customer account in one step (email, chosen password, one company), like staff accounts, with no invitation email and no staff role; extra companies use the membership endpoints; suspension blocks sign-in and keeps memberships; staff accounts cannot be managed through the customer endpoints. (3) The session endpoint now returns customers (with their linked companies) instead of 403, because the web sign-in calls it and customers could not otherwise sign in; a user with neither a role nor a company still gets 403. (4) A customer sends their own quote request through `POST /api/v1/quote-requests/mine`: the company comes from their linked companies (they must choose when they have several) and the email from the account, both ignoring anything in the body; it is linked to the company at once, unlike staff-entered requests. (5) The web app shows customers a reduced menu (Overview, Jobs, Quotations) and a `/portal` home with the request form; staff-only sections stay hidden.
**Why:** Evans said to continue with the receipt and the rest (H1/H2); checklist F5, H1, H2 and P10 require these behaviours and isolation tests.
**What was rejected:** Letting the customer type a company name or email on their request (spoofable); an invitation flow for customers; showing customers the payment ledger or receipts until asked; a separate customer web app (the same app with a reduced menu is simpler).

## 2026-09-30, Correspondence log, warehousing and road transport as shared service lines

**What was decided:** (1) The correspondence log is a per-job, append-only, staff-only record of emails, WhatsApp messages, calls and letters (nothing is sent), with an optional attachment taken from the job's own documents; it stays open on closed jobs; staff can find a job by its logged text, customers can never see or search it. (2) Warehousing (`BJH/WH/...`) and road transport (`BJH/RT/...`) are two more service lines, worked by any department rep (no separate role, per the earlier decision), visible to customers only for their own company; they have no milestone list. (3) Warehouse stock is a simple goods-in/goods-out ledger per job, location, item and unit: append-only, correction by an opposite movement, balance never below zero at any date (checked with a running total so backdated entries are covered), released only against stock held; a dated stock report per customer; storage is billed with ordinary invoice lines; not a full inventory system. (4) A standalone road job reuses drivers, vehicles, the numbered waybill, proof of delivery, charges, quotes and invoices already built.
**Why:** Evans said to continue with the rest of the plan (H5, I4, I5); the workflows in `docs/workflows.md` and the client's messages ask for these; the light-scope and no-separate-role decisions were his.
**What was rejected:** A separate warehouse or road role; a stock adjustment movement type (a correction is visible as an opposite movement); milestone templates invented for these lines; letting customers see internal correspondence; a full stock valuation or inventory module.

## 2026-09-30, All customer messages go through one outbox, by email and/or SMS, chosen in Settings

**What was decided:** (1) Every message to a customer (milestones, expected arrival and a 24-hour reminder, quotation issued, invoice issued, payment received, delivery dispatched and delivered, and messages staff type) goes through one outbox to the company's contacts by the channel the super admin chooses in Business settings: email only, SMS only, or both (default both). (2) Each SMS and email ends with a link to the customer's page (`PUBLIC_WEB_URL` + job or quotation path); opening it signed out goes to sign-in and back to the same page. (3) Contacts carry an optional phone and an on/off switch; a contact without a phone gets a visible "not sent" SMS row, and nobody is messaged who has been switched off. (4) Email is plain SMTP; SMS is Arkesel (Moolre not built: its API docs could not be read). Without credentials both are recording stubs that send nothing. (5) Sending is a database outbox plus a dispatcher inside the API (no Redis): deliveries are claimed with row locks, retried up to 5 times with growing delays, and left as failed for a super admin to retry; a dedupe key means an event is never sent twice; a milestone correction is not announced again; a staff message is also written to the correspondence log. (6) Ghana times in messages are stated as Ghana time (GMT, no daylight saving).
**Why:** Evans said all messages should go through SMS and email, with links like the tracker or client URL, configurable by the super admin as one or both.
**What was rejected:** Per-event channel settings (one choice for everything, as asked); public unauthenticated tracking links (links need sign-in, so a forwarded SMS does not expose a shipment); consent screens or per-message opt-ins (a contact is either on or off, decided by BJH); BullMQ/Redis for now; sending real messages from tests or from this session.

## 2026-09-30, Text-layer extraction proposes references as a draft; a person applies them

**What was decided:** A staff member can have the server read the text layer of a PDF on a job (pdfjs, nothing sent to a third party) and receive a DRAFT of proposed shipment references (master/house B/L and AWB numbers, booking numbers, containers with seals; containers only when the ISO 6346 check digit is valid, to avoid proposing random strings). The draft never changes the job. The reviewer ticks fields, may correct values and seals, and approves; approval applies them through the same validation as adding a reference by hand (masters first, house documents linked to the job's single master, duplicates and service-line rules reported per field). The proposed fields are kept exactly as read; only the review status changes, once. Scanned PDFs and images are not read (no OCR); parties and other fields are not extracted.
**Why:** Evans's plan lists extraction with human review before anything enters the job; the client's samples (B/L, HAWB) have text layers; keeping it local and reference-only makes it accurate and safe.
**What was rejected:** OCR or any third-party reading of real documents (needs Evans's permission and a trial on redacted samples, I2); applying extracted values automatically; guessing shipper/consignee from layout (too unreliable); allowing the draft's proposed fields to be edited in place (corrections are made when approving, so the original reading stays visible).

## 2026-09-30, House B/L, house air waybill and manifest are generated from the job, numbered by staff

**What was decided:** BJH's own house B/L (sea jobs), house air waybill and air manifest (air jobs) are prepared on the job as drafts, prefilled from its parties, references, containers/seals and the issuer settings, completed by staff, given a document number typed by staff, and issued. Issued documents are frozen; a mistake is corrected by voiding (which frees the number) and issuing a new one. The number must be unique among issued documents of the same kind. Customers can download issued documents of their own company's jobs; drafts are staff-only. The fields and layout follow BJH's three sample documents; values are free text.
**Why:** D14 was answered by the evidence (BJH issues these itself), and Evans said to keep building; the samples show no single numbering pattern, so a rule is not invented.
**What was rejected:** Auto-generating document numbers (no rule known); structured or validated cargo fields (BJH's samples are free text); editing an issued document; letting customers see drafts; a printed layout copied pixel for pixel or the client's logo.

## 2026-09-30, Receivables view; customers can accept or decline quotations in the portal

**What was decided:** (1) `GET /api/v1/invoices/outstanding` lists every issued invoice with a balance, oldest due date first, with days overdue and totals per currency (and how much of it is overdue); staff see their service lines, a customer only their own company's, and a customer cannot widen it with a company filter. Web: Receivables for staff, Your invoices for customers. (2) A customer can accept or decline the latest issued version of their own company's quotation in the portal (`POST /api/v1/quotes/:id/respond`): it is the same recorded decision as staff enter, made by the customer's account with their typed name, stamped with the moment it happens (no backdating), and accepting opens the job (attributed to the customer's account). Staff keep the existing decision endpoint and are refused on the customer one.
**Why:** Evans said to keep building; the earlier decision to keep customers from accepting "before the portal exists" is superseded now that the portal does, and D12 records the actor and time, not who the actor is.
**What was rejected:** Letting a customer choose the decision time; a separate "pending customer approval" step; per-customer receivables settings such as credit limits or reminders (not asked).

## 2026-09-30, Live operations overview

**What was decided:** Replace the staff home page's static action tiles and workflow strip with an operations dashboard showing only live, API-scoped counts and records: active jobs, open/overdue tasks, unpaid invoices, job status distribution, recent jobs, and receivables grouped by currency. Keep customers on their separate portal and retain empty/loading/error states.
**Why:** Evans asked for an overview with real dashboard details, visual cards and KPIs instead of redundant buttons; the existing access-scoped APIs already provide these records without invented business rules.
**What was rejected:** Fake/sample KPIs, mixing amounts across currencies, a second access path or an aggregate API for this dashboard slice.

## 2026-10-01, Quote-specific container-size pricing

**What was decided:** The sample quotation's 20ft/40ft columns are examples, not fixed choices. Each quote version defines its own container-size labels and prices, can include multiple different sizes, and retains a single-price option for charges that do not vary by size. Quote display and PDF output use the version's labels; job-cost import selects a quote size and container count, and allows a separate idempotent import for each size.
**Why:** Evans clarified that quotations may cover different containers and mixed sizes; one evidence file cannot define a universal pair of size columns.
**What was rejected:** Hard-coding the 20ft/40ft pair or recording an unmodeled size only in shipment free text.

## 2026-09-30, Readable type scale, Inter font and icon navigation

**What was decided:** Raise the root font size to 18px (every `rem` in the web app scales with it) and set a 0.75rem (13.5px) floor on every stylesheet font-size that was smaller. Load Inter through `next/font/google` (self-hosted at build) in place of Arial. Replace the text-glyph sidebar icons with inline SVG icons (`NavIcon.tsx`), define the sidebar items once as data, and enlarge nav links (50px), top bar (72px) and sign-in controls (52px).
**Why:** Evans said the fonts look too small and the platform should feel like a top logistics company's and be easy for non-technical staff; body text was 11-12px and labels about 10px.
**What was rejected:** Rewriting each page's CSS one by one (the root-size change cascades to every screen); a new icon dependency (inline SVG is enough); `next build` while the dev server owns `.next`. `next/font/google` needs network at build time; swap to a local font file if builds must run offline.

## 2026-09-30, Sidebar is one flat blue; no multi-colour

**What was decided:** The sidebar is a single flat BJH blue (`#0B3FAE`) with white text, white icons and white translucent hover/active states; no gradients, no light-blue accent, no green status dot. Evans said never to use multi-coloured styling.
**Why:** Evans asked for one colour, blue.
**What was rejected:** The gradient background, the two-tone logo mark, and the light-blue active bar from the earlier restyle. Not yet changed: the overview's metric icons (blue/teal/amber/green) and status colours in the main area; to be decided with Evans.

## 2026-09-30, Job page split into tabbed sub-pages; Google-style buttons

**What was decided:** The single long job page is now a shared shell (`JobShell.tsx`: loads the job once, header, tab bar, `useJob()` context) with seven routes: Overview (`/jobs/:id`: status, milestones, ETA, status history), `/shipment` (parties, references, reading data from documents), `/documents` (uploads, house B/L / air waybill / manifest), `/delivery` (waybills, proof, warehouse stock), `/money` (costs and invoices; customers see "Invoices"), `/tasks` and `/messages` (staff only). `JobDetail.tsx` was removed; its code moved unchanged into the tab pages. Buttons are now pill-shaped, 40px tall, sized to their label (the old forms stretched them to full width because grid children fill the column); secondary buttons are outlined blue. Milestone "done" colour changed from green to blue.
**Why:** Evans said too many activities sit on one page, buttons were too wide, and it should feel like Google's UX.
**What was rejected:** Keeping one page with collapsible sections; `?tab=` query tabs (real routes give back-button, bookmarks and deep links); refetching per tab (the shell loads once, so switching tabs is instant); a full-bleed button redesign of each section (the shared stylesheet change applies everywhere). Error text is still red; status pills elsewhere were not changed.

## 2026-09-30, Jobs page is a status kanban board (list kept as a toggle)

**What was decided:** `/jobs` now opens as a board with one column per job status (Open, In progress, On hold, Ready to close, Closed, Cancelled). Staff drag a card to a column, or use the card's "Move to…" menu (touch/keyboard); only legal moves are accepted, using `jobStatusTransitions` and `jobStatusReasonRequired` from `@bjh/contracts`, so the board matches the API. Moves needing a reason (cancel, reopen, force-close) open a dialog; the move is optimistic and reverts with the API's message if refused. Customers see the board read-only. The table stays as a "List" view. Single blue palette.
**Why:** Evans asked for a kanban pipeline that makes moving a job between stages easy.
**What was rejected:** Columns per milestone (only sea import has a milestone template, so it would not cover other service lines; milestones stay on the job's Overview); a new status model or extra stages (would need an API/contract change); drag-only moving (not usable on touch or keyboard); one colour per column (breaks the one-blue rule).

## 2026-09-30, The overview is the single picture of the whole system

**What was decided:** The staff overview now covers every module from the existing scoped APIs (no new aggregate endpoint, no invented numbers): a "Needs attention" strip (overdue tasks/invoices, requests waiting for a quote, draft quotes, jobs on hold, jobs ready to close), seven clickable cards (active jobs, customer requests, quotes, unpaid invoices, open tasks, customers, goods in store), the six-stage job pipeline linking to the board, balances by currency, latest customer requests, recent jobs and tasks due. Each source loads independently (`Promise` results settled separately), so a role that cannot read one source still sees the rest, with a plain "not available to your account" note. Everything is one blue: overdue is shown by the word "Overdue" and bold type, not red.
**Why:** Evans asked for the dashboard to be the one source of truth for the system overview.
**What was rejected:** An aggregate dashboard API (a second access path to keep scoped); a single all-or-nothing load (one 403 would blank the page); per-status colours and red/amber/green metric tones (conflict with the one-blue rule); showing customers this page (they keep the portal).

## 2026-09-30, Expand customer records into company profiles

**What was decided:** Replace the contact-only customer intake with an editable company profile for legal/trading names, registration/tax identifiers, company contact information, business/billing addresses, and multiple named contacts with responsibilities and a primary marker. Extend directory search across captured profile/contact details. Keep shipment-specific parties on jobs; profile details follow the confirmed company access model and are visible to that company's users.
**Why:** Evans clarified that BJH needs client profiles where staff can capture the client's information, and the supplied shipping evidence uses company identity, addresses, tax identifiers and several named parties/contacts.
**What was rejected:** Treating the four-field quick-create form as a complete client record, copying shipment-specific parties into permanent company fields, or adding staff-private notes/client files without a visibility rule.

## 2026-09-30, Sidebar follows the workflow; Messages is the client-communication hub

**What was decided:** (1) The staff sidebar is grouped by how work flows: Overview; SALES (Customers, Requests, Quotes); OPERATIONS (Jobs, Tasks, Warehouse); FINANCE (Invoices); CLIENTS (Messages); Settings. "Quotations" is renamed "Requests" (URL `/quotations` kept) because it is the inbox of incoming customer requests, while "Quotes" are the structured quotes. Drivers and vehicles moved from the sidebar into Settings (card linking to `/transport`). The old free-text quote draft is NOT yet retired: removing it deletes tables/screens and needs Evans's explicit yes. (2) New staff-only `/messages` with tabs Sent, Write a message, Send a quote, backed by `GET/POST /api/v1/messages` and `POST /api/v1/quotes/:id/send`, all through the existing notification outbox (so the super admin's email/SMS choice, opted-out contacts, retries and dedupe still apply). Evans chose: any staff member may write to one, several or all client companies (I had recommended super-admin-only for broadcasts); recipients are chosen companies or every company, with the people and company count shown and a confirmation before sending; an issued quote can be sent again. (3) Assumptions: a rep sees messages about jobs on their own service lines plus messages not tied to a job (quotes, broadcasts); a company with no contact left to notify is reported as skipped, not silently dropped; broadcasts link clients to `/portal`; each resend of a quote is a deliberate new message (event `quote_sent`), the automatic one at issue stays (`quote_issued`).
**Why:** Evans said the menu order did not follow the work, communication was buried inside jobs, and communication is mostly with clients: broadcasts, sending quotes and the rest.
**What was rejected:** A second sending path (everything reuses the outbox); showing customers this page (they keep the portal); a per-rep restriction on broadcasts (Evans's choice); deleting the old free-text draft without confirmation; real sending from tests or this session (tests use recording stubs).

## 2026-09-30, Free-text quote draft retired; requests link to real quotes

**What was decided:** The first-generation free-text quote draft is removed: the `quote_draft` / `quote_draft_revision` tables (local migration `20260930000009`, applied to the local database only; 0 rows), the `/quote-requests/:id/draft` endpoints, the `QuoteDraftReadGuard`/`QuoteDraftWriteGuard`, the draft contract and the draft box. A customer request now shows the real quote prepared for it (newest `app.quote` with that `quote_request_id`: none, draft, or issued), and the request page offers "Create a quote from this request", which opens the new-quote form with the client locked and sends `quoteRequestId`. Department assignment on a request is kept as a plain assigned-department label. No new column was needed: `app.quote.quote_request_id` and its same-company check already existed.
**Why:** Evans said to retire it, and chose to replace it with a link to a real quote. The draft duplicated Quotes, could not be issued or accepted, and made the "Quote drafted" signal mean the wrong thing.
**What was rejected:** Just deleting it (would lose any "has a quote" signal on requests); keeping it alongside; a unique one-quote-per-request rule (not asked: the newest quote is shown); removing department assignment (only its draft gating lost its purpose; removing the label was not asked for). Not applied to any hosted database.

## 2026-09-30, pgTAP transport-documents test scoped to its own row

**What was decided:** `supabase/tests/transport_documents_test.sql` now limits its two `UPDATE ... SET status = 'issued'` statements to the synthetic document (`WHERE document_id = ...`). They were unscoped, so against the persistent local database they also touched the demo house documents and the immutability trigger rejected the update, failing the test ("an issued document is immutable" instead of the expected check error). Product code and the migration were correct and are unchanged.
**Why:** Same rule as the 2026-09-28 pgTAP fixture-isolation entries: tests run against a persistent local database without resetting it, so they may only touch their own synthetic rows.
**What was rejected:** Resetting the local database or deleting the demo documents to make the test pass; loosening the trigger.

## 2026-09-30, Department assignment on requests retired; overview simplified with donut charts

**What was decided:** (1) The department assignment on quote requests is removed (local migration `20260930000010`, 0 rows; endpoints, database methods, contract and the request-page dropdown): it only gated the retired free-text draft and was now a label nothing read. Evans said to go with the recommendation. (2) The overview is cut down to the most important things: the "Needs attention" chips, three KPI cards (active jobs, unpaid invoices, open tasks), two donut charts (jobs by stage; invoices overdue vs not yet due, with outstanding amounts per currency listed below so currencies are never mixed in one figure) and two short lists (latest jobs, tasks coming due). Removed from the page: customers, goods-in-store, quotes and customer-requests cards, the pipeline strip and the customer-requests panel (waiting requests still appear as an attention chip). Charts use blues from dark to light only, with a legend that shows the counts so nothing depends on colour.
**Why:** Evans said the dashboard looked too busy with too many KPI cards and asked for donuts and charts and only the top, most important details.
**What was rejected:** Keeping seven KPI cards; charting money across currencies in one donut (would mix currencies: the donut counts invoices and the amounts stay per currency); a multi-colour palette (conflicts with the one-blue rule); a bar chart per service line (more to read, not asked for); keeping the assignment as a label or building routing on it.

## 2026-09-30, Job overview leads with open work and keeps history compact

**What was decided:** On opening a job, show staff the job's open tasks first, put milestone recording and ETA near the top, and collapse the long milestone/status histories and status-change controls. Do not imply a prescribed "next milestone" because milestone events may be recorded in any order. Jobs without a milestone template point staff to delivery and warehouse records.
**Why:** Evans asked to go straight to what needs doing instead of leading with a long milestone list; the overview should surface existing role-assigned open work while preserving access to the full history.
**What was rejected:** Picking the first unrecorded milestone as the next action (the workflow permits any order); removing milestone/status history; adding another job state or workflow rule.

## 2026-09-30, Less text on every page; one clear button standard

**What was decided:** Every page follows one rule: a title, the real data and the actions. Removed everywhere: the small uppercase labels above titles ("STAFF WORKSPACE · LOCAL ENGINE" and similar), the descriptive sentence under titles, the "LOCAL DEVELOPMENT / LOCAL RECORD" badges, the local-development notice banners, the amber "not priced" banner, and the explanatory sentences under sections (costs, correspondence, deliveries, extractions, invoices, messages, house documents, settings, sign-in). Kept on purpose: real data lines, errors, one-line empty states, permission messages, the "Not connected: nothing is really sent" warning on the message log, and confirmation text before sending or deciding. The request page now has its main action ("Create quote" / "Open quote") as a button in the header, and the separate Quote panel and the two small labels are gone. The Settings hub is icon, name and one button per card, using the sidebar's icon set. All buttons now follow one standard: fully rounded, about 46px tall, 16px text; solid blue for the main action, outlined blue for secondary (applied to the jobs, quotations, customers, admin, sign-out and settings styles).
**Why:** Evans said pages had too much text, systems are not built like this, and buttons should show well without crowding.
**What was rejected:** Hiding the text behind tooltips or collapsible help (still clutter to maintain); keeping helper sentences "just in case"; removing confirmation text before irreversible sends; red/green button colours (one-blue rule).

## 2026-09-30, Job Overview follows the work in order: stage, shipment steps, ETA, tasks

**What was decided:** The job Overview reads top to bottom in the order of the work. (1) Stage: a four-step bar (Open, In progress, Ready to close, Closed) with one main button for the natural next move (Start work, Mark ready to close, Close job; Resume work or Reopen job from on-hold, closed or cancelled); on hold, cancel and the other allowed moves are under "More"; a reason dialog appears only where the existing rule requires one (`jobStatusReasonRequired`). This is the same status the Jobs board moves. (2) Shipment progress: the client's steps (the milestone template) as an ordered checklist with "n of N", the first undone step highlighted, and a "Mark done" / "Correct" button per step that opens a small form (optional time and note) saying the customer is messaged; it replaces the 14-item "Record an update" dropdown. Steps stay recordable in any order and corrections stay new events. (3) ETA shows the current value, with the form behind "Set/Change ETA". (4) Tasks (up to three open, one button). (5) History collapsed (updates and stage changes). A job line with no milestone template shows no steps section. This replaced the earlier same-day layout by another session ("Next action", "Record an update", "Job progress", "Change job status"), keeping its task list and collapsed history.
**Why:** Evans said the job page should be easy and follow in order, that the update dropdown was too long, and asked whether it was the same as the pipeline. It is not: stages are the job's status (the board columns); steps are the shipment milestones that message the customer.
**What was rejected:** One click that records a step immediately (it messages the customer, so an accidental tap would notify them; a short confirm form is safer); forcing steps to be done strictly in order (real jobs overlap, earlier decision); merging stages and steps into one list (different meanings and different owners of the data).

## 2026-09-30, Guide Evans through the working product end to end

**What was decided:** The goal is a guided, hands-on walkthrough of the existing local application, following actual workflows from customer profile through requests, quotations, jobs, operations, documents, customer communication, billing, payment, closure and retrieval. Start with a customer profile and continue one confirmed step at a time. The available `adress.md` details identify BJH Logistics itself and belong in Business Settings, not a customer profile; customer company/contact details must come from Evans or an explicitly chosen synthetic demo record.
**Why:** Evans clarified that he wants to use the implemented functionality step by step, carrying records forward through the full process, rather than receive a coding roadmap.
**What was rejected:** Treating the request as new feature implementation or mis-entering BJH's issuer details as a customer.

## 2026-09-30, Customer profiles do not need registration or tax identifiers

**What was decided:** Do not ask for or rely on company registration numbers or Tax/TIN numbers when guiding customer-profile creation. The current app fields are optional; leave them blank in the walkthrough.
**Why:** Evans clarified these details are not needed for the customer workflow.
**What was rejected:** Carrying forward the earlier product-spec assumption that customer profiles should collect registration and tax identifiers.

## 2026-09-30, Prepare-quote form follows the BJH sample quotation

**What was decided:** The quote editor is reorganised to read like the sample in `EVIDENCES/` (Sea Freight Clearance Quotation): Prepared for / Service, then title, subtitle, shipment and currency, then one Charges list laid out as Charge, 20ft, 40ft, Basis (with an optional note beside the basis, as in "Based on HS code and CIF value"). Pricing by 20ft/40ft is now one switch for the whole quote (on by default) instead of a tick per charge; a single-price charge loaded into that mode fills both sizes (as the sample's Documentation line does). Headings to group charges are an opt-in tick. Introduction, at-cost note, procedure, documents, delivery time and terms moved into a closed "Standard wording (from Settings)" section. No API, contract or database change.
**Why:** Evans said the inputs were hard to understand and asked for them to be easier and to follow the sample.
**What was rejected:** Changing the stored quote shape (not needed); keeping the per-charge "priced by container size" tick and the eight stacked fields per charge; removing the standard wording fields (still editable per quote).

## 2026-09-30, Currencies are chosen from a short popular list in Settings

**What was decided:** Settings > Currencies shows tick boxes for USD, GHS, EUR, GBP, CNY, AED, NGN, ZAR (plus any other code already saved) and a default-currency dropdown limited to the ticked ones. The quote form keeps its dropdown of the ticked currencies. No API change.
**Why:** Evans asked for dropdowns of a few popular currencies instead of typing codes. The API only accepts currencies configured in Settings, so the picker belongs there.
**What was rejected:** Offering every currency; a quote-level dropdown of popular currencies the API would reject.

## 2026-10-01, Every charge row has the same boxes; no extra units

**What was decided:** On the quote form, when pricing by container size, every charge row shows the same boxes (Charge, one box per container size, Basis, Remove); the per-charge "Price by size" tick is removed, so a charge with one price for all sizes fills each size box (as the sample's Documentation $120 / $120). A charge saved with a single price loads into every size box; a quote saved without sizes starts from 20ft/40ft if sizing is switched on. Container sizes stay editable per quote. Currency is always a dropdown: the currencies ticked in Settings, or, while Settings has none saved, the same popular list Settings offers (USD, GHS, EUR, GBP, CNY, AED, NGN, ZAR); the API accepts any currency until Settings exist. Procedure steps, documents and terms in Standard wording are now lists with add/remove per entry instead of "one per line" text boxes. No API, contract or database change.
**Why:** Evans asked for the charge inputs to be the same, the currency to be a dropdown and the standard wording to be easier to fill, following the sample quotations in `EVIDENCES/`. After reviewing the samples together, Evans said extra units are not needed: Fixed, Per bill of lading, Per container and At cost (with an optional note, e.g. "Based on HS code and CIF value") cover them.
**What was rejected:** Adding units such as per trip, per kg, per CBM or per day (Evans: not necessary; would also need a migration and job-charge quantity rules); a free-text currency box; keeping the per-charge tick (rows looked different).

## 2026-10-01, Quote page shows status, main buttons and the current version only

**What was decided:** The quote page (`/quotes/[id]`) now has its title, customer · service, a status badge (Draft / Issued · waiting for the client's answer / Accepted or Rejected by name · date), and the buttons for the current state in the header: PDF, Edit + Issue to customer (draft), New version + Record decision (issued, no answer yet), New version as the main button after a rejection, Open job after acceptance. The staff decision form stays hidden until "Record decision" is clicked and is laid out in one compact row with Save/Cancel. Only the current version (the draft, or the latest issued) is shown; its standard wording (procedure, documents, timeline, terms) is folded under "Standard wording". Decisions and earlier versions are under a collapsed "History". The separate "Actions" card, the "This quote was accepted" line and the "prepared" date line are gone. The customer's answer form is unchanged (still shown openly with its confirmation text). No API, contract or database change.
**Why:** Evans said the issued-quote page looked busy and asked for it to be simple and easy to navigate. Same pattern as the job page (main action up top, history collapsed).
**What was rejected:** Showing every version in full on the page; a modal dialog for the decision (an inline form that opens on click is simpler and matches the job ETA form).

## 2026-10-01, Job Overview leads with one "Next step"; stage folded away (revises 2026-09-30)

**What was decided:** The job Overview now opens with one "Next step" card: the first undone shipment step in large text, the "n of N" progress bar and a single Mark done button (same short confirm form, "The customer is messaged."). The full step list is folded under "All N steps" (Correct / Mark done per step, so steps can still be recorded in any order). The stage bar and its buttons moved below ETA and Tasks, folded under "Stage: <current>"; the header badge still shows the stage, and the Jobs board still moves it. Order: Next step, ETA, Tasks, Stage, History. No API, contract or database change. This revises the 2026-09-30 "Job Overview follows the work in order" entry, which put the stage bar first and showed all steps openly.
**Why:** Evans said the job page was confusing with too many details, asked whether a kanban board would be easier, and chose the "one next step" layout when shown the options. The confusion came from two progress trackers (stage and 14 steps) at the top.
**What was rejected:** A kanban board of one job's steps (14 columns, or To do / Done, both harder to read than a list; the Jobs board is already a kanban of jobs by stage); keeping the layout with only the list shortened.

## 2026-10-01, Shipment details show saved items; add forms open on request

**What was decided:** On the job's Shipment details tab, Parties and Shipment references show what is saved as a clean list (small role/type label, the name or number in bold, details or seal below, a small "Remove" text link). The add form is hidden behind an "Add party" / "Add reference" button in the card header and closes on Save or Cancel. No API, contract or database change.
**Why:** Evans said that after entering the shipment details the empty form still showed, so it looked like details were still missing: a bad user experience.
**What was rejected:** Keeping the always-open form under the saved items; showing the form automatically when nothing is saved yet (the "No parties recorded." line and the Add button already make the next action clear, and one pattern is simpler).

## 2026-10-01, One pattern across the app: saved items first, forms on request

**What was decided:** Every list page that had an always-open add form now follows the Shipment details pattern: a card header with the title and one outlined "Add …" button, saved items as a clean list (small label, bold main value, muted detail line, small text-link actions like Remove / Download / PDF / Void), and the form only after the button is clicked, with Save and Cancel, closing itself after saving. Applied to the job tabs (Tasks, Correspondence, Stock, Costs: Add charge and Copy from quote, Delivery: Dispatch a delivery and the proof-of-delivery form, Documents: Upload, with earlier versions folded, House documents, Invoices: New invoice, with payments folded per invoice, Messages: Send a message), Warehouse locations, Drivers and vehicles, Staff management and Customer accounts (New account button; NEW … / ACCOUNT DIRECTORY eyebrows and the "Supabase Auth" tag removed). The always-visible "Reason for a void / discard / reversal" boxes on invoices and house documents are gone: Void, Discard draft and Reverse now ask for the reason in a prompt when clicked (same as the task "Mark done" note), and cancelling or leaving it empty does nothing. Not changed: sign-in, create pages, compose, quote editor and settings forms (the form is the page's purpose). No API, contract or database change.
**Why:** Evans asked to make the whole platform easy to use with the best UX, after approving this pattern on Shipment details.
**What was rejected:** A shared React "AddPanel" component (each page's form differs; a few lines per page matched the surrounding code better); keeping the shared reason box (it read like a required field and made every Void button say "uses the reason below"); a modal dialog for reasons (prompt already used for task notes, simpler).

## 2026-10-03, One visible job progress view

**What was decided:** The Jobs status board remains the visual view of each job's overall state. On a job's Overview, shipment milestones are presented as the next update to record, with the full update list folded away; the separate milestone count/progress bar and duplicate job-stage diagram are removed. The job status control remains folded under "Job status". This revises the 2026-10-01 Overview presentation while keeping job status and shipment milestone records separate.
**Why:** Evans found the board pipeline and Overview progress confusing as two kinds of tracking. One visual status view plus one concrete update action makes their roles clearer without changing business events or notification behavior.
**What was rejected:** Merging status and milestone data into one workflow (milestones can occur out of order and only some service lines have templates); removing the milestone update action or job status controls.

## 2026-10-03, Jobs open as a table; shipment updates leave Overview

**What was decided:** Jobs now opens in List view, with the Status board available as the second view. Shipment milestone recording and its history move from job Overview to Shipment details. Overview shows ETA, staff tasks, the folded job-status control and job-status history. This revises the same-day decision to place the next shipment update on Overview.
**Why:** Evans chose the jobs table as the easier starting point for finding a file and said the remaining tracking on job Overview was still confusing. Keeping each kind of information on its relevant page gives Overview one clear purpose.
**What was rejected:** Removing shipment milestones or their history; replacing the job-status board with a milestone board (only some service lines have milestone templates); changing the status or notification rules.

## 2026-10-03, Shipment activity is a dated timeline

**What was decided:** Shipment details now shows a single "Shipment timeline" of recorded events, newest first, with "Record update" opening a form where staff choose an unrecorded service-line update, time and note. A recorded entry has a "Correct" action that appends a linked correction; the separate all-steps checklist and duplicate history panel are removed. Milestone customer links open the Shipment details route. Job status remains a separate summary on the Jobs table and optional Status board.
**Why:** Evans found the two trackers and their naming confusing and asked for the simpler timeline approach. Updates can be recorded out of order, so a dated event log describes them more accurately than a second progress board.
**What was rejected:** A Kanban for one shipment's milestones, automatic movement of job status when recording an update, and removing correction history.

## 2026-10-03, One detailed job progress area with finance-backed steps

**What was decided:** Job Overview shows the overall job status and every service-line shipment step in one progress area, with status and update histories folded beneath it. Shipment details keeps parties and references. Issued invoices and standing external payment records supply the corresponding finance steps in the read-only timeline; staff open Costs & invoices from those rows instead of recording a second manual update. Other shipment steps remain manual and can be recorded out of order. This revises the earlier same-day choice to keep shipment progress only on Shipment details, following Evans's request for one fuller tracker.
**Why:** The client needs a traceable file workflow, while Evans found separate trackers confusing and the simplified dated timeline too sparse. Reading finance records avoids asking staff to enter the same invoice or payment twice, and omitting voided invoices or reversed payments keeps the current view truthful.
**What was rejected:** A second progress widget on Shipment details, treating a partial payment as full settlement, and automatically marking customs or delivery steps without an authoritative record of those exact events. Job status remains a separate auditable field within the same progress view.

## 2026-10-03, Job actual costs recorded in GHS without exchange conversion

**What was decided:** Staff record every new actual charge amount in GHS. The recording form has one GHS amount field and no rate or currency selector; the separate quoted charge currency is chosen from a dropdown and may still be USD. When quoted and actual currencies differ, the actual retains GHS, the UI does not show a cross-currency difference, and invoice-from-charges uses the quoted amount if available. A forward migration permits a null converted amount for new cross-currency actuals while preserving older immutable converted entries.
**Why:** Evans said staff do the currency calculation themselves and enter the GHS amount, and specifically asked to take USD out of actual-amount recording. The prior exchange-rate input was confusing and silently affected totals and invoice drafts.
**What was rejected:** An automatic exchange rate, assigning a GHS amount to a USD total, deleting historical converted records, and requiring the job's quoted currency to be GHS.

## 2026-10-04, Currency is chosen explicitly at each step (USD, GHS, EUR all in regular use)

**What was decided:** The client uses USD, GHS and EUR often, so currency is picked per document with no default. There is no per-customer default currency. Each document keeps one currency end to end (quote, invoice, payments); a job needing several currencies gets one invoice per currency. Totals are always shown per currency and never summed. The app does no exchange-rate handling. The invoice form's currency is now a required dropdown (Settings currencies, or the popular list before Settings exist) with no preselected value, replacing a free-text box that opened on the Settings default.
**Why:** Evans said a per-customer default would break when a customer switches currency, and wants the currency selectable at each step. A preselected default invites a wrong-currency invoice when all three are routine.
**What was rejected:** A per-customer preferred currency; automatic conversion between currencies; one mixed-currency invoice. Superseded the same day (Evans: no default, no section should have a default currency): the Settings "default currency" field is removed from the contract, API and form (old stored revisions simply drop it), and the quote editor, invoice form and charge form all open on "Choose a currency". Actual amounts stay GHS by the 2026-10-03 rule. Evans said to leave cedi tax/levy display out for now.
**Open questions for the client:** whether cedi tax/levies must be shown on USD/EUR invoices (and the rate source); whether a USD/EUR quote is compared with GHS costs (margin); whether customers pay in a different currency from the invoice.

## 2026-10-04, Collapsible narrow sidebar; compact overview; clearer donut within one blue

**What was decided:** The sidebar is narrower (232px, was 280px) and collapses to a 68px icon rail with a menu button at its top; the choice is remembered in the browser (`bjh.sidebar.collapsed`). Phones keep the existing top bar. The overview is compacted (smaller title, attention chips, KPI cards, 150px donuts, tighter lists). Donut segments keep the one-blue palette but with a wider dark-to-light range and a thin gap between arcs.
**Why:** Evans said the sidebar took too much space and should hide and open, the two chart cards filled the whole screen, and the donut colours looked almost the same.
**What was rejected:** Adding other hues to the donut (conflicts with the 2026-09-30 one-blue rule; flagged to Evans rather than changed); hiding the sidebar completely with no rail (harder to find again).

## 2026-10-04, Chart colours may use status colours (supersedes one-blue for the overview donuts)

**What was decided:** The overview donuts use distinct status colours: jobs by stage blue (open), yellow (in progress), orange (on hold), green (ready to close), grey (closed), red (cancelled); invoices red (overdue) and green (not yet due). Donuts are smaller (116px) with a tighter legend and card padding. The one-blue rule still applies to the sidebar and other chrome.
**Why:** Evans said the blues all looked the same and asked for red, yellow, green and the rest, and for the two cards to be smaller and simpler.
**What was rejected:** Further blue-only shade tweaks (already tried, still indistinguishable on his screen).

## 2026-10-04, WhatsApp on hold, carrier tracking dropped, no email pulling; document library built

**What was decided:** (1) WhatsApp stays on hold (D13 remains post-launch; email, SMS and the manual correspondence log continue). (2) Automatic carrier/airline tracking (I3) is dropped: it cannot be done now, so ETAs stay staff-entered. (3) The system will not pull emails from mailboxes. (4) Instead BJH gets a document library (`/documents`, `GET/POST /api/v1/documents`, `GET /api/v1/documents/:id/download`) where staff store documents and everyone searches them in one box: every word typed must match the title, file name (any version), document type, job file number, customer company, B/L/AWB/booking/container/seal references or party names of the job, or the upload date. A document may stand alone (office letters), belong to a job, or belong to one customer company (migration `20261004000000`, applied to the local database only; `document.job_id` is now nullable, with `company_id` and `title`, and a document cannot name both). Visibility (assumption, one-line change each): super admin sees all; a rep sees documents on their own service lines plus every standalone one; a customer sees documents on their companies' jobs plus those tied to their company, never an unlinked standalone one. Only staff upload; customers read and download. Job-bound documents still upload from the job page and appear in the library too.
**Why:** Evans said to hold WhatsApp, that tracking cannot be done now, that emails are not pulled, and that the client needs storage where they can keep documents and search for them easily (the client's stated pain is finding years-old documents).
**What was rejected:** Mailbox ingestion; carrier API adapters; a separate document store apart from job documents (one table, one search); full-text search inside PDFs and OCR (needs Evans's permission, I2); date-range filters (a typed date already matches; add if staff ask); letting customers upload (not asked).

## 2026-10-05, Finance section: overview of costs and profit per job, invoices as a tab

**What was decided:** The sidebar's Finance item opens `/finance` with two tabs: Overview and Invoices (today's unpaid-invoice table at `/invoices`, unchanged; customers still see "Your invoices" only). Overview shows totals per currency (invoiced, received, owing, costs) and a Profit-per-job table (invoiced, received, costs, profit), backed by staff-only `GET /api/v1/finance/summary` (scoped to the caller's service lines; customers refused). Costs are the newest actual of each non-removed charge in the currency it was recorded (GHS under the 2026-10-03 rule). Profit is invoiced minus cost and is shown only where a job has both in the same currency, otherwise "-".
**Why:** Evans said Finance should show proper financial details, not invoices; he chose money out (costs), profit per job and keeping the invoice list.
**What was rejected:** Converting currencies to compute profit (no exchange rule, 2026-10-04); counting voided or draft invoices; showing customers costs; a separate "money in" panel (not chosen; invoiced, received and owing sit in the totals and per-job rows).

## 2026-10-05, Finance steps on job progress say what to do and open the payment form

**What was decided:** On the job progress list the finance steps stay read-only (ticked from invoice and payment records). Their links now say what to do: unrecorded bill "Create invoice", unrecorded payment "Record payment", recorded "View", and customers see "View invoices". "Record payment" opens Costs & invoices with `?pay=1`, which opens the payment form on the first issued invoice with a balance, amount prefilled. No API or database change.
**Why:** Evans did not understand why both steps led to the same tab; "Go to invoices" did not say what to do there.
**What was rejected:** Recording payments directly on the progress list (would reverse the 2026-10-03 rule and duplicate the invoice-tab form); removing the links.

## 2026-10-05, Customer page becomes an account workspace: figures, active/inactive, revenue ranking, leads

**What was decided:** (1) The customer directory and profile show derived figures per company from existing records: active jobs, last job, quotes sent/accepted/awaiting, invoiced/received/owing per currency (never summed across currencies), average days from invoice to payment, and last contact (latest correspondence entry or customer message). (2) A customer is **active** if it has an unfinished job or a job opened in the last 90 days (`customerActiveDays` in `@bjh/contracts`; moving it into Settings is a follow-up). (3) Customers can be ranked by revenue (issued invoices) one currency at a time. (4) Leads get simple stages (New, Contacted, Quoted, Won, Lost) with an owner, a next follow-up date and a lost reason; Won links to a customer company. No scoring or automation. (5) Evans chose that **all staff see all customers' money figures** on this page (supersedes the 2026-09-29 job-visibility scope for these customer figures only); customers never see them.
**Why:** Evans asked for a real customer page: lead management, active vs non-active customers, customers by revenue. Answers to the three questions asked in-session.
**What was rejected:** Reversing the 2026-10-04 "no pipeline" rule beyond the simple stages above (no lead scoring, auto-assignment or reminders); summing or ranking across currencies; hiding money from reps (Evans's choice).

## 2026-10-07, Hosting: API on Render, web on Vercel

**What was decided:** The NestJS API deploys to Render's free plan from a root `render.yaml` Blueprint (Node 22.22.3, `NODE_ENV=production`, `API_HOST=0.0.0.0`, health check `/api/health`, auto-deploy off, secrets entered in the dashboard with `sync: false`, Supabase root CA as a Render secret file at `/etc/secrets/supabase-root.crt`). The API now listens on `PORT` when set (Render), falling back to `API_PORT`. The Next.js web app deploys to Vercel with Root Directory `apps/web`; `apps/web/vercel.json` installs from the workspace root and builds `@bjh/contracts` before `next build`; `apps/web/package.json` pins Node `22.x`. Migrations are not run by either host; they go through the controlled release path.
**Why:** Evans asked to make the code ready to push, with the backend on Render and the frontend on Vercel, and chose the free plan. Known effect: the free service sleeps when idle, so queued email/SMS wait until the next request wakes it, and the first request after idle is slow.
**What was rejected:** Running migrations in the Render build (AGENTS.md hard stop; schema changes need a controlled path); auto-deploy on push (deploys must be explicit); a Dockerfile (Render's native Node runtime is simpler); the Render worker/Redis service (BullMQ worker still planned, the API's in-process notification timer covers sending today).

## 2026-10-08, Shipment steps list reads like the client's sample tracker

**What was decided:** The "Shipment steps" list (`JobSteps.tsx`, shown to staff and customers) gains an "n of N done" counter, a connecting rail between steps (blue only between two recorded steps, grey otherwise), pending steps greyed with the word "Pending" (was "Not recorded"), the date alone on recorded steps (was "Recorded <date>"), and the step's note as a detail line under it. The note box now says customers can read it. No API, contract or database change. This revises the 2026-10-03 removal of the milestone count, now that the two-tracker confusion is gone (one list). Evans said "make mine even better" after seeing the comparison with the sample.
**Why:** The client's sample tracker shows progress as a count, a rail, and a detail line per step; our list showed only a date and "Not recorded", and notes were hidden under "Update history" even though the API already returns them to customers.
**What was rejected:** A "now" marker on the first undone step (the workflow allows any order; 2026-09-30 and 2026-10-03 decisions say not to imply a next step); per-step estimated dates and pre-arrival steps (booked, loaded, sailed) which need a contract/database change and a client-confirmed step list; copying the sample's Nigerian steps (Form M / PAAR do not apply to Ghana); a voyage diagram (carrier tracking dropped 2026-10-04).

## 2026-10-08, Session lookup: higher rate ceiling, one shared request per page, no silent customer view

**What was decided:** (1) `GET /api/v1/auth/session` keeps the per-IP throttle but at 600 a minute (was the shared 30); the bootstrap routes stay at 30 and keep their test. (2) The web's `useStaffAccess` shares one session request among all components on a page, for 20 seconds and only for the same access token, so a page costs one lookup instead of one per component (about 22 components use it). A failed lookup is not remembered. (3) The job page (`JobShell`) shows "Your access could not be checked. Reload the page to try again." when the lookup fails, instead of falling back to the customer view with staff buttons hidden.
**Why:** Evans said "fix" after I found that reloading a page a few times pushed `/auth/session` over 30 a minute, returned 429, and the job page then treated a signed-in rep as a customer. Measured after the change: one session call per page load; twelve reloads in a row gave twelve calls, all 200.
**What was rejected:** Removing the throttle from session (keeps a ceiling against floods); retrying on 429 (the browser cannot read `Retry-After` across origins, so the wait would be a guess); gating every page on the lookup being "ready" (the hook resets to "loading" on every SIGNED_IN, which Supabase also fires when a tab regains focus, so pages would blank and lose half-filled forms); changing `AuthStatus` (it fetches with the token it is handed inside the auth callback; one extra call a page is acceptable).
**Open, not changed:** the API does not set Express `trust proxy`, so behind Render every visitor may share the proxy's IP and one throttle bucket; the right hop count needs Render's current docs and a human decision. The other 20 pages that read roles from `useStaffAccess` still treat a failed lookup as "no roles".

## 2026-10-08, Rate limits count each visitor by `CF-Connecting-IP` on Render; one notice when the access check fails

**What was decided:** (1) Closes both "Open, not changed" items of the entry above. The auth routes' throttle now uses `ClientIpThrottlerGuard`, which counts a request against the address in the header named by `CLIENT_IP_HEADER` and otherwise the socket address. `render.yaml` sets it to `cf-connecting-ip`; it is unset locally and in tests. Not a `trust proxy` hop count. (2) `WorkspaceFrame` shows one notice with a Reload button on every page when the access check fails ("Your access could not be checked, so some buttons may be missing."), so the other ~20 pages that read roles no longer fail silently. The job page keeps its full-page message.
**Why:** Evans said "go on" to both. Render's own articles say all inbound traffic passes through Cloudflare, that Cloudflare writes `CF-Connecting-IP` and overwrites a caller's copy, and that the leftmost `X-Forwarded-For` entry can be forged; no official page gives a hop count, so guessing one for `trust proxy` was the riskier choice. Source for the header claim is Render's PocketBase guide (render.com/articles/host-pocketbase-on-render) and its DDoS article, not a formal reference page, so confirm once in production by checking that two visitors are counted separately.
**What was rejected:** `app.set("trust proxy", N)` (unknown hop count; wrong N lets callers fake their address); trusting `X-Forwarded-For` (forgeable); always trusting the header (a caller who reaches the API directly could forge it, so it is opt-in by setting); editing each of the ~20 pages (one frame notice covers them); an automatic retry of the access check (hides failures; not asked). **To do by hand:** a Render service created before this change needs `CLIENT_IP_HEADER=cf-connecting-ip` added in its dashboard (or the Blueprint synced); auto-deploy is off.

## 2026-10-08, Render deploys the API on every commit to the linked branch

**What was decided:** `render.yaml` now sets `autoDeployTrigger: commit` (Render's current field, which replaces the deprecated `autoDeploy`; `commit` is equivalent to the old `autoDeploy: true` and to "On Commit" in the dashboard). Evans had already switched the dashboard to On Commit and asked for the blueprint to match, so a Blueprint sync does not flip it back off. This reverses the 2026-10-07 decision that auto-deploy stays off so every deploy is explicit.
**Why:** Evans wants merging to `main` to be the release step. Source: Render's blueprint spec and deploys pages, checked 2026-10-08.
**What was rejected:** `autoDeployTrigger: checksPass` (the repo has no CI checks, so Render would not deploy); keeping the deprecated `autoDeploy: true`; leaving the blueprint at off while the dashboard says On Commit.
**Rule that now matters:** Render does not run migrations, so any change that needs one must be applied with `db:migrate:production` BEFORE it is merged to `main`; otherwise the API deploys against the old database. Every push to `main` now goes live on Render. The README line "(auto-deploy is off)" is out of date and was left alone because README.md holds other uncommitted edits.

## 2026-10-08, The hosted app carries no "local" wording; sign-in no longer waits on a setup check

**What was decided:** (1) The sign-in page shows its form at once. The first-setup status call (`/v1/auth/bootstrap-status`) now runs in the background and only switches the form to "Create super admin" when the API says first setup is open (local development only; the API refuses it in production). The "Checking local setup…" card is gone. (2) Removed the labels and messages that said the app was local: the sidebar "Local environment / Connected to the local Supabase stack" note, the overview "LOCAL WORKSPACE" badge, "LOCAL REQUEST INBOX", "Local database", "Local data", "LOCAL ENGINE", the "local Supabase" sign-in error messages and the page descriptions; the CSS only they used was removed. (3) `apps/web/next.config.ts` fails a Vercel build (`VERCEL` is set) when `NEXT_PUBLIC_API_BASE_URL`, `NEXT_PUBLIC_SUPABASE_URL` or `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` is missing or points at localhost. Running locally is unchanged: `pnpm dev` still points the apps at the local Supabase stack, hosted values come from Vercel and Render.
**Why:** Evans signed in to the hosted site and saw "Checking local setup…" and other local wording. The check blocked the form on an API call that can take a minute when the free Render service wakes, and the 17 web API clients fall back to `http://127.0.0.1:3001/api` when the variable is missing.
**What was rejected:** Removing the localhost fallback from the 17 API files (dev needs it; the build guard keeps it out of hosted builds); touching `scripts/supabase-local.mjs` or the local-database detection in the API (that is what keeps local runs on the local database); editing local-development docs or `.env.example`. Not decided: whether `/documents-preview` (synthetic sample pages, labelled "Local design review") stays reachable in production.

## 2026-10-08, Open sign-up; admin-set passwords are temporary; forgot password by email; super admin SMS codes built but off

**What was decided:** (1) Anyone can create an account on the sign-in page ("New here? Create an account"). The account sees nothing until the super admin gives it a staff role (Staff management) or links it to a company: the Customer accounts page now lists these people under "Waiting for access" (`GET /api/v1/admin/customer-accounts/pending`). The sign-in page tells them to wait and signs them out. This reverses the 2026-09-28 rule that only the super admin creates accounts (he still can). (2) A password the admin chooses (new staff or customer account, or a password reset from the admin screens) is temporary: Supabase `app_metadata.bjh_must_change_password`. Until the user picks their own at `/set-password` (`POST /api/v1/auth/password`, at least 12 characters), every role and scope guard refuses them with "Choose a new password before continuing". (3) "Forgot password?" emails a Supabase reset link to `/set-password`, using the same endpoint. (4) Super admin SMS codes (Supabase phone MFA): the `/two-factor` page and the API check (the super admin's token must be `aal2`) exist, but stay off until `SUPER_ADMIN_MFA_REQUIRED=true` and phone MFA is enabled in Supabase.
**Why:** Evans asked for an easy two-factor for the admin, a first-time sign-in, and a way to change a forgotten password. He chose SMS codes but "not implemented for now", open sign-up for speed, change-password-at-first-sign-in, and an email reset link.
**What was rejected:** Authenticator-app or email two-factor (Evans chose SMS); invitation emails (keeps admin-set passwords, now temporary); admin-only password resets. Facts found: Supabase merges `app_metadata` on update, so a key is removed only by setting it to null (fixed in the same change for the suspension marker, which never cleared on reactivation with real Supabase). Changing a password ends the user's sessions, so `/set-password` signs in again with the new password. Hosted phone MFA is a paid Supabase add-on (about USD 75 a month) plus an SMS provider; Arkesel would need the Send SMS hook. Hosted reset and confirmation emails need BJH's own SMTP in Supabase. Supersedes the 2026-10-08 audit's advice (B4) to turn public sign-ups off.

## 2026-10-08, Beta-readiness fixes from the audit

**What was decided:** Next.js 16.3.6 to 16.3.8 (pinned), with pnpm overrides `sharp >=0.35.5` and `source-map-js >=1.2.2`; `pnpm audit --prod` now finds nothing. The web app sends `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `nosniff`, a referrer policy and a permissions policy. A suspended customer loses access on the next request: the company lookup the guards use skips accounts whose `auth.users.banned_until` is in the future (tokens already issued used to work until they expired; the local tokens are ES256, verified without asking Supabase). The settings pgTAP fixture uses revision numbers 900001/900002 so it passes on a persistent local database. Work was done on branch `fix/beta-readiness` in a separate worktree (`../logistics-b0`), built on logistics-99's commit `29fda73`.
**Why:** Evans asked to fix the audit findings and to take over the work from the other session.
**What was rejected:** A full script Content-Security-Policy (needs per-request nonces in this Next.js; risk of breaking pages); revoking memberships on suspension (would hide suspended customers from the admin list); a schema change for suspension (Supabase already stores the ban). Still open: the local database differs from migrations `20260930000011` and `20260929000013`, so `quotes_test` #9 fails locally until the local database is rebuilt (needs Evans's yes, it deletes local data); backups, production checks, monitoring.
