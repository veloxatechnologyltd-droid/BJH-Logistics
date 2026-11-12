-- Sales hub: the lead pool and approved outreach.
--
-- 1. A prospect can be dismissed from the pool (not a fit, or not wanted) and
--    brought back. Dismissing never deletes it, so a later search still sees it
--    as already found.
-- 2. app.outreach_draft holds the emails drafted for prospects. A draft is only
--    ever pending, approved or rejected here: nothing in this table sends mail.
--    A person approves each draft; sending is a later, separate step.
-- Staff only: row level security on, every client grant revoked (as for prospects).

ALTER TABLE app.prospect
  ADD COLUMN dismissed_at timestamptz,
  ADD COLUMN dismissed_by uuid REFERENCES auth.users (id),
  ADD CONSTRAINT prospect_dismissal_complete CHECK (
    (dismissed_at IS NULL) = (dismissed_by IS NULL)
  );

CREATE INDEX prospect_pool ON app.prospect (score DESC NULLS LAST, created_at DESC)
  WHERE dismissed_at IS NULL;

CREATE TABLE app.outreach_draft (
  draft_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prospect_id uuid NOT NULL REFERENCES app.prospect (prospect_id) ON DELETE CASCADE,
  recipient_email text NOT NULL CHECK (length(recipient_email) BETWEEN 3 AND 254),
  subject text NOT NULL CHECK (length(btrim(subject)) BETWEEN 1 AND 200),
  body text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 5000),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  -- ai: written by the model; template: the fixed wording used when no AI is set up or it failed.
  method text NOT NULL CHECK (method IN ('ai', 'template')),
  edited boolean NOT NULL DEFAULT false,
  rejected_reason text CHECK (rejected_reason IS NULL OR length(rejected_reason) BETWEEN 1 AND 500),
  created_by uuid NOT NULL REFERENCES auth.users (id),
  decided_by uuid REFERENCES auth.users (id),
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  -- A decision always has a person and a time; a pending draft has neither.
  CONSTRAINT outreach_draft_decision_complete CHECK (
    (status = 'pending') = (decided_at IS NULL)
    AND (decided_at IS NULL) = (decided_by IS NULL)
  ),
  CONSTRAINT outreach_draft_reason_only_when_rejected CHECK (
    rejected_reason IS NULL OR status = 'rejected'
  )
);

-- One open (pending or approved) draft per prospect: drafting again cannot pile up copies.
CREATE UNIQUE INDEX outreach_draft_one_open_per_prospect
  ON app.outreach_draft (prospect_id) WHERE status IN ('pending', 'approved');
CREATE INDEX outreach_draft_status ON app.outreach_draft (status, created_at DESC);

ALTER TABLE app.outreach_draft ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE app.outreach_draft FROM PUBLIC, anon, authenticated;
