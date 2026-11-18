-- A report is written by the person, not only counted (Evans, 2026-11-18).
-- The person writes what they worked on (required for new reports; older
-- reports have none) and their plan for the next day or week. `activity` is a
-- snapshot, taken by the API when the report is sent, of what the system
-- recorded for the person in the period (results and the items behind them),
-- so the report reads the same later even if records change.

ALTER TABLE app.performance_report
  ADD COLUMN summary text
    CHECK (summary IS NULL OR length(summary) BETWEEN 1 AND 4000),
  ADD COLUMN plan text
    CHECK (plan IS NULL OR length(plan) BETWEEN 1 AND 2000),
  ADD COLUMN activity jsonb
    CHECK (activity IS NULL OR jsonb_typeof(activity) = 'object');
