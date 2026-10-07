# BJH Logistics operations platform

Status: **local development foundation**. The repository has a minimal Next.js web app and NestJS API workspace. The API requires `DATABASE_URL`; `pnpm supabase:dev` starts the apps against local Supabase Auth and PostgreSQL, where the current slice persists quote requests, customer company/contact records, staff-selected request-to-company links, quote drafts/revisions, staff roles/audit history, customer-company memberships, and manual request-to-department assignments. Customer users are scoped to assigned companies; department reps can read the shared customer directory and quote-request inbox, while only reps in the assigned department can read and revise linked request drafts. Super admins control assignments and review departmental work; drafts are not issued. Synthetic API tests on local PostgreSQL and an opt-in live local PostgreSQL/Nest test cover these access rules. Jobs, shipments, invoices, receipts and documents remain incomplete. Supabase PostgreSQL remains the production target; local tests do not verify hosted settings or production isolation.

The product is a job-file system for a Ghana-based freight forwarder: quotations, import/export clearance, air/sea shipments, trucking, warehouse services, billing records, documents, staff tasks, client updates, and a client portal. **Staff record external payments; the app does not take payments.** Client messages use **email and SMS** for the initial production release; WhatsApp is a later enhancement.

## Reading order

1. [Client-friendly questions](questions.md) to share with the client, then [internal decision register](docs/decisions.md) for tracking answers before implementing dependent features.
2. [Product requirements and acceptance criteria](docs/product.md) — what the system must do and for whom.
3. [Operational workflows](docs/workflows.md) — job milestones and closure rules.
4. [Architecture and target repo layout](docs/architecture.md) — Next.js + NestJS + Supabase PostgreSQL/Auth/Storage.
5. [Data model](docs/data-model.md), [document template blueprint](docs/document-templates.md), and [integrations](docs/integrations.md).
6. [Security and operations](docs/security-operations.md).
7. [Agent execution guide](AGENTS.md), [delivery plan](docs/delivery-plan.md), and [master checklist](CHECKLIST.md).
8. [Research notes and primary sources](docs/research.md).

## Source material and handling

- [Initial process walkthrough](client_message_extract.md): import/export, air/sea, warehousing, road transport, documents and correspondence.
- [Second meeting notes](second_meeting_message.md): quotes-to-jobs, tracking, reminders, assignments, extraction, portal.
- `EVIDENCES/` and `adress.md`: client-provided reference material, **not** seed data or public assets. Handle as confidential; ask before copying, publishing, uploading to third-party services, or committing to a remote repository. Build tests from synthetic/redacted fixtures instead.

Where these sources are incomplete, [docs/decisions.md](docs/decisions.md) explicitly distinguishes confirmed facts from proposals and questions. The documents describe the **entire production destination**, delivered in bounded phases; an unchecked box in [CHECKLIST.md](CHECKLIST.md) is not proof of implementation.

## Local development setup

Prerequisites: Node.js `22.22.3` (also recorded in `.nvmrc`) and Corepack. The repository pins pnpm `12.6.0` in `package.json`.

```sh
corepack pnpm install
cp .env.example .env
corepack pnpm dev
```

Open the web app at <http://127.0.0.1:3002>; the API health endpoint is <http://127.0.0.1:3001/api/health>. The web dev server uses port 3002 so it can run beside the API on 3001 and avoid an existing web process on 3000. `corepack pnpm dev` starts local Supabase if needed, applies pending local migrations without resetting data, then starts both apps against local Auth/PostgreSQL. Use `corepack pnpm web:dev` to start only the web app beside an already running local API. The API refuses to start without `DATABASE_URL`. `.env` is gitignored. Apply schema changes only through `supabase/migrations/` (`pnpm supabase:prepare` applies pending local migrations).

Keep hosted database credentials server-side in `.env` and apply reviewed migrations through the controlled release process. The local development command is configured for the local Supabase stack and does not link to or migrate a hosted project.

## Hosted deployment (Render API, Vercel web)

