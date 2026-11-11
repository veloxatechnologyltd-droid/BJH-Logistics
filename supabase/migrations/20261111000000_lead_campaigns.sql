-- Lead generation (docs/crm-lead-generation-plan.md, item 1.1): staff define a
-- campaign, a run searches for businesses, and every business found is kept as a
-- prospect. A prospect is NOT a lead: staff promote chosen ones to app.lead, which
-- then carries the campaign and the 'campaign' source. Staff only: no customer or
-- client role ever reads these tables, and the API (not this migration) decides
-- which staff roles may use them.

CREATE TABLE app.lead_campaign (
  campaign_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 160),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'archived')),
  target_service text NOT NULL CHECK (length(target_service) BETWEEN 1 AND 160),
  target_industry text NOT NULL CHECK (length(target_industry) BETWEEN 1 AND 160),
  target_location text NOT NULL CHECK (length(target_location) BETWEEN 1 AND 160),
  search_keywords text[] NOT NULL DEFAULT '{}' CHECK (cardinality(search_keywords) <= 20),
  excluded_keywords text[] NOT NULL DEFAULT '{}' CHECK (cardinality(excluded_keywords) <= 50),
  min_rating numeric(2, 1) CHECK (min_rating IS NULL OR min_rating BETWEEN 0 AND 5),
  require_website boolean NOT NULL DEFAULT false,
  ideal_customer_profile text CHECK (
    ideal_customer_profile IS NULL OR length(ideal_customer_profile) BETWEEN 1 AND 2000
  ),
  disqualifiers text CHECK (disqualifiers IS NULL OR length(disqualifiers) BETWEEN 1 AND 2000),
  qualification_threshold integer NOT NULL DEFAULT 50 CHECK (
    qualification_threshold BETWEEN 0 AND 100
  ),
  max_prospects integer NOT NULL DEFAULT 50 CHECK (max_prospects BETWEEN 1 AND 500),
  created_by uuid NOT NULL REFERENCES auth.users (id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX lead_campaign_status ON app.lead_campaign (status, created_at DESC);

-- One search run of a campaign. The API timer claims a queued run and moves it one
-- step per tick; provider_run_id / provider_dataset_id let a later tick resume a
-- search that is still running at the provider.
CREATE TABLE app.lead_campaign_run (
  run_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES app.lead_campaign (campaign_id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN (
    'queued', 'running', 'ready', 'failed', 'cancelled'
  )),
  current_step text NOT NULL DEFAULT 'queued' CHECK (current_step IN (
    'queued', 'searching', 'enriching', 'scoring', 'ready', 'failed', 'cancelled'
  )),
  target_count integer NOT NULL CHECK (target_count BETWEEN 1 AND 500),
  found_count integer NOT NULL DEFAULT 0 CHECK (found_count >= 0),
  stored_count integer NOT NULL DEFAULT 0 CHECK (stored_count >= 0),
  duplicate_count integer NOT NULL DEFAULT 0 CHECK (duplicate_count >= 0),
  qualified_count integer NOT NULL DEFAULT 0 CHECK (qualified_count >= 0),
  disqualified_count integer NOT NULL DEFAULT 0 CHECK (disqualified_count >= 0),
  failed_count integer NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
  provider_run_id text CHECK (provider_run_id IS NULL OR length(provider_run_id) BETWEEN 1 AND 200),
  provider_dataset_id text CHECK (
    provider_dataset_id IS NULL OR length(provider_dataset_id) BETWEEN 1 AND 200
  ),
  error_message text CHECK (error_message IS NULL OR length(error_message) BETWEEN 1 AND 1000),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  claimed_at timestamptz,
  claimed_by text CHECK (claimed_by IS NULL OR length(claimed_by) BETWEEN 1 AND 120),
  started_at timestamptz,
  finished_at timestamptz,
  created_by uuid NOT NULL REFERENCES auth.users (id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  -- While running the step is one of the three working steps; otherwise it equals
  -- the status, so the two columns cannot disagree.
  CONSTRAINT lead_campaign_run_step_matches_status CHECK (
    CASE WHEN status = 'running'
      THEN current_step IN ('searching', 'enriching', 'scoring')
      ELSE current_step = status
    END
  ),
  CONSTRAINT lead_campaign_run_claim_pair CHECK ((claimed_at IS NULL) = (claimed_by IS NULL)),
  CONSTRAINT lead_campaign_run_finished_when_over CHECK (
    (status IN ('ready', 'failed', 'cancelled')) = (finished_at IS NOT NULL)
  ),
  CONSTRAINT lead_campaign_run_failure_has_error CHECK (
    status <> 'failed' OR error_message IS NOT NULL
  )
);

CREATE INDEX lead_campaign_run_campaign ON app.lead_campaign_run (campaign_id, created_at DESC);
CREATE INDEX lead_campaign_run_queue ON app.lead_campaign_run (created_at) WHERE status = 'queued';
CREATE INDEX lead_campaign_run_claimed ON app.lead_campaign_run (claimed_at)
  WHERE claimed_at IS NOT NULL;
-- A campaign has at most one run waiting or in progress.
CREATE UNIQUE INDEX lead_campaign_run_one_active
  ON app.lead_campaign_run (campaign_id) WHERE status IN ('queued', 'running');

-- A business found by a search. Normalised keys support the duplicate check; a
-- match is recorded in duplicate_* for staff to see (an uncertain match is flagged,
-- not dropped, so only the provider's own id is unique here).
CREATE TABLE app.prospect (
  prospect_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES app.lead_campaign (campaign_id) ON DELETE CASCADE,
  run_id uuid REFERENCES app.lead_campaign_run (run_id) ON DELETE SET NULL,
  business_name text NOT NULL CHECK (length(business_name) BETWEEN 1 AND 200),
  website text CHECK (website IS NULL OR length(website) BETWEEN 1 AND 500),
  address text CHECK (address IS NULL OR length(address) BETWEEN 1 AND 500),
  phones text[] NOT NULL DEFAULT '{}' CHECK (cardinality(phones) <= 10),
  emails text[] NOT NULL DEFAULT '{}' CHECK (cardinality(emails) <= 10),
  rating numeric(2, 1) CHECK (rating IS NULL OR rating BETWEEN 0 AND 5),
  category text CHECK (category IS NULL OR length(category) BETWEEN 1 AND 160),
  source text NOT NULL CHECK (source IN ('google_maps', 'stub')),
  source_id text CHECK (source_id IS NULL OR length(source_id) BETWEEN 1 AND 300),
  normalized_name text NOT NULL CHECK (length(normalized_name) BETWEEN 1 AND 200),
  normalized_domain text CHECK (normalized_domain IS NULL OR length(normalized_domain) BETWEEN 1 AND 255),
  normalized_phone text CHECK (normalized_phone IS NULL OR length(normalized_phone) BETWEEN 5 AND 40),
  duplicate_kind text CHECK (duplicate_kind IN ('prospect', 'customer', 'lead')),
  duplicate_ref uuid,
  duplicate_reason text CHECK (duplicate_reason IS NULL OR length(duplicate_reason) BETWEEN 1 AND 300),
  enrichment_status text NOT NULL DEFAULT 'pending' CHECK (enrichment_status IN (
    'pending', 'email_found', 'email_missing', 'failed'
  )),
  enrichment_error text CHECK (enrichment_error IS NULL OR length(enrichment_error) BETWEEN 1 AND 500),
  enriched_at timestamptz,
  score integer CHECK (score IS NULL OR score BETWEEN 0 AND 100),
  score_reason text CHECK (score_reason IS NULL OR length(score_reason) BETWEEN 1 AND 1000),
  score_method text CHECK (score_method IN ('ai', 'rules')),
  scored_at timestamptz,
  promoted_lead_id uuid UNIQUE REFERENCES app.lead (lead_id) ON DELETE SET NULL,
  promoted_at timestamptz,
  promoted_by uuid REFERENCES auth.users (id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  -- A flagged duplicate names what it matches; an unflagged one names nothing.
  CONSTRAINT prospect_duplicate_complete CHECK (
    (duplicate_kind IS NULL) = (duplicate_ref IS NULL)
    AND (duplicate_kind IS NOT NULL OR duplicate_reason IS NULL)
  ),
  -- A score always comes with its reason, how it was worked out and when.
  CONSTRAINT prospect_score_complete CHECK (
    (score IS NULL) = (score_reason IS NULL)
    AND (score IS NULL) = (score_method IS NULL)
    AND (score IS NULL) = (scored_at IS NULL)
  ),
  CONSTRAINT prospect_promotion_complete CHECK (
    (promoted_lead_id IS NULL OR (promoted_at IS NOT NULL AND promoted_by IS NOT NULL))
  )
);

CREATE UNIQUE INDEX prospect_campaign_source_id
  ON app.prospect (campaign_id, source, source_id) WHERE source_id IS NOT NULL;
CREATE INDEX prospect_campaign_score ON app.prospect (campaign_id, score DESC NULLS LAST, created_at DESC);
CREATE INDEX prospect_run ON app.prospect (run_id) WHERE run_id IS NOT NULL;
CREATE INDEX prospect_campaign_domain ON app.prospect (campaign_id, normalized_domain)
  WHERE normalized_domain IS NOT NULL;
CREATE INDEX prospect_campaign_phone ON app.prospect (campaign_id, normalized_phone)
  WHERE normalized_phone IS NOT NULL;
CREATE INDEX prospect_campaign_name ON app.prospect (campaign_id, normalized_name);

-- A lead may come from a campaign. Deleting a campaign keeps its leads.
ALTER TABLE app.lead
  ADD COLUMN campaign_id uuid REFERENCES app.lead_campaign (campaign_id) ON DELETE SET NULL;

ALTER TABLE app.lead DROP CONSTRAINT lead_source_check;
ALTER TABLE app.lead ADD CONSTRAINT lead_source_check CHECK (source IN (
  'quote_request', 'referral', 'walk_in', 'phone', 'email', 'other', 'campaign'
));
ALTER TABLE app.lead ADD CONSTRAINT lead_campaign_has_campaign_source CHECK (
  campaign_id IS NULL OR source = 'campaign'
);

CREATE INDEX lead_by_campaign ON app.lead (campaign_id) WHERE campaign_id IS NOT NULL;

ALTER TABLE app.lead_campaign ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.lead_campaign_run ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.prospect ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE app.lead_campaign, app.lead_campaign_run, app.prospect
  FROM PUBLIC, anon, authenticated;
