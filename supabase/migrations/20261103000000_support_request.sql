-- Support requests (Evans, 2026-11-03): staff and customers report a problem,
-- ask for a feature or ask a question from inside the app. Each request records
-- who sent it and the page they were on, and the developer is emailed. Only the
-- API reads or writes them; the super admin sees all of them and sets the status,
-- everyone else sees only their own.

CREATE TABLE app.support_request (
  support_request_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_user_id uuid NOT NULL REFERENCES auth.users (id),
  reporter_email text,
  -- 'customer' when sent from the portal, 'staff' otherwise.
  reporter_kind text NOT NULL CHECK (reporter_kind IN ('staff', 'customer')),
  -- The customer's company when they belong to exactly one; null for staff.
  company_id uuid REFERENCES app.customer_company (company_id),
  kind text NOT NULL CHECK (kind IN ('problem', 'feature', 'question')),
  description text NOT NULL CHECK (length(description) BETWEEN 1 AND 4000),
  page_path text CHECK (page_path IS NULL OR length(page_path) <= 500),
  user_agent text CHECK (user_agent IS NULL OR length(user_agent) <= 500),
  -- The last error message the person was shown, if any.
  last_error text CHECK (last_error IS NULL OR length(last_error) <= 1000),
  status text NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'in_progress', 'done')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX support_request_reporter
  ON app.support_request (reporter_user_id, created_at DESC);

CREATE INDEX support_request_company
  ON app.support_request (company_id)
  WHERE company_id IS NOT NULL;

ALTER TABLE app.support_request ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE app.support_request FROM PUBLIC, anon, authenticated;
