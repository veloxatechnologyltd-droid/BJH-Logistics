-- A person may send more than one report for a day or a week (Evans,
-- 2026-11-18: "they should still be able to add reports"). The roster still
-- counts a person as reported once they have sent at least one.

ALTER TABLE app.performance_report
  DROP CONSTRAINT performance_report_once;

CREATE INDEX performance_report_author
  ON app.performance_report (author_user_id, period, period_start, created_at DESC);
