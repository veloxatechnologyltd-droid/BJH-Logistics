BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(7);

INSERT INTO auth.users (id, aud, role, email, encrypted_password)
VALUES ('00000000-0000-4000-8000-0000000000a8', 'authenticated', 'authenticated', 'perf-test@example.test', '');

SELECT extensions.ok(
  NOT has_table_privilege('anon', 'app.performance_report', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'app.performance_report', 'SELECT')
  AND (SELECT relrowsecurity FROM pg_class WHERE oid = 'app.performance_report'::regclass),
  'anon and authenticated have no grants and row level security is on'
);
SELECT extensions.lives_ok(
  $$INSERT INTO app.performance_report
      (author_user_id, team_key, period, period_start, new_count, completed_count, overdue_count)
    VALUES ('00000000-0000-4000-8000-0000000000a8', 'sales', 'daily', '2099-01-07', 1, 1, 0)$$,
  'a daily report can be stored'
);
SELECT extensions.lives_ok(
  $$INSERT INTO app.performance_report
      (author_user_id, team_key, period, period_start, new_count, completed_count, overdue_count)
    VALUES ('00000000-0000-4000-8000-0000000000a8', 'sales', 'daily', '2099-01-07', 2, 0, 0)$$,
  'the same person may send another report for the same day'
);
SELECT extensions.lives_ok(
  $$INSERT INTO app.performance_report
      (author_user_id, team_key, period, period_start, new_count, completed_count, overdue_count, blockers)
    VALUES ('00000000-0000-4000-8000-0000000000a8', 'sales', 'weekly', '2099-01-05', 4, 3, 1, 'Waiting on a customs release')$$,
  'a weekly report starts on a Monday'
);
SELECT extensions.throws_ok(
  $$INSERT INTO app.performance_report
      (author_user_id, team_key, period, period_start, new_count, completed_count, overdue_count)
    VALUES ('00000000-0000-4000-8000-0000000000a8', 'sales', 'weekly', '2099-01-07', 0, 0, 0)$$,
  '23514',
  NULL,
  'a weekly report cannot start midweek'
);
SELECT extensions.throws_ok(
  $$INSERT INTO app.performance_report
      (author_user_id, team_key, period, period_start, new_count, completed_count, overdue_count)
    VALUES ('00000000-0000-4000-8000-0000000000a8', 'sales', 'daily', '2099-01-08', -1, 0, 0)$$,
  '23514',
  NULL,
  'counts cannot be negative'
);
SELECT extensions.throws_ok(
  $$INSERT INTO app.performance_report
      (author_user_id, team_key, period, period_start, new_count, completed_count, overdue_count)
    VALUES ('00000000-0000-4000-8000-0000000000a8', 'marketing', 'daily', '2099-01-09', 0, 0, 0)$$,
  '23514',
  NULL,
  'the team must be one of the four teams'
);

SELECT * FROM extensions.finish();
ROLLBACK;
