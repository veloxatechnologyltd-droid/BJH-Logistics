# Client feedback, 2026-11-01: understanding checklist

Status: **all items built on branch `feat/client-meeting-teams-workflow` (2026-11-01), tested (unit, e2e, pgTAP, headless browser) and awaiting Evans's review; not deployed.** Vessel and port filters are not built: jobs do not store them yet. Each item says what the client asked for, what the system does today, and what would change. Numbered questions (Q1, Q2…) are listed at the end and must be answered before the item is built. Nothing here is ticked until the answers are agreed.

## The picture as I understand it

BJH works in four teams. The work moves through them in this order:

```
SALES                 CUSTOMER SERVICE                 OPERATIONS                FINANCE
find clients    →     faces the client: emails,   →    import rep / export rep   invoices, payments,
onboard them          requests, inquiries, quotes,     run the job end to end    receipts
follow up (CRM)       keeps the client updated,        (may get an assistant)
                      assigns the job to import/export
                      once the client has accepted and
                      the invoice is issued (payment not needed)
```

Customer Service stays the client's single point of contact the whole way through. Operations sends its updates back through Customer Service.

---

## A. Structure and roles

- [x] **A1. Group the system into Sales, Customer Service, Operations, Finance.**
  Today the sidebar has Overview; SALES (Customers, Requests, Inquiries, Quotes); OPERATIONS (Jobs, Tasks, Warehouse, Documents, Shipping documents, Reports); FINANCE; CLIENTS (Messages); Settings.
  Proposed: SALES (Leads/CRM, Customers), CUSTOMER SERVICE (Requests, Inquiries, Client chat, Quotes), OPERATIONS (Jobs, Tasks, Warehouse, Documents, Shipping documents), FINANCE (Finance, Invoices, Receipts), plus Reports and Settings. → Q1, Q2
  _Menu built locally 2026-11-01, awaiting Evans's review:_ grouped as above (Messages under Customer Service until the client chat replaces it); Finance shown only to finance and the super admin. The API does not enforce the Finance restriction yet; that comes with the Finance step.
- [x] **A2. Roles become: Import rep, Export rep, Customer service rep, Sales rep.** Super admin (the boss) stays.
  _Built locally 2026-11-01, awaiting Evans's review:_ roles, the conversion migration, job visibility per role, and customer service/sales keeping customer records and requests. Tests: `apps/api/test/department-roles.e2e-spec.ts` and `contracts.unit-spec.ts`. Not in production.
  Today there are four operational roles: air import, air export, sea import, sea export. Each rep sees only the jobs, quotes and documents of their own line. → Q3, Q4, Q5
- [x] **A3. One person handles all import and one handles all export. When one is overloaded, another person can be assigned to help.**
  _Built locally 2026-11-01, awaiting Evans's review (with B2):_ lead and assistants on each job, assigned by customer service after the client accepts the invoice; super admin override with a reason. Tests: `apps/api/test/job-assignment.e2e-spec.ts`, `supabase/tests/job_assignment_test.sql`. Not in production.
  Today nobody is assigned to a job by name. Everyone holding the line's role sees all of that line's jobs. Proposed: a job gets a **lead rep**, plus optional **assistants** added later. → Q6

## B. Customer Service

- [x] **B1. Customer Service owns every incoming email, quote request and inquiry.**
  Today the AI reads every email, links the customer, drafts the quote and sends the automatic reply. The rep for the service line checks emailed requests, and any staff member handles inquiries. Proposed: the Customer service rep becomes the owner of the Requests and Inquiries inboxes. → Q7, Q8
- [x] **B2. Customer Service assigns the job to the import or export rep, only after the client has accepted AND the invoice is issued. Payment is not required, because the boss can let a job go ahead unpaid.**
  Today accepting a quote opens the job straight away, and an invoice can only be created on an open job. So "invoice issued before assignment" fits this order: accepted → job opens (unassigned, with Customer Service) → invoice issued → Customer Service assigns the rep. → Q9, Q10
