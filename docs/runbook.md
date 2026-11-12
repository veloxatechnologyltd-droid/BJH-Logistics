# Release and rollback runbook

One page for the person releasing. It describes what exists today; where something does not exist yet, it says so.

## Who does what

- **Code** reaches production by merging a pull request into `main`. Render deploys the API and Vercel deploys both web apps from every commit to `main`, so **merge only when the `verify` check is green** (see "Known gaps").
- **Database migrations** are applied to production by a person, never by an agent or a host build: `corepack pnpm db:migrate:production`. It shows the pending migrations as a dry run and applies them only after typing `apply production`. It applies **every** pending migration unless told where to stop: `--to <version>` (14 digits, for example `corepack pnpm db:migrate:production --to 20261102000100`) lists and applies only the migrations up to and including that one. Read the dry-run list first either way.

## Releasing a change

1. Pull request reviewed, `verify` green. Note any new files in `supabase/migrations/`.
2. **If there is a migration, apply it first**, then merge. The API must keep working on the old schema until the migration runs, and the migration must keep the old API working (see "Changing the schema").
3. Merge. Render and Vercel deploy on their own (a few minutes).
4. Check: the API health endpoint (`/api/health`) returns `ok` with `database: ok`, both Vercel deployments show success for the commit, then open the staff app and do the one thing the change was about.
5. Anything unexpected: roll back (below), then investigate.

## Rolling back

- **API (Render):** open the service, then Deploys, pick the last good deploy and choose Rollback. This is quick and does not touch the database.
- **Staff app and website (Vercel):** open the project, then Deployments, and promote the last good deployment to production (Instant Rollback). Do this for each app that changed.
- **Reverting the commit** in git is the permanent fix; a rollback in a dashboard is only a pause. Revert on a branch and merge it the normal way.
- **The database does not roll back.** Migrations are forward-only. If a migration was wrong, write a new migration that fixes it; do not edit one that has been applied.

## Changing the schema safely (expand, then contract)

The API and the schema are released at different moments, so every step must work with the code on either side of it.

- **Add** (a column, table or index): safe to apply before the code that uses it. Make new columns nullable or give them a default.
- **Change or remove**: first release code that no longer needs the old shape, wait until it is live, and only then drop or tighten it in a later migration.
- Never rename in one step: add the new name, move the code and data, then drop the old name later.

## CRM visibility (`CRM_ACCESS`)

The CRM (Sales hub, campaigns, Email) is controlled by one API variable, set in the Render dashboard and applied when the API restarts:

- `admin` (the default, also when unset): only the super admin sees it. Everyone else gets "not found" from the API and no Sales menu item.
- `everyone`: sales, customer service and the super admin.
- `off`: nobody, the super admin included; the lead-search and mailbox background work also stops.

The public unsubscribe link works in every mode. Mail sending and mailbox sync stay separately opt-in (`OUTREACH_SEND_WORKER`, `OUTREACH_MAILBOX_SYNC`).

## Sales Email workspace rollout

The Sales Email code and migrations are local work and have **not** been deployed or applied to production. Production migration and deployment remain separate, explicitly authorized actions.

1. Before release, review the production migration dry run and confirm the pending sequence includes the dependencies required by this branch: `20261113000000`, `20261114000000`, `20261115000000`, `20261116000000`, `20261117000000`, and `20261118000000` through `20261118000500`. `--to 20261118000500` still applies every earlier pending migration; inspect the full dry-run list and stop if it contains unrelated work. Take and verify the required pre-migration backup first.
2. Configure the API service's server-only settings from `.env.example`: dedicated `EMAIL_OUTREACH_SMTP_*` and `INBOUND_OUTREACH_IMAP_*` values, `PUBLIC_API_URL` ending in `/api`, and a stable 32-byte hex `OUTREACH_UNSUBSCRIBE_KEY`. Do not put these values in either web app. Confirm the private `job-documents` Storage bucket is available to the API service role.
3. Keep `OUTREACH_SEND_WORKER=off` and `OUTREACH_MAILBOX_SYNC=off`. An authorized operator applies the reviewed migrations before merging/deploying the API code. Check API and both web deployments, database health, staff role access, and Business Settings before enabling either worker.
4. Enable mailbox sync by itself. Confirm the read-only import discovers expected folders, stores incoming and sent messages, resumes from cursors, does not mark messages read, and exposes attachment metadata/downloads to authorized staff. The database advisory lock prevents parallel API instances from syncing at the same time. Turn sync off if imports fail repeatedly or attachment storage is unavailable.
5. Configure the mailbox daily cap, per-campaign daily cap and minimum gap in Business Settings before any send worker is enabled. Review a synthetic recipient preview and confirm suppression behavior. Test SMTP acceptance and public unsubscribe handling only in a separately authorized controlled test; provider acceptance is not proof of delivery.
6. Enable `OUTREACH_SEND_WORKER=on` only after the provider, unsubscribe URL/key, limits and human approval flow pass the controlled acceptance. Monitor queued, accepted, failed and unknown statuses. Do not retry `unknown` messages; a stale attempt is finalized as unknown after ten minutes to avoid duplicates.

**Emergency stop:** set both worker variables to `off` on the API service and restart it. This stops future mailbox sync and SMTP claims; it does not undo a provider handoff already in progress. Keep the database migration and roll back application code using the normal procedure above; migrations are forward-only.

