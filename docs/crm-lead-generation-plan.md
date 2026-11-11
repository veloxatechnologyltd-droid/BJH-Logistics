# CRM lead generation — plan and checklist

Status: **in progress** — Phase 1 items 1.1 to 1.3 done locally 2026-11-11 (branch `feat/crm-lead-generation`, not merged, not deployed). Builds on the existing staff CRM (`app.lead`, `app.lead_activity`, Leads board, quote-for-lead, accepted quote → Won). Direction: [MEMORY.md](../MEMORY.md) entries of 2026-11-10 ("lead-generation-first scope") and 2026-11-11. Client walkthrough: `docs/client-crm-workflow.docx`.

Reference implementation: Evans's Venariq SaaS (`~/Projects/leadgeneration`). Logic is **ported to TypeScript inside the NestJS API**; nothing is shared or called across the two systems.

## Scope

**In:** campaigns (target service, industry, location, keywords, exclusions, fit rules) → business search → duplicate check (within the campaign **and** against existing customers and leads) → website contact enrichment → AI fit score with a reason → staff review → "Add to leads" → approved email outreach → reply capture → follow-ups → existing quote/job flow.

**Out (SaaS-only in Venariq):** multi-tenancy, billing and usage plans, onboarding, newsletters, admin broadcasts, Gmail and Microsoft sign-in, Calendly, contacts/audiences. **Later:** Hunter.io, WhatsApp/SMS outreach.

## Design rules

- Staff only. Customers never see campaigns, prospects, scores or outreach.
- **Prospects are not leads.** Search results go to `app.prospect`; staff promote chosen ones to `app.lead` (`source='campaign'`, `campaign_id`). The Leads board only shows real leads.
- No outgoing message without staff approval (no auto-send exceptions).
- Background work follows the as-built pattern: PostgreSQL queue tables with claim columns, a timer inside the API process, no Redis. Long searches advance one step per tick.
- External providers sit behind interfaces with a **stub** for local runs and tests; no real Apify, AI or SMTP calls in tests.
- Schema only through reviewed `supabase/migrations/`, applied locally only until a release is requested.

## Venariq gaps fixed rather than copied

- An unsubscribe reply writes a suppression entry, not just a lead status.
- Daily send counter is a single atomic `UPDATE`.
- Booking-link auto-send removed; everything needs approval.
- Reply check only scans conversations awaiting a reply (no N+1 over all conversations).

## Open decisions

Answered by Evans 2026-11-11:

| ID | Question | Answer | Still blocks |
|----|----------|--------|--------------|
| L1 | Apify account and budget | **BJH's own Apify account** ($30–60/month quoted); token in the API env | First real search, until BJH creates the account and supplies the token (stub until then) |
| L2 | Outreach sending mailbox | **New `sales@bjhlogistics.com` on `mail.bjhlogistics.com`**, used only for outreach and its replies | Phase 2 real sends, until the mailbox exists |
| L3 | Who sees the lead-generation screens | **Sales rep, customer service rep and super admin** | — |
| L4 | B2B cold email under Ghana's Data Protection Act, 2012 (Act 843) | **Evans is asking BJH**; everything is built, real sends wait for confirmation | First real send |

## Checklist

Mark an item done only with code, tests and evidence (test output, browser check) recorded beside it.

### Phase 1 — Find and qualify (first release)