- [x] **B3. Client chat thread: Customer Service talks with the client inside the system and passes on Operations' feedback.**
  Today messages only go out (email/SMS through the outbox), plus a manual correspondence log on each job. Clients cannot reply inside the system. → Q11, Q12
- [x] **B4. Copies of website and portal quote requests also arrive in quotes@, so staff see them in the mailbox.**
  Today website and portal requests land in the system only.
  Technical note: the system reads quotes@ itself, so a copy sent there would be read back in as a second request unless the reader recognises it. That is solvable (skip our own notification emails), but it has to be built in. → Q13
- [x] **B5. Reminders when an email needs attention, and a further reminder when one has gone untouched for some days.**
  Today there are no staff notifications at all; the only signal is the attention chips on the overview. Proposed: an in-app notification bell, plus optional email to staff. → Q14, Q15
- [x] **B6. Schedule an email for later; when the time comes, a pop-up appears on screen.** → Q16

## C. AI assistant that does real work

- [x] **C1. A chat screen like ChatGPT/Claude where staff type things like "assign this job to Kofi". The AI calls a tool and actually does it.**
  Today the AI reads emails and documents, drafts replies and messages, and drafts quotes. It cannot act on instructions.
  Proposed safety rule: the AI may only do what the signed-in person is already allowed to do, and it shows each action ("Assign BJH/SI/2026/0042 to Kofi?") for a click to confirm before anything changes or anything goes to a client. → Q17, Q18

## D. Quotes

- [x] **D1. Each charge line has Unit price, Qty and Total price.**
  Today a line has one amount, or one amount per container size, with a basis (fixed / per B/L / per container / at cost). There is no quantity. → Q19
- [x] **D2. Container size (20ft/40ft…) is optional, not always present.**
  Today container-size pricing is switched on by default. Proposed: off by default; size becomes an optional label on a line. → Q19

## E. Operations: jobs and the board

- [x] **E1. The Jobs list has no filter.**
  Proposed filters: search (file number, customer, B/L, container), status, import/export, assigned rep, customer, date opened (range). → Q20
  _E1 and E2 built locally 2026-11-01, awaiting Evans's review:_ all filters except vessel and port, which jobs do not store yet. Tests: `apps/api/test/job-filters.e2e-spec.ts`.
- [x] **E2. The kanban board will hold 5 years of jobs, so it needs filtering and an easy way to track work.**
  Proposed: by default the board shows **active jobs only**, plus closed or cancelled jobs from the last 30 days. It gets the same filters as the list, a "My jobs" switch and counts on each column. Old jobs stay reachable through the list and search. → Q21

## F. Sales (CRM)

- [x] **F1. Sales reps find, onboard and follow up clients. They must see how many clients came in this week and this month, who converted and who needs a follow-up.**
  Today there is a Leads board (stages from New to Won/Lost) plus the untracked-requests list. There is no owner, no follow-up date and no weekly/monthly counts. Proposed: lead owner (sales rep), next follow-up date with an overdue list, activity notes (call/visit/email), and a Sales dashboard with new leads, new clients and conversions by week and month. → Q22, Q23

## G. Finance

- [x] **G1. Print a receipt from the Finance section.**
  Today a numbered receipt PDF exists for every recorded payment, but you have to reach it from the job's invoice. Proposed: a payments list in Finance with a Print receipt button on each row (and right after recording a payment). → Q24

## H. Reports

- [x] **H1. Clear, visual reports that cover customers and quotes too.**
  Today Reports has Operations and Finance tabs. A Sales tab was left open for you to define (2026-11-01 decision). Proposed: Sales (leads, conversions, new clients), Customer Service (requests in, response time, quotes issued, accepted and rejected, win rate), Operations and Finance, with charts. → Q25

---

## Questions

**Structure**
- **Q1.** Is the grouping only for the menu, or should each team see only its own section? For example, does a sales rep see Finance at all? Does the boss see everything?
- **Q2.** Where do **Quotes** sit: Customer Service (they face the client) or Sales? And who **prepares and issues** a quote? Today it is the rep for the service line.