Deployment is manual and is never run from an agent session. Apply reviewed `supabase/migrations/` to the hosted Supabase project first, through the controlled release path.

- **API on Render:** create a Blueprint from [`render.yaml`](render.yaml) (auto-deploy is off). Enter the `sync: false` values in the dashboard: `CORS_ORIGINS` and `PUBLIC_WEB_URL` (the Vercel URL), `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and optionally the email/SMS keys. Add the Supabase root CA as a secret file named `supabase-root.crt`. The API reads Render's `PORT` and binds `0.0.0.0`; Render checks `/api/health`. Do not set `SUPER_ADMIN_BOOTSTRAP_ENABLED` (it is ignored when `NODE_ENV=production`).
- **Web on Vercel:** import the repository with Root Directory `apps/web`; [`apps/web/vercel.json`](apps/web/vercel.json) installs from the workspace root and builds `@bjh/contracts` first. Set `NEXT_PUBLIC_API_BASE_URL` (`https://<render-service>.onrender.com/api`), `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. Never add the service-role key or `DATABASE_URL` to Vercel.
- In Supabase Auth, set the Site URL and redirect URLs to the Vercel address.

Open <http://127.0.0.1:3002/documents-preview> to review the synthetic quotation, draft invoice, transport-document field layout, and payment receipt. Use the browser's Print command for one preview per page. These are layout samples only: they use placeholder amounts and do not issue invoices, carrier forms, or receipts.

Run checks from the repository root with `corepack pnpm lint`, `corepack pnpm format:check`, `corepack pnpm typecheck`, `corepack pnpm test`, `corepack pnpm test:e2e`, and `corepack pnpm build`. `test` runs unit specs and `test:e2e` runs API tests against the local Supabase PostgreSQL (start it first with `pnpm supabase:start`); each test file runs in a rolled-back transaction so local data is untouched. They verify one-time super-admin bootstrap, role-guard denials, customer/quote-request validation, search, explicit linking, retrieval and restart persistence.

Track verified milestones in [CHECKLIST.md](CHECKLIST.md): its evidence log records completed commands, while unchecked Phase 1 boxes mean the broader production/foundation requirement is still incomplete. The API can use the local PostgreSQL business slice under `pnpm dev`; Nest API E2E tests run on local PostgreSQL, with one additional opt-in live isolation test.

PostgreSQL is the only database adapter; `supabase/migrations/` is the only schema source. The system covers customers and contacts, quote requests, structured quotations with PDF and client acceptance, jobs on six service lines (sea and air import/export, warehousing, road transport) with milestones, ETA, tasks, parties and references, a private document archive with search, job costing, invoices, payments and receipts, delivery waybills and proof of delivery, house B/L, air waybill and manifest documents, warehouse stock, a correspondence log, PDF text extraction with human review, a customer portal, and customer messages by email and SMS. It is a local development system, not production software: hosted deployment, monitoring, backups and MFA are still to do, and real email/SMS sending has not been exercised. Access is enforced in the API: customers see only their assigned companies, department reps see their own service lines plus the shared warehousing and road work, and the super admin sees everything (the activity log records every request). API E2E tests run on local PostgreSQL, each file in a rolled-back transaction, and `supabase:test` runs the pgTAP database tests. An opt-in live local API check is available with `BJH_POSTGRES_ACCESS_TEST=1 corepack pnpm --filter @bjh/api exec tsx --test test/postgres-company-access.integration.ts`. Do not treat local tests as production access-control proof; verified work and its evidence are in [CHECKLIST.md](CHECKLIST.md).

### Trying the system yourself