- [x] 1.1 Migration: `app.lead_campaign`, `app.lead_campaign_run` (status, current step, counts, error, claim columns), `app.prospect` (campaign, business name, website, address, phone(s), email(s), rating, category, source + source id, normalized keys, score, reason, enrichment status, promoted lead id); `lead.campaign_id` and `'campaign'` source. RLS on, all grants revoked from `anon`/`authenticated`. → pgTAP: no customer access; constraints hold.
  - Evidence (2026-11-11, **local** Supabase only; nothing remote touched): migration `supabase/migrations/20261111000000_lead_campaigns.sql` applied with `supabase migration up --local`; `supabase/tests/lead_campaigns_test.sql` 39 passed (customer role refused on all three tables; campaign, run and prospect constraints; promotion; campaign delete keeps leads); the tests were checked to fail when a grant or a constraint is removed. Full pgTAP 32 files / 382 passed; API unit 173, site 19, web 30, scripts 5, API e2e 424 all passed; `typecheck`, `lint`, `format:check` clean.
  - As built: `app.lead_campaign` (status active/paused/archived, target service/industry/location, keywords, exclusions, min rating, require website, fit rules, threshold 0–100, max prospects 1–500); `app.lead_campaign_run` (status + step kept consistent by a CHECK, counts, provider run/dataset id for resuming a search, error required on failure, claim columns, one queued/running run per campaign); `app.prospect` (normalised name/domain/phone keys; unique only on the provider's own place id so uncertain duplicates are kept and flagged via `duplicate_kind/ref/reason`; score always with reason, method ai/rules and time; `promoted_lead_id` unique); `app.lead.campaign_id` (ON DELETE SET NULL) with source `'campaign'` required whenever a campaign is set.
  - Assumptions: run `status` is queued/running/ready/failed/cancelled and `current_step` adds searching/enriching/scoring; prospect `source` is `google_maps` or `stub` (so stub rows are never mistaken for real ones); duplicate flags and `score_method` are stored now because 1.3, 1.5 and 1.8 need them; offer/tone/CTA and follow-up settings are left to Phase 2 (2.2). Role access (L3) is enforced in the API in 1.7, not here.

- [x] 1.2 `BusinessSearchProvider` interface: Apify Google Maps implementation (start run, poll, fetch dataset, filters: exclusions, min rating, require website) + stub with synthetic results. → unit tests on the mapping and filters.
  - Evidence (2026-11-11): `apps/api/src/leads/business-search.ts` (interface `BusinessSearchProvider` as three resumable calls `start` / `poll` / `fetchResults`, shared mapping and filters, `StubBusinessSearchProvider`), `apify-business-search.ts` (Apify implementation, env factory), `business-normalize.ts` (name, domain and phone keys for 1.3). Tests `business-search.unit-spec.ts` and `apify-business-search.unit-spec.ts`: 17 passed, no network (injected `fetch`); checked to fail when the rating or website filter is broken. Not wired into `app.module.ts` yet: 1.6 injects it.
  - Apify docs rechecked 2026-11-11 (API reference, Run Actor and Get run pages, the actor's published input schema): `/v2/actors/` replaces the deprecated `/v2/acts/` Venariq uses; run statuses READY, RUNNING, SUCCEEDED, FAILED, TIMING-OUT, TIMED-OUT, ABORTING, ABORTED; star filter values and `website` values as Venariq's; `maxTotalChargeUsd` caps a run's cost (default $5 here, `APIFY_MAX_CHARGE_USD`). Differences from Venariq: actor `compass/crawler-google-places` instead of `lukaskrivka/...`, the billed "contacts from website" add-on is off (1.4 does that), closed places skipped, a run cannot cost more than the cap, results limited to the campaign's maximum, and no email filter (1.4 and 1.5 decide on contacts). Excluded keywords match as substrings of name, category, address, website and description, as in Venariq. Not tested against the real Apify (no token, L1).

- [x] 1.3 Duplicate check: normalized name / website domain / phone, within the campaign and against `app.customer_company`, customer contacts and `app.lead`; matches flagged for staff, not silently dropped when uncertain. → unit tests.
  - Evidence (2026-11-11): `apps/api/src/leads/duplicate-check.ts` (`checkDuplicates`, pure), `DatabasePort.listKnownBusinesses(campaignId)` (customers with their trading name, website, company email and contacts' emails and phones; all leads; this campaign's prospects), `normalizeEmailDomain` in `business-normalize.ts`. Tests: `duplicate-check.unit-spec.ts` (10) and `known-businesses.e2e-spec.ts` (2, against the local database); checked to fail when domain matching or the campaign filter is broken.
  - Rules: only the provider's own place id in the same campaign is certain, so that business is **not stored again** (`already_found`; the database would refuse it anyway). Every other match is **stored with a flag** (`flagged`: kind, record id, reason) and never dropped: same website host (a customer's or lead's business email domain counts as its website; free mailboxes, social pages and page builders never match), same phone number (any spelling, any contact), or same name (legal suffixes ignored, trading names included; exact match only, no fuzzy matching). One flag per prospect: strongest match first, then customer over lead over prospect. Businesses in one batch are compared with the ones before them, so a later branch points at the earlier prospect. Another campaign's prospects are not compared (plan: within the campaign).
  - For 1.6: generate each prospect id before inserting, skip `already_found`, store `flagged` with `duplicate_kind/ref/reason`, and count both in the run's `duplicate_count`.

- [ ] 1.4 Website contact finder: homepage, contact and about pages; extract and rank emails and phones; timeouts and size limits; no browser rendering. → tests on saved synthetic HTML.
- [ ] 1.5 AI fit score 0–100 with reason via the existing Claude client; campaign threshold; rule-based fallback when the AI fails; page text treated as data, never instructions. → unit tests incl. failure path.
- [ ] 1.6 Run pipeline on the API timer: queued → searching → enriching → scoring → ready; one claimed run at a time; stale-run recovery; safe failure shows the error on the run. → e2e test with stubs.
- [ ] 1.7 API: campaigns CRUD, start run, run status, list/filter prospects, promote one or many to leads (creates `app.lead`, logs an activity, idempotent). Role guard: sales rep, customer service rep, super admin (L3). → e2e incl. customer denied and non-permitted staff denied.
- [ ] 1.8 Web (visible to sales, customer service, super admin only): Sales → Campaigns list, new campaign form, campaign detail (run progress, prospect table with score reasons and duplicate flags, bulk "Add to leads"). Single-blue UI. → browser check as sales rep and as customer.
- [ ] 1.9 Leads board shows campaign as the source; Sales report counts leads by campaign. → e2e + browser check.

### Phase 2 — Approved outreach (needs L2; real sends need L4)

- [ ] 2.1 Migration: `app.outreach_draft` (lead, recipient, subject, body, type initial/follow-up/reply, status pending/approved/rejected/sent), `app.outreach_send` queue (claim columns, scheduled at, attempts, provider id, unsubscribe token), `app.suppression` (email/phone, reason, source, active), sender limits (daily cap, min spacing, atomic counter).
- [ ] 2.2 Approved company facts for drafting (Settings, super admin) and campaign offer/tone/CTA.
- [ ] 2.3 AI draft per lead from approved facts; user fields sanitized. → unit tests.
- [ ] 2.4 Approvals screen: edit, approve, reject, batch approve. → e2e + browser.
- [ ] 2.5 Send worker: recheck approval and suppression at send time; daily cap and spacing; never resend after provider accepted; separate outreach email provider (stub locally). Sending moves lead to `contacted` and logs an activity. → e2e incl. suppressed address not sent, cap respected, no double send.
- [ ] 2.6 Unsubscribe link in every email, public unsubscribe page, `List-Unsubscribe` + one-click header; unsubscribing writes suppression. → e2e.

### Phase 3 — Replies and follow-ups

- [ ] 3.1 Mailbox reader also reads the outreach mailbox; replies matched to the lead, deduplicated, stored on the lead's history.
- [ ] 3.2 AI intent: interested / question / not interested / unsubscribe; suggested reply as a pending draft; unsubscribe → suppression; not interested → lead lost only after staff confirms.
- [ ] 3.3 Staff notice to the lead owner on a reply.
- [ ] 3.4 Follow-up drafts when no reply after the campaign's interval, up to its maximum; cancelled on reply or opt-out; still need approval. → e2e for each path.

### Phase 4 — Reporting and extras

- [ ] 4.1 Sales report per campaign: found, qualified, added to leads, contacted, replied, quoted, won.
- [ ] 4.2 (Later) Hunter.io decision-maker lookup.
- [ ] 4.3 (Later) WhatsApp/SMS outreach, with opt-in and provider templates.

### Release (only on explicit request)

- [ ] R.1 Security review of new endpoints, provider secrets and public unsubscribe route.
- [ ] R.2 Production migrations and env vars (Apify token, outreach mailbox) — Evans runs or approves in-session.
- [ ] R.3 CHECKLIST.md and docs aligned with what shipped.