**Roles**
- **Q3.** Does "Import rep" cover **both air and sea import**, so the air/sea split disappears from roles (and likewise for export)? Jobs would still be marked sea or air, and file numbers stay SI/SE/AI/AE.
- **Q4.** Is there a separate **finance person/role**, or does the boss (or Customer Service) record payments and print receipts?
- **Q5.** What can an import rep **see**: all import jobs, or only jobs assigned to them (as lead or assistant)? Same question for the export rep.
- **Q6.** Who adds an assistant to a job: Customer Service, the lead rep, the boss, or any of them? Can the assistant do everything the lead can?

**Customer Service**
- **Q7.** Should the AI keep sending automatic replies and drafting quotes, with Customer Service checking them? Or should Customer Service now handle the replies themselves?
- **Q8.** Can there be more than one Customer service rep? If so, is an email assigned to one of them, or does the whole team share one inbox?
- **Q9.** "Invoice issued": is this the normal invoice on the job (which fits the current order), or a proforma invoice sent with or straight after the quote?
- **Q10.** Should the system **block** assignment until the invoice is issued (with the boss able to override), or just show it as a warning?
- **Q11.** The client chat: does the client chat **inside the customer portal** (they log in and reply there), or by **email**, with their replies landing in the thread? Or both? (WhatsApp is still on hold.)
- **Q12.** Is there one chat thread per client, per job, or per request? Do import/export reps see the thread and write in it, or only send internal notes to Customer Service?
- **Q13.** Website and portal requests copied to quotes@: should the email carry just a notice ("new request from X, open it here") or the full request text?
- **Q14.** What counts as an email being **attended to**: opened, replied, assigned, or marked done? After **how many days** should the overdue reminder fire, and should it repeat?
- **Q15.** Who gets reminded: the Customer service rep only, or the boss too after a further delay?
- **Q16.** "Schedule an email for another time": which of these is it?
  (a) **Write an email now and have it sent automatically later**, or
  (b) **Snooze an incoming email**, so it disappears and pops back up on screen at the chosen time as a reminder to deal with it, or
  (c) both.

**AI assistant**
- **Q17.** Which actions should the AI be able to do first? My suggestion is: find and summarise a job or client, assign or add an assistant to a job, create a task, draft a message or reply, record a milestone, and answer "what needs my attention today". Add or remove from that list.
- **Q18.** Is it fine that every action needs a **confirm click** before it happens? I recommend this because a misread instruction could change the wrong job or message the wrong client.

**Quotes**
- **Q19.** With Qty × Unit price = Total, how does container size fit in? My reading: a line can say "40ft" as a label, the Qty is the number of containers, and there are no longer separate price columns per size. Is that right? Do the bases (fixed / per B/L / per container / at cost) stay?

**Jobs and board**
- **Q20.** Are the filters in E1 the right ones? Anything missing (vessel, port, ETA window)?
- **Q21.** Board default: active jobs plus the last 30 days of closed jobs. Is 30 days right, and should the board open on "My jobs" for reps?

**Sales**
- **Q22.** What is a **"client we had this week"**: a new lead logged, a new customer profile created, or a customer whose first quote was accepted?
- **Q23.** What does **"converted"** mean: lead marked Won, first quote accepted, or first job opened?

**Finance and reports**
- **Q24.** Should customers also be able to download their receipts from the portal? (Today only staff print them.)
- **Q25.** For reports, which figures matter most to the boss? A rough top five is enough.

---

## Answers so far (Evans, 2026-11-01)

