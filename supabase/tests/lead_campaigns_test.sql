BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(41);

-- Staff only: no client role holds any grant, row level security is on, and a
-- signed-in customer's database role is refused outright.
SELECT extensions.ok(
  NOT has_table_privilege('anon', 'app.lead_campaign', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'app.lead_campaign', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'app.lead_campaign', 'INSERT')
  AND NOT has_table_privilege('authenticated', 'app.lead_campaign', 'UPDATE')
  AND NOT has_table_privilege('authenticated', 'app.lead_campaign', 'DELETE')
  AND (SELECT relrowsecurity FROM pg_class WHERE oid = 'app.lead_campaign'::regclass),
  'campaigns are private: no grants and row level security is on'
);
SELECT extensions.ok(
  NOT has_table_privilege('anon', 'app.lead_campaign_run', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'app.lead_campaign_run', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'app.lead_campaign_run', 'INSERT')
  AND NOT has_table_privilege('authenticated', 'app.lead_campaign_run', 'UPDATE')
  AND NOT has_table_privilege('authenticated', 'app.lead_campaign_run', 'DELETE')
  AND (SELECT relrowsecurity FROM pg_class WHERE oid = 'app.lead_campaign_run'::regclass),
  'campaign runs are private: no grants and row level security is on'
);
SELECT extensions.ok(
  NOT has_table_privilege('anon', 'app.prospect', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'app.prospect', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'app.prospect', 'INSERT')
  AND NOT has_table_privilege('authenticated', 'app.prospect', 'UPDATE')
  AND NOT has_table_privilege('authenticated', 'app.prospect', 'DELETE')
  AND (SELECT relrowsecurity FROM pg_class WHERE oid = 'app.prospect'::regclass),
  'prospects are private: no grants and row level security is on'
);

INSERT INTO auth.users (id, aud, role, email, encrypted_password)
VALUES
  ('00000000-0000-4000-8000-0000000005aa', 'authenticated', 'authenticated', 'campaign-staff@example.test', ''),
  ('00000000-0000-4000-8000-0000000005ab', 'authenticated', 'authenticated', 'campaign-customer@example.test', '');
INSERT INTO app.customer_company (company_id, company_name)
VALUES ('00000000-0000-4000-8000-0000000005ba', 'Synthetic Campaign Customer Ltd');
INSERT INTO app.customer_membership (company_id, user_id, granted_by)
VALUES ('00000000-0000-4000-8000-0000000005ba', '00000000-0000-4000-8000-0000000005ab', '00000000-0000-4000-8000-0000000005aa');

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-0000000005ab';
SELECT extensions.throws_ok(
  $$SELECT count(*) FROM app.lead_campaign$$, '42501', NULL,
  'a signed-in customer cannot read campaigns'
);
SELECT extensions.throws_ok(
  $$SELECT count(*) FROM app.lead_campaign_run$$, '42501', NULL,
  'a signed-in customer cannot read campaign runs'
);
SELECT extensions.throws_ok(
  $$SELECT count(*) FROM app.prospect$$, '42501', NULL,
  'a signed-in customer cannot read prospects'
);
SELECT extensions.throws_ok(
  $$INSERT INTO app.lead_campaign (name, target_service, target_industry, target_location, created_by)
    VALUES ('Customer attempt', 'Sea freight', 'Retail', 'Accra', '00000000-0000-4000-8000-0000000005ab')$$,
  '42501', NULL,
  'a signed-in customer cannot create a campaign'
);
RESET ROLE;

-- Campaigns.
INSERT INTO app.lead_campaign (campaign_id, name, target_service, target_industry, target_location, created_by)
VALUES ('00000000-0000-4000-8000-0000000005ca', 'Synthetic Retail Importers', 'Sea freight',
        'Retail importers', 'Accra, Ghana', '00000000-0000-4000-8000-0000000005aa');

