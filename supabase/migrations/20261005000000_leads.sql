-- Leads: prospects BJH is trying to win. Simple stages with an optional owner
-- and next follow-up date. A won lead points at the customer company it became;
-- a lost lead keeps its reason. A lead may start from a customer quote request.

CREATE TABLE app.lead (
  lead_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name text NOT NULL CHECK (length(company_name) BETWEEN 1 AND 160),
  contact_name text CHECK (contact_name IS NULL OR length(contact_name) BETWEEN 1 AND 160),
  email text CHECK (email IS NULL OR length(email) BETWEEN 3 AND 254),
  phone text CHECK (phone IS NULL OR length(phone) BETWEEN 5 AND 40),
  source text NOT NULL DEFAULT 'other' CHECK (source IN (
    'quote_request', 'referral', 'walk_in', 'phone', 'email', 'other'
  )),
  stage text NOT NULL DEFAULT 'new' CHECK (stage IN (
    'new', 'contacted', 'quoted', 'won', 'lost'
  )),
  owner_id uuid REFERENCES auth.users (id),
  next_follow_up date,
  notes text CHECK (notes IS NULL OR length(notes) <= 2000),
  lost_reason text CHECK (lost_reason IS NULL OR length(lost_reason) BETWEEN 1 AND 500),
  quote_request_id uuid UNIQUE REFERENCES app.quote_request (request_id) ON DELETE SET NULL,
  customer_company_id uuid REFERENCES app.customer_company (company_id),
  created_by uuid NOT NULL REFERENCES auth.users (id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  stage_changed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT lead_lost_reason_matches_stage CHECK ((stage = 'lost') = (lost_reason IS NOT NULL)),
  CONSTRAINT lead_won_has_company CHECK (stage <> 'won' OR customer_company_id IS NOT NULL)
);

CREATE INDEX lead_stage ON app.lead (stage, next_follow_up NULLS LAST, created_at DESC);
CREATE INDEX lead_owner ON app.lead (owner_id) WHERE owner_id IS NOT NULL;

ALTER TABLE app.lead ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE app.lead FROM PUBLIC, anon, authenticated;