| Q | Answer | What it means for the build |
|---|---|---|
| Q3 | Import rep covers both sea and air import; export rep likewise | Roles become `import_rep` and `export_rep`. Jobs keep sea/air and SI/SE/AI/AE file numbers |
| Q9 | It is the normal invoice on the job. Assignment happens once the client has approved and agreed to proceed | Order: quote accepted → job opens with Customer Service, unassigned → invoice issued → client agrees to proceed → Customer Service assigns the import/export rep. No payment gate |
| Q11 | The client gets both: chat in the portal and by email | One thread; portal messages and email replies both land in it, and staff replies go out to both |
| Q16 | (b) Snooze/reminder: "I will attend to this email on this date, at this time". The AI can set it too | An email gets a "Remind me" date and time; at that moment a pop-up appears for that person. Not delayed sending |
| Q19 | Container size stays (optional) | Line = description, container size (optional), qty, unit price, total = qty × unit price, basis |
| Q22 | A new client this week/month = a new lead logged | Sales dashboard counts leads created per week/month |
| Q23 | Converted = a client who requested a quote and accepted it (Evans unsure; recommendation below) | Converted = first accepted quote. The lead is marked Won automatically when that happens |
| Q18 | Every AI action needs a confirm click | The AI proposes; nothing changes until the person confirms |

| Q1 | Finance is hidden from everyone except the finance person (and the boss). Every other section is visible to all staff, because sales must be able to create a quote when a customer needs one | Section visibility is role-based for Finance only |
| Q2 | Customer Service prepares and issues quotes (Sales can create them too). The import/export rep is assigned only **after the client has accepted the invoice** | Answers the Q9 follow-up: accepting the invoice is a **separate step** after the quote acceptance. The job needs a "client accepted the invoice" record |
| Q4 | There is a finance person who handles all finance. Finance comes out of the reps' job pages and moves to the Finance section | New **Finance** role. The job's Money tab (costs, invoices) leaves the job page for reps and is worked from Finance |
| Q5 | Import rep sees import jobs, export rep sees export jobs (sea and air). Customer Service sees everything | Job visibility by import/export; Customer Service sees all jobs |
| Q14 | A quote request is attended to once its quote has been sent. Reminder after 2 days | Reminder fires when a quote request is 2 days old with no issued quote |

| Q6 | Customer Service adds an assistant to a job | Customer Service picks the lead rep and any assistants |
| Q7 | The AI keeps sending automatic replies and drafting quotes | No change to the email assistant |
| Q8 | The super admin decides how many Customer service reps there are; whoever has the role can work, and the super admin can revoke it when someone leaves | All Customer service reps share one inbox. Granting and revoking uses the existing Staff management (role revoke, account suspension) |
| Q12 | Only Customer Service writes in the client chat | Reps pass feedback to Customer Service internally (job notes/tasks), never to the client directly |
| Q13 | Every quote request from the website or the portal is copied to quotes@ | Copy carries the full request plus a link to it in the system; the mailbox reader skips these copies so no duplicate request is created |
| Q15 | Customer Service gets the reminders | Reminder goes to every Customer service rep |
| Q17 | The AI is a helper that takes real actions, not a chatbot. Give it many tools | Tool list proposed below, each action confirmed by a click |
| Q20 | Add filters to Jobs and the board | Search, status, import/export, sea/air, assigned rep, customer, date opened, ETA, vessel, port |
| Q24 | Each client gets their receipts in the portal; Customer Service can also email a receipt | Reverses "receipts are staff-only" (2026-09-30). Customer Service can see and send receipts even though the rest of Finance is hidden from them |
| Q25 | Reports on everything | Sales, Customer Service, Operations, Finance tabs; list below |


**Settled from earlier answers instead of asking again (Evans, 2026-11-01: "why do you keep asking the same questions"):**
- Q26: Sales can create **and issue** quotes (Q1: "sales people should be able to create a quote when customer needs it").
- Q28: Finance enters job costs (Q4: "move all finances to finances section").
- Q29: The finance person can see the rest of the system (Q1: "the rest can"); only Finance is hidden from others.
- Q10 (default, change if wrong): assignment is **blocked** until the client accepts the invoice; the super admin can override.
- Q27 (default, change if wrong): either Customer Service records the invoice acceptance, or the client clicks Accept in the portal, the same as quotes today.
- Q30 (default, change if wrong): an inquiry is attended to once it is replied to; the same 2-day reminder applies.

