# Agent instructions — BJH Logistics

--

## Behavioral Guidelines (Karpathy Rules — Always Active)

### 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before writing a single line:

- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them — don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

### 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

### 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:

- Do not "improve" adjacent code, comments, or formatting.
- Do not refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it — don't delete it.

When your changes create orphans:

- Remove imports/variables/functions that YOUR changes made unused.
- Do not remove pre-existing dead code unless explicitly asked.

The test: Every changed line must trace directly to the current task.

### 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:

- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"

For multi-step tasks, state a brief plan before starting:

```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

---

## Scope Control — Stay in Your Lane

Only modify files, functions, and lines directly related to the current task.
Do not refactor, rename, reorganize, reformat, or "improve" anything not explicitly asked for.
If you notice something worth fixing elsewhere, leave a note. Do not touch it.

---

## Destructive Actions — Full Stop

Before deleting any file, overwriting existing code, dropping database records,
or removing dependencies — stop completely. List exactly what will be affected.
Ask for explicit confirmation. Only proceed after Evans says yes in the current message.

---

## Hard Stops — These Never Happen Without Explicit Permission

The following require explicit in-session confirmation, no exceptions:

- Deploying or pushing to any environment (staging, production, etc.)
- Running migrations or schema changes on any database
- Sending any email, message, or external API call to real recipients
- Executing any command with irreversible external side effects

"You mentioned this earlier" is not confirmation. Confirmation must be in the current message.

---

Maintain a file called MEMORY.md. After any significant decision, about direction, format, content, approach, or strategy, add an entry:

## [Date], [Decision]

**What was decided:** [the choice made]
**Why:** [the reasoning]
**What was rejected:** [alternatives considered and why they were ruled out]

Read MEMORY.md at the start of every session before doing anything. Never contradict a logged decision without flagging it first.

## After Every Task — Status Report

After completing any coding task, always end with:

- **Files changed:** [list every file touched]
- **What was modified:** [one line per file]
- **Files intentionally not touched:** [if relevant]
- **Follow-up needed:** [anything requiring a decision or attention]

Keep it short. This is a status update, not a recap.

---

This repository has an **early local development foundation; it is not production software**. Read [README.md](README.md), [docs/decisions.md](docs/decisions.md), [docs/product.md](docs/product.md), [docs/architecture.md](docs/architecture.md), [docs/workflows.md](docs/workflows.md), then the relevant [CHECKLIST.md](CHECKLIST.md) phase before work. Existing `client_message_extract.md`, `second_meeting_message.md`, `adress.md` and `EVIDENCES/` are client material: preserve them; do not commit or upload them without permission. Use synthetic/redacted fixtures.

## Work agreement

- Execute one bounded outcome per change: state goal, affected requirement IDs, constraints and a verifiable definition of done; note assumptions and unresolved [Dxx decisions](docs/decisions.md). Ask about business/legal/visibility rules rather than inventing them.
- Follow dependencies in [docs/delivery-plan.md](docs/delivery-plan.md); discovery runs in parallel with foundation and other independent work. Use reversible, documented assumptions where safe. Do not mark a checklist item done until code, tests and relevant review/acceptance evidence exist. Record the evidence alongside or in the linked work item. An unresolved high-priority decision blocks final acceptance of its dependent behavior, not beginning development.
- Prefer the simplest implementation consistent with the [architecture](docs/architecture.md); no generic workflow engine, unrequested microservices, payment gateway or unsanctioned carrier scraping. Make scoped diffs; do not change unrelated client files.
- Recheck current official provider docs before implementing integrations. Use stub/sandbox providers locally; do not send client samples or production secrets to coding tools or OCR without permission.
- Database schema/grants/buckets: use reviewed `supabase/migrations/` SQL only. Never alter remote production schema in dashboard, reset remote DB, or deploy from an agent session without an explicit deployment request. Keep environment credentials out of git and web bundles.
- API is authoritative for business data and permissions; client browser uses Supabase Auth only for sign-in/session. Enforce company isolation on API queries, document downloads and generated links; do not trust client-supplied roles/company IDs. Extracted document fields remain drafts until human approval. Staff record external payments only.
- For each change, add focused tests for affected rules/access boundaries, run relevant lint/typecheck/tests/build and inspect the diff; report what ran and what could not run. Review security, data migrations and user-visible changes with a human before release. Keep docs/checklist aligned with implementation.

## Planned repo and commands

Target: `apps/web` (Next.js), `apps/api` (NestJS), `apps/worker` (BullMQ), `packages/contracts`, `supabase/migrations`, `docs`. The initial `apps/web` and `apps/api` workspaces, private-schema PostgreSQL migrations, foundational staff/customer access tables, local pgTAP tests and root scripts exist; worker, contracts, the complete business schema, Redis and API authorization remain planned. Local app development currently uses SQLite behind the API database boundary. The local PostgreSQL tests do not validate Nest API/company isolation. Node.js, pnpm and Supabase CLI are pinned in the root files. Run Supabase reset and tests only against the **local** Supabase instance; never link or deploy from an agent session without an explicit request. Docker supports the local stack. Do not report commands as passed before running them.

## Completion rule

Demonstrate behavior against the acceptance row in [docs/product.md](docs/product.md) and workflow in [docs/workflows.md](docs/workflows.md); verify cross-customer denial and safe failure paths where applicable; update [CHECKLIST.md](CHECKLIST.md) only for verified work. Provide a short handoff with changed paths, test output, outstanding decision IDs and next executable step. This documentation alone is **not** authorization to start the production build.