1. `corepack pnpm dev`, open <http://127.0.0.1:3002/sign-in>, and sign in with your super-admin account (the first sign-up on a fresh database claims it).
2. Optional: `corepack pnpm seed:demo` adds two clearly labelled DEMO companies with contacts, four jobs (sea import, air export, road transport, warehousing), some warehouse stock, and two demo logins to the **local** database. It needs the super admin to exist and is safe to run again.

   | Demo login (local only)      | Password            | Sees                                                                                                                          |
   | ---------------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
   | `demo.rep@example.test`      | `demo-password-123` | A sea-import representative: the sea-import jobs plus the shared warehousing and road jobs, all staff screens except Settings |
   | `demo.customer@example.test` | `demo-password-123` | A customer of DEMO Northstar Trading Ltd: the customer portal, only that company's records                                    |

   These are throwaway accounts for the local database; never create them anywhere else.

3. **Customers → open a company** to change a contact's phone number or switch its messages off. Put your own email and phone number on a demo contact to see messages arrive once email/SMS are connected (below).
4. **Settings → Customer accounts** creates a customer login (email and a password you choose) linked to a company. Sign in with it in a private window to see the customer portal: only that company's jobs, quotations, invoices, waybills and stock, and a form to ask for a quotation.
5. **Settings → Business settings** holds the issuer details, currencies, tax lines (none by default), numbering and **Customer messages: email, SMS or both**. Issue a quotation or invoice only after saving these once.
6. **Settings → Customer messages** shows everything sent, what failed and why, with a Retry button. A job's page shows its own messages and lets you send one.

Messages are only _recorded_ (a "stub", visible in the API log and the messages page) until real credentials are set in `.env` (see `.env.example`): `EMAIL_SMTP_HOST` and `EMAIL_FROM` for email through any mailbox provider, and `ARKESEL_API_KEY` with `SMS_SENDER_ID` for SMS. The links inside messages use `PUBLIC_WEB_URL`. `corepack pnpm supabase:reset` wipes the local data if you want to start again.

### Local super-admin test account

Start only the local Supabase stack; do **not** reset it to create an account:

```sh
corepack pnpm supabase:start
corepack pnpm exec supabase status
```

Run `corepack pnpm dev` and open <http://127.0.0.1:3002/sign-in>. The first authenticated local account can claim `super_admin` once; later signups cannot claim that role. Auth users and role assignments live in the local Supabase databases. Staff accounts are managed in the super-admin UI; customer-company memberships are managed through the super-admin API. Do not use a hosted Supabase URL for this test flow.

The local development command enables super-admin bootstrap for the API; bootstrap is disabled automatically when `NODE_ENV=production`. Use the sign-up form for the first local administrator, then sign in with that account to exercise the customer and quotation endpoints. The API rejects requests without a valid Supabase access token and an active local `super_admin` role.

### Optional local PostgreSQL and access-control check

Requires Docker with about 7 GB of available memory. The Supabase CLI is pinned in the workspace; the local configuration does not link or log in to a hosted project. The local `pnpm dev` workflow connects Nest to local PostgreSQL for the current quote/customer/draft and membership slice. Synthetic API E2E tests run on local PostgreSQL, and Postgres query unit tests use a mocked pool; the separate PostgreSQL RLS tests do not prove Nest API isolation against a live Postgres connection.

```sh
corepack pnpm supabase:start
corepack pnpm supabase:reset
corepack pnpm supabase:test
corepack pnpm supabase:stop
```

`supabase:reset` recreates **only the local** Supabase database and reapplies `supabase/migrations/`. `supabase:test` runs 62 pgTAP assertions covering private-schema access, company-owned records (including denial by known record ID), CRUD within each of four sea/air workflow scopes, super-admin role assignment/revocation, membership revocation, and audit visibility. Test identities are synthetic fixtures, not fixed user-to-role assignments; identities and records exist only inside a rolled-back transaction. No durable application accounts or seed records are created. These SQL tests do not exercise the Nest API. The first start downloads Supabase container images.

To exercise the Nest API against live local PostgreSQL without resetting local data, run `BJH_POSTGRES_ACCESS_TEST=1 corepack pnpm --filter @bjh/api exec tsx --test test/postgres-company-access.integration.ts`. The test reads the local database URL from the Supabase CLI, rejects non-local hosts, and rolls back all synthetic fixtures. It does not prove hosted or production isolation.
