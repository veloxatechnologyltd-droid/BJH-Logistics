-- Daily and weekly performance reports (Evans, 2026-11-16). A staff member
-- reports for the current day or week: the API computes New, Completed and
-- Overdue from that person's tasks at submission and stores them as a snapshot;
-- the person adds blockers and a note. One report per person, period and
-- period start, so a day or a week cannot be reported twice.

CREATE TABLE app.performance_report (
  report_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  author_user_id uuid NOT NULL REFERENCES auth.users (id),
  team_key text NOT NULL
    CHECK (team_key IN ('sales', 'customer_service', 'operations', 'finance')),
  period text NOT NULL CHECK (period IN ('daily', 'weekly')),
  -- The day (daily) or the Monday of the week (weekly), Ghana time (UTC).
  period_start date NOT NULL,
  new_count integer NOT NULL CHECK (new_count >= 0),
  completed_count integer NOT NULL CHECK (completed_count >= 0),
  overdue_count integer NOT NULL CHECK (overdue_count >= 0),
  -- Null means no blockers.
  blockers text CHECK (blockers IS NULL OR length(blockers) BETWEEN 1 AND 2000),
  notes text CHECK (notes IS NULL OR length(notes) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT performance_report_once UNIQUE (author_user_id, period, period_start),
  CONSTRAINT performance_report_week_starts_monday
    CHECK (period = 'daily' OR extract(isodow FROM period_start) = 1)
);

CREATE INDEX performance_report_team
  ON app.performance_report (team_key, period_start DESC);

ALTER TABLE app.performance_report ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE app.performance_report FROM PUBLIC, anon, authenticated;