SELECT extensions.is(
  (SELECT status || '/' || qualification_threshold || '/' || max_prospects || '/' || require_website
     FROM app.lead_campaign WHERE campaign_id = '00000000-0000-4000-8000-0000000005ca'),
  'active/50/50/false',
  'a new campaign starts active, threshold 50, 50 prospects, website not required'
);
SELECT extensions.throws_ok(
  $$INSERT INTO app.lead_campaign (name, target_service, target_industry, target_location, created_by, qualification_threshold)
    VALUES ('Bad threshold', 'Air freight', 'Retail', 'Accra', '00000000-0000-4000-8000-0000000005aa', 101)$$,
  '23514', NULL,
  'the qualification threshold cannot exceed 100'
);
SELECT extensions.throws_ok(
  $$INSERT INTO app.lead_campaign (name, target_service, target_industry, target_location, created_by, min_rating)
    VALUES ('Bad rating', 'Air freight', 'Retail', 'Accra', '00000000-0000-4000-8000-0000000005aa', 5.5)$$,
  '23514', NULL,
  'the minimum rating cannot exceed 5'
);
SELECT extensions.throws_ok(
  $$INSERT INTO app.lead_campaign (name, target_service, target_industry, target_location, created_by, status)
    VALUES ('Bad status', 'Air freight', 'Retail', 'Accra', '00000000-0000-4000-8000-0000000005aa', 'deleted')$$,
  '23514', NULL,
  'a campaign status must be a known one'
);
SELECT extensions.throws_ok(
  $$INSERT INTO app.lead_campaign (name, target_service, target_industry, target_location, created_by, max_prospects)
    VALUES ('Too big', 'Air freight', 'Retail', 'Accra', '00000000-0000-4000-8000-0000000005aa', 501)$$,
  '23514', NULL,
  'a campaign cannot ask for more than 500 prospects'
);
SELECT extensions.throws_ok(
  $$INSERT INTO app.lead_campaign (name, target_service, target_industry, target_location, created_by)
    VALUES ('', 'Air freight', 'Retail', 'Accra', '00000000-0000-4000-8000-0000000005aa')$$,
  '23514', NULL,
  'a campaign needs a name'
);

-- Runs.
SELECT extensions.lives_ok(
  $$INSERT INTO app.lead_campaign_run (run_id, campaign_id, target_count, created_by)
    VALUES ('00000000-0000-4000-8000-0000000005da', '00000000-0000-4000-8000-0000000005ca', 50,
            '00000000-0000-4000-8000-0000000005aa')$$,
  'a run starts queued at the queued step'
);
SELECT extensions.throws_ok(
  $$INSERT INTO app.lead_campaign_run (campaign_id, target_count, created_by)
    VALUES ('00000000-0000-4000-8000-0000000005ca', 50, '00000000-0000-4000-8000-0000000005aa')$$,
  '23505', NULL,
  'a campaign cannot have a second run waiting or in progress'
);
SELECT extensions.throws_ok(
  $$UPDATE app.lead_campaign_run SET status = 'running'
    WHERE run_id = '00000000-0000-4000-8000-0000000005da'$$,
  '23514', NULL,
  'a running run must be on one of the working steps'
);
SELECT extensions.throws_ok(
  $$UPDATE app.lead_campaign_run SET current_step = 'searching'
    WHERE run_id = '00000000-0000-4000-8000-0000000005da'$$,
  '23514', NULL,
  'a queued run cannot be on a working step'
);
SELECT extensions.throws_ok(
  $$UPDATE app.lead_campaign_run SET claimed_at = clock_timestamp()
    WHERE run_id = '00000000-0000-4000-8000-0000000005da'$$,
  '23514', NULL,
  'a claim records who claimed it as well as when'
);
SELECT extensions.lives_ok(
  $$UPDATE app.lead_campaign_run
    SET status = 'running', current_step = 'searching', claimed_at = clock_timestamp(),
        claimed_by = 'api-1', started_at = clock_timestamp(), attempt_count = 1,
        provider_run_id = 'synthetic-provider-run'
    WHERE run_id = '00000000-0000-4000-8000-0000000005da'$$,
  'a claimed run can move to a working step'
);
SELECT extensions.throws_ok(
  $$UPDATE app.lead_campaign_run SET status = 'failed', current_step = 'failed',
      finished_at = clock_timestamp()
    WHERE run_id = '00000000-0000-4000-8000-0000000005da'$$,
  '23514', NULL,
  'a failed run must show its error'
);
SELECT extensions.throws_ok(
  $$UPDATE app.lead_campaign_run SET status = 'ready', current_step = 'ready'
    WHERE run_id = '00000000-0000-4000-8000-0000000005da'$$,
  '23514', NULL,
  'a finished run must record when it finished'
);
SELECT extensions.throws_ok(
  $$UPDATE app.lead_campaign_run SET found_count = -1
    WHERE run_id = '00000000-0000-4000-8000-0000000005da'$$,
  '23514', NULL,
  'run counts cannot be negative'
);
SELECT extensions.lives_ok(
  $$UPDATE app.lead_campaign_run
    SET status = 'failed', current_step = 'failed', error_message = 'Synthetic search failed',
        finished_at = clock_timestamp(), claimed_at = NULL, claimed_by = NULL
    WHERE run_id = '00000000-0000-4000-8000-0000000005da'$$,
  'a failed run with its error and finish time is accepted'
);
SELECT extensions.lives_ok(
  $$INSERT INTO app.lead_campaign_run (campaign_id, target_count, created_by)
    VALUES ('00000000-0000-4000-8000-0000000005ca', 50, '00000000-0000-4000-8000-0000000005aa')$$,
  'once the run is over the campaign can be run again'
);

