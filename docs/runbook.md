# Release and rollback runbook

One page for the person releasing. It describes what exists today; where something does not exist yet, it says so.

## Who does what

- **Code** reaches production by merging a pull request into `main`. Render deploys the API and Vercel deploys both web apps from every commit to `main`, so **merge only when the `verify` check is green** (see "Known gaps").
- **Database migrations** are applied to production by a person, never by an agent or a host build: `corepack pnpm db:migrate:production`. It shows the pending migrations as a dry run and applies them only after typing `apply production`. It applies **every** pending migration; read the dry-run list first.

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

## Switching things off

All on the API service in Render; the service restarts after a change.

- **AI features:** remove `ANTHROPIC_API_KEY` and `OPENAI_API_KEY`. Bra Evans, the email assistant and document reading stop; everything else works.
- **Automatic email replies to quote requests:** set `ASSISTANT_AUTO_REPLY` to anything other than `on`.
- **Reading the mailbox:** remove `INBOUND_IMAP_HOST` (or the user or password).
- **Email and website-form intake:** remove `INBOUND_EMAIL_SECRET` (intake is off without it; the website quote form then reports an error to visitors).

## Known gaps (as of 2 November 2026)

- `main` is not yet a protected branch and Render deploys on every commit, passing or not. The fix is branch protection with `verify` required, and Render's `autoDeployTrigger: checksPass`.
- **There is no tested backup and restore.** Until there is, a bad data change cannot be undone from a backup. Set up backups and do one restore test before relying on this runbook for data problems.
- There is no error monitoring or uptime alert; a failed deploy or a down API is noticed by a person.
- The API connects to the database as `postgres`; a least-privilege role is still to do.
