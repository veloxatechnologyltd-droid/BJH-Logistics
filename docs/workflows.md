# Operational workflows

These are proposed job templates derived from the two conversations, not hard-coded assertions about customs law. Configure mandatory/optional steps by service after the operator validates them. Store each milestone's actor, timestamp, evidence and visibility; exceptions/overrides require a reason and authorised reviewer. Job status is a summary; a step history is not overwritten by moving backwards.

## Shared entry and states

Quote request → the rep for the quote's service line (or the super admin) drafts and issues it; there is no separate approval step (decided 2026-09-29, see MEMORY.md) → accepted/rejected/expired → job opened (or staff opens a directly instructed job). Acceptance is recorded against the specific quote version with actor and timestamp; no separate evidence attachment is required. Do not import historic records. Generate a collision-safe file number on opening. Job summary: `open`, `in_progress`, `on_hold`, `ready_to_close`, `closed`, `cancelled`; reopening a closed job requires a recorded reason and permission. Each job has exactly one primary service/direction/mode, but can contain multiple containers and related transport legs. Job number format and direct-job policy are [open decisions](decisions.md).

Authorized BJH users configure legal issuer status, tax and related finance settings; the app must not assume or hard-code those values. 

## Sea import

> **Client-derived milestone list (2026-09-29).** The sea-import steps below follow the client's own description of the process (file registered and numbered → arrival tracked and customer updated → documents entered with customs to generate tax → bill issued → customer pays → port/terminal/other charges paid and container released by the shipping line → terminal booked and customs inspection → customs release and delivery authorisation → truck loaded and dispatched → delivery note signed by consignee → empty container returned with EIR → file closed). The implemented milestone keys live in `packages/contracts` (`seaImportMilestones`). Milestones are recorded in any order; mandatory evidence per step and closure overrides (D02) still need operations-lead validation.

1. Receive shipping documents and register job; capture customer, consignee, shipping line, B/L and container(s).
2. Monitor arrival/ETA and send approved updates.
3. Record customs declaration/assessment and duties; prepare customer invoice including service charges and pass-through charges.
4. Staff record customer's external payment and port/terminal/other disbursements; record shipping-line container release.
5. Record terminal booking/charges, customs inspection, customs release and delivery authorisation.
6. Assign truck/driver, issue waybill and dispatch; obtain signed proof of delivery including damage/exception notes.
7. Record empty-container return and EIR/condition; reconcile documents, costs and outstanding receivables; close when applicable evidence is present or override is approved.

## Sea export

1. Quote, open job, record cargo/customer requirements and vessel booking.
2. Arrange container to customer; record loading/stuffing and return to port.
3. Record customs processing/release and terminal handling charges/disbursements.
4. Confirm vessel departure, issue shipping documents and final invoice/waybill as applicable; close with evidence.

## Air import and air export

- Air import: receive airway bill and other documents → monitor flight arrival → customs assessment and charges → customer billing/external payment record → clearance and airport/airline charges → release → delivery and signed proof → close.
- Air export: quote/book airline → receive goods → customs/airport processing and charges → airline acceptance/departure and airway bill → invoice → close.
- Air jobs do not require container-return EIR. Required air-specific forms and carrier-event data are [to confirm](decisions.md).

## Warehousing and standalone road transport

- Warehouse job: quote/rate → receive goods into a named location and stock ledger → issue inventory reports → authorised partial/full picks reduce balance atomically → invoice and close when obligations are settled. Record units, condition and handling discrepancies; no negative quantities.
- Road job: quote → dispatch with assigned vehicle/driver and waybill → milestone/destination update → signed delivery proof → invoice/payment record → close. Multiple legs and subcontractors remain explicit records if required.

## Cross-cutting rules

- External observations (carrier API/website) never silently undo a staff-confirmed event. Preserve source, observed-at and effective-at, and flag conflicts for review.
- Customer portal access follows company ownership: users can see all business records associated with their assigned company and no records belonging to another company. Keep BJH-only administrative records outside customer-company records; do not use a per-record publication switch to hide company-owned business data.
- Missing documents, damaged cargo, revised ETA, partial payment and failed delivery create exceptions/tasks, not a forced happy-path progression. Staff add these tasks by hand. Closing or cancelling a job with open tasks shows them and asks for confirmation; open tasks can still be marked done after closure.
- Customers are messaged for key steps only (each step's `customerMessage` in `packages/contracts`), plus quotation, ETA, invoice, payment and the waybill's dispatch and delivery. Every step stays visible in the portal. The waybill fills the "dispatched" and "delivered" steps.
- Generated invoice/waybill/delivery note retains its issued version; corrections create a revision/credit or documented adjustment under approved business rules.