-- Prospects.
INSERT INTO app.prospect (prospect_id, campaign_id, run_id, business_name, website, source, source_id,
                          normalized_name, normalized_domain, normalized_phone)
VALUES ('00000000-0000-4000-8000-0000000005ea', '00000000-0000-4000-8000-0000000005ca',
        '00000000-0000-4000-8000-0000000005da', 'Synthetic Retail Importers Ltd',
        'https://www.synthetic-retail.example', 'stub', 'stub-place-1',
        'synthetic retail importers', 'synthetic-retail.example', '233200000001');

SELECT extensions.is(
  (SELECT enrichment_status || '/' || cardinality(phones) || '/' || (score IS NULL)
     FROM app.prospect WHERE prospect_id = '00000000-0000-4000-8000-0000000005ea'),
  'pending/0/true',
  'a new prospect is awaiting enrichment and not yet scored'
);
SELECT extensions.throws_ok(
  $$INSERT INTO app.prospect (campaign_id, business_name, source, source_id, normalized_name)
    VALUES ('00000000-0000-4000-8000-0000000005ca', 'Same place again', 'stub', 'stub-place-1', 'same place again')$$,
  '23505', NULL,
  'the same provider place cannot be stored twice in a campaign'
);
SELECT extensions.lives_ok(
  $$INSERT INTO app.prospect (campaign_id, business_name, website, source, source_id, normalized_name, normalized_domain)
    VALUES ('00000000-0000-4000-8000-0000000005ca', 'Synthetic Retail Importers Tema Branch',
            'https://synthetic-retail.example/tema', 'stub', 'stub-place-2',
            'synthetic retail importers tema branch', 'synthetic-retail.example')$$,
  'a second place on the same website is kept, to be flagged rather than dropped'
);
SELECT extensions.lives_ok(
  $$INSERT INTO app.prospect (campaign_id, business_name, source, normalized_name)
    VALUES ('00000000-0000-4000-8000-0000000005ca', 'Synthetic No-Id One', 'stub', 'synthetic no id one'),
           ('00000000-0000-4000-8000-0000000005ca', 'Synthetic No-Id Two', 'stub', 'synthetic no id two')$$,
  'prospects without a provider id are not forced to be unique'
);
SELECT extensions.throws_ok(
  $$INSERT INTO app.prospect (campaign_id, business_name, source, source_id, normalized_name)
    VALUES ('00000000-0000-4000-8000-0000000005ca', 'Other source', 'scraper', 'x', 'other source')$$,
  '23514', NULL,
  'a prospect source must be a known provider'
);
SELECT extensions.throws_ok(
  $$UPDATE app.prospect SET score = 80
    WHERE prospect_id = '00000000-0000-4000-8000-0000000005ea'$$,
  '23514', NULL,
  'a score must come with its reason, method and time'
);
SELECT extensions.throws_ok(
  $$UPDATE app.prospect SET score = 101, score_reason = 'x', score_method = 'ai', scored_at = clock_timestamp()
    WHERE prospect_id = '00000000-0000-4000-8000-0000000005ea'$$,
  '23514', NULL,
  'a score cannot exceed 100'
);
SELECT extensions.throws_ok(
  $$UPDATE app.prospect SET duplicate_kind = 'customer'
    WHERE prospect_id = '00000000-0000-4000-8000-0000000005ea'$$,
  '23514', NULL,
  'a duplicate flag must say which record it matches'
);
SELECT extensions.lives_ok(
  $$UPDATE app.prospect
    SET duplicate_kind = 'customer', duplicate_ref = '00000000-0000-4000-8000-0000000005ba',
        duplicate_reason = 'Same website as an existing customer',
        score = 72, score_reason = 'Imports retail goods by sea', score_method = 'rules',
        scored_at = clock_timestamp()
    WHERE prospect_id = '00000000-0000-4000-8000-0000000005ea'$$,
  'a flagged and scored prospect is accepted'
);

