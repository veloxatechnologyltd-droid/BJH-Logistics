-- CRM lead generation 1.6: what the run pipeline needs beyond the 1.1 tables.
--
-- app.lead_campaign_run.next_attempt_at: the pipeline claims a run with a lease
-- (next_attempt_at = now + lease), so a run whose worker died becomes claimable
-- again when the lease runs out, and a run waiting on the search provider or on a
-- retry is simply given a later time. Same idea as the notification queue.
--
-- app.prospect.website_excerpt: the home page's words, kept between the enriching
-- and scoring steps only so the AI fit score can read them. The pipeline clears it
-- once the prospect is scored.
ALTER TABLE app.lead_campaign_run
  ADD COLUMN next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp();

CREATE INDEX lead_campaign_run_due ON app.lead_campaign_run (next_attempt_at)
  WHERE status IN ('queued', 'running');

ALTER TABLE app.prospect
  ADD COLUMN website_excerpt text CHECK (
    website_excerpt IS NULL OR length(website_excerpt) BETWEEN 1 AND 3000
  );