**Still required before production use:** backup and restore evidence, a security review, controlled real-mail/provider acceptance, production staff browser acceptance, and monitoring/alerting. This runbook does not authorize any production action.

## Switching things off

All on the API service in Render; the service restarts after a change.

- **AI features:** remove `ANTHROPIC_API_KEY` and `OPENAI_API_KEY`. Bra Evans, the email assistant and document reading stop; everything else works.
- **Automatic email replies to quote requests:** set `ASSISTANT_AUTO_REPLY` to anything other than `on`.
- **Reading the mailbox:** remove `INBOUND_IMAP_HOST` (or the user or password).
- **Sales Email:** set `OUTREACH_SEND_WORKER=off` and `OUTREACH_MAILBOX_SYNC=off`; restart the API service. This does not recall mail already handed to SMTP.
- **Email and website-form intake:** remove `INBOUND_EMAIL_SECRET` (intake is off without it; the website quote form then reports an error to visitors).
- **Notifications on staff devices (Web Push):** remove `VAPID_PRIVATE_KEY` (or the public key or subject). Nothing is sent and browsers are no longer offered them; subscriptions stay saved and work again when the same keys return.

## Notifications that arrive with BJH closed (Web Push)

Staff turn them on from the banner under the top bar (or Team chat), on each device. A subscription belongs to one person and one browser; signing out removes it. The API sends one push per event, per subscription: a Team chat message goes to everyone else in that conversation (a team channel goes to the holders of that team's roles and the super admin), a client's chat message to customer service and the super admin, a new emailed or portal quote request or inquiry to customer service, the super admin and (quote requests) sales, and support tickets to the super admin. The browser shows one notification per conversation and counts further messages. Customers are not offered it.

- **First release, in this order:** (1) apply `20261104000200_push_subscription.sql` to production (`db:migrate:production`, which needs an explicit go); (2) on the API service in Render set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` (see `.env.example`); (3) release the API, then the staff app. The migration must be live before the API that reads it.
- **Check once after release:** sign in, accept the banner, send a Team chat message from another account with BJH closed, and look at the browser console for Content Security Policy messages. The staff app's policy names `worker-src 'self'` for `/sw.js`.
- **It only reaches devices that are on.** A browser that is fully closed on a computer, or a phone with notifications off for the browser, will not show it until the device is back (messages wait up to a day at the push service). iPhones receive notifications only from the app added to the Home Screen.
- **A person who stops getting them:** the browser or phone may have blocked the site, the subscription may have expired (the API deletes one the push service reports gone), or their roles may have been removed (suspended staff are never sent to). Turning them on again from the banner fixes the first two.
- **Not covered yet:** reminders and overdue notices, vehicle expiry notices, job assignments, and customers.

## After a change to `render.yaml`

The API service is Blueprint-managed. Render applies `render.yaml` to the service when it reaches `main` (plan, environment values, health path, build and start commands), as an extra deploy of the same commit. On 2 November 2026 that deploy was followed by 15 minutes of 502 on the public address while the dashboard showed the service Live and the logs were healthy. A plain redeploy cleared it.

- After merging such a change, watch `https://<api-host>/api/health` from outside until it answers `ok`; do not rely on the dashboard.
- If the address returns 502 (the header `x-render-routing: dynamic-paid-error`) but Render's logs show health checks returning 200, use **Manual Deploy, Deploy latest commit** before anything else. No rollback is needed.
- Check what the service's dashboard settings are before editing a Blueprint-managed field: the file wins on the next sync.

## The staff app's Content Security Policy

`apps/web/proxy.ts` gives every page request its own nonce and a policy that lets scripts run only with that nonce, and lets the page connect only to itself, the API and Supabase (`apps/web/app/security/contentSecurityPolicy.ts`). Because the nonce is per request, every page is rendered on demand (`app/layout.tsx`). The API and Supabase addresses come from `NEXT_PUBLIC_API_BASE_URL` and `NEXT_PUBLIC_SUPABASE_URL` **at build time**.

- A new feature that must talk to another address (a new API host, analytics, a map) needs that origin added to `connect-src`, or the browser blocks it. The symptom is a console message "violates the following Content Security Policy directive" and a request that never leaves.
- After any release that touches the staff app, open it, sign in, and look at the browser console once: it should show no such messages.
- To switch it off in an emergency, delete `apps/web/proxy.ts` and redeploy (or roll back in Vercel); the fixed headers in `next.config.ts` stay.
- The public website has no nonce policy: it is static, and a nonce would make every page render per request.

## Known gaps (as of 2 November 2026)

- `main` is not yet a protected branch and Render deploys on every commit, passing or not. The fix is branch protection with `verify` required, and Render's `autoDeployTrigger: checksPass`.
- **There is no tested backup and restore.** Until there is, a bad data change cannot be undone from a backup. Set up backups and do one restore test before relying on this runbook for data problems.
- There is no error monitoring or uptime alert; a failed deploy or a down API is noticed by a person.
- The API connects to the database as `postgres`; a least-privilege role is still to do.
- The jobs list has no pagination: the dashboard, shipping documents, document library and customer profile count from the full list, so a cap would make their numbers wrong. A search that runs over 20 seconds is stopped with a message to narrow it. Pagination needs server-side counts and "load more" screens.
- `.env` in a developer's checkout holds the production database address (the migration script reads it), so any command run with `dotenv -e .env` touches production.