-- Promotion to a lead, and the lead's campaign link.
SELECT extensions.lives_ok(
  $$INSERT INTO app.lead (lead_id, company_name, source, campaign_id, created_by)
    VALUES ('00000000-0000-4000-8000-0000000005fa', 'Synthetic Retail Importers Ltd', 'campaign',
            '00000000-0000-4000-8000-0000000005ca', '00000000-0000-4000-8000-0000000005aa')$$,
  'a lead can come from a campaign with the campaign source'
);
SELECT extensions.throws_ok(
  $$INSERT INTO app.lead (company_name, source, campaign_id, created_by)
    VALUES ('Synthetic Wrong Source Ltd', 'referral', '00000000-0000-4000-8000-0000000005ca',
            '00000000-0000-4000-8000-0000000005aa')$$,
  '23514', NULL,
  'a lead linked to a campaign must have the campaign source'
);
SELECT extensions.throws_ok(
  $$INSERT INTO app.lead (company_name, source, created_by)
    VALUES ('Synthetic Unknown Source Ltd', 'billboard', '00000000-0000-4000-8000-0000000005aa')$$,
  '23514', NULL,
  'an unknown lead source is still refused'
);
UPDATE app.prospect
SET promoted_lead_id = '00000000-0000-4000-8000-0000000005fa', promoted_at = clock_timestamp(),
    promoted_by = '00000000-0000-4000-8000-0000000005aa'
WHERE prospect_id = '00000000-0000-4000-8000-0000000005ea';
SELECT extensions.throws_ok(
  $$UPDATE app.prospect SET promoted_lead_id = '00000000-0000-4000-8000-0000000005fa',
      promoted_at = clock_timestamp(), promoted_by = '00000000-0000-4000-8000-0000000005aa'
    WHERE source_id = 'stub-place-2'$$,
  '23505', NULL,
  'one lead can be the promotion of only one prospect'
);

-- The home-page excerpt kept for scoring is bounded, and never an empty string.
SELECT extensions.throws_ok(
  $$UPDATE app.prospect SET website_excerpt = repeat('x', 3001) WHERE source_id = 'stub-place-2'$$,
  '23514', NULL,
  'a website excerpt over 3000 characters is refused'
);
SELECT extensions.throws_ok(
  $$UPDATE app.prospect SET website_excerpt = '' WHERE source_id = 'stub-place-2'$$,
  '23514', NULL,
  'an empty website excerpt is refused (it is null or text)'
);

-- Deleting a campaign removes its runs and prospects but never its leads.
DELETE FROM app.lead_campaign WHERE campaign_id = '00000000-0000-4000-8000-0000000005ca';
SELECT extensions.is(
  (SELECT count(*) FROM app.prospect WHERE campaign_id = '00000000-0000-4000-8000-0000000005ca')
  + (SELECT count(*) FROM app.lead_campaign_run WHERE campaign_id = '00000000-0000-4000-8000-0000000005ca'),
  0::bigint,
  'deleting a campaign removes its runs and prospects'
);
SELECT extensions.is(
  (SELECT source || '/' || (campaign_id IS NULL) FROM app.lead
     WHERE lead_id = '00000000-0000-4000-8000-0000000005fa'),
  'campaign/true',
  'the lead stays, with its campaign link cleared'
);

SELECT * FROM extensions.finish();
ROLLBACK;