**Confirmed by Evans (2026-11-01):** the Q10, Q27 and Q30 defaults above. Existing staff move automatically: air/sea import reps become Import reps and air/sea export reps become Export reps. The super admin keeps creating new staff accounts and assigning any role. One person may hold several roles (e.g. Customer Service and Sales).

**Proposed AI tools (Q17), each confirmed before it runs:** find a job, client, quote or request and summarise it; assign a rep or add an assistant to a job; set "attend to this email on [date, time]"; create a task for someone; draft a quote from a request; draft a reply or client-chat message; record a shipment milestone or ETA; set a lead's stage or follow-up date; email a receipt; answer "what needs my attention today". The AI can only do what the signed-in person is allowed to do.

**Proposed reports (Q25):** Sales (leads by week/month, conversions, follow-ups due, by sales rep); Customer Service (requests in by source, time to send a quote, quotes issued, accepted and rejected, win rate, overdue requests); Operations (jobs opened and closed, by import/export and rep, delays, open tasks); Finance (invoiced, paid, outstanding by currency, costs and margin per job, receipts). Each tab gets charts and the shared date filter.

**Recommendation on Q23:** count a conversion at the **first accepted quote**. It is a clear, recorded moment (the system already stores who accepted and when). Acceptance already opens the job, so "accepted" and "job opened" are the same moment. Payment is the wrong measure because the boss lets jobs go ahead unpaid. A lead with no quote yet, or with a rejected quote, is not converted.

**Q9 settled by Q2:** it is a separate step. The client accepts the invoice, and only then can Customer Service assign the rep.

**New questions from these answers**
- **Q26.** Can Sales **issue** a quote to the client, or only prepare a draft that Customer Service checks and issues?
- **Q27.** Who records that the client **accepted the invoice**? Options: Customer Service, the client in the portal with an Accept button (as for quotes), or either.
- **Q28.** Job **costs** (what was actually spent: port charges, shipping line, haulage). Does the finance person enter all of them, or do reps still record what they spend on a job, with Finance seeing it?
- **Q29.** Does the finance person see jobs and customers (read-only), or only the Finance section?
- **Q30.** For **inquiries** (not quote requests), is "attended to" the same as replied? And does the 2-day reminder apply to them too?

---

## Clashes with earlier logged decisions (flagged, not yet changed)

| Earlier decision (MEMORY.md) | What the new feedback changes |
|---|---|
| 2026-09-28/29: four roles (air/sea × import/export); reps see only their own line | Import rep / Export rep, plus Customer service and Sales roles; named assignment to jobs |
| 2026-09-29: accepting a quote opens the job, visible to the line's reps at once | The job waits for Customer Service to assign it after the invoice is issued |
| 2026-09-30: department assignment retired | A per-job assignment (lead + assistants) comes back, now on jobs rather than requests |
| 2026-10-20: the service-line rep checks emailed requests | Customer Service owns requests and inquiries |
| 2026-11-01: an AI agent with tools was rejected for **customer matching** | That rejection was about untrusted email text steering the AI. A staff-driven assistant with confirm-before-act is different, but it is still a new direction |
| 2026-10-01: container-size columns are standard on quotes | Size is optional; lines move to Qty × Unit price |
| 2026-10-04: WhatsApp on hold | The chat would be in the system/portal or by email unless you say WhatsApp |

## Suggested build order (after answers)

1. Roles and job assignment (A2, A3, B2): everything else depends on who owns what.
2. Menu grouping (A1).
3. Jobs filters and board filters (E1, E2): quick and independent.
4. Quote Qty × Unit price and optional size (D1, D2).
5. Receipts in Finance (G1).
6. Staff notifications, reminders and schedule/snooze (B4, B5, B6).
7. Client chat thread (B3).
8. Sales CRM (F1), then Reports (H1).
9. AI assistant with tools (C1), last because it acts through all of the above.

Note: role changes and new tables need migrations, and production has live accounts on the old roles. Moving existing users to the new roles needs your explicit go when we get there.
