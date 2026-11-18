BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(5);

INSERT INTO auth.users (id, aud, role, email, encrypted_password)
VALUES ('00000000-0000-4000-8000-0000000000a9', 'authenticated', 'authenticated', 'perf-form-test@example.test', '');

SELECT extensions.lives_ok(
  $$INSERT INTO app.performance_report
      (author_user_id, team_key, period, period_start, new_count, completed_count,
       overdue_count, department, job_updates)
    VALUES ('00000000-0000-4000-8000-0000000000a9', 'operations', 'daily', '2099-01-07',
      0, 0, 0, 'documentation',
      '[{"client": "Synthetic Ltd", "workDone": "Filed", "nextAction": "None", "status": "completed"}]')$$,
  'a daily report stores its department and job updates'
);
SELECT extensions.throws_ok(
  $$INSERT INTO app.performance_report
      (author_user_id, team_key, period, period_start, new_count, completed_count,
       overdue_count, department)
    VALUES ('00000000-0000-4000-8000-0000000000a9', 'operations', 'daily', '2099-01-07',
      0, 0, 0, 'marketing')$$,
  '23514', NULL,
  'the department must be one of the seven'
);
SELECT extensions.throws_ok(
  $$INSERT INTO app.performance_report
      (author_user_id, team_key, period, period_start, new_count, completed_count,
       overdue_count, job_updates)
    VALUES ('00000000-0000-4000-8000-0000000000a9', 'operations', 'daily', '2099-01-07',
      0, 0, 0, '[]')$$,
  '23514', NULL,
  'job updates cannot be an empty list'
);
SELECT extensions.lives_ok(
  $$INSERT INTO app.performance_report
      (author_user_id, team_key, period, period_start, new_count, completed_count,
       overdue_count, opening_active, closing_active, kpi_target, kpi_actual, kpi_action)
    VALUES ('00000000-0000-4000-8000-0000000000a9', 'operations', 'weekly', '2099-01-05',
      2, 1, 0, 3, 4, '95%', '90%', 'Book trucks earlier')$$,
  'a weekly review stores its workload and department figure'
);
SELECT extensions.throws_ok(
  $$INSERT INTO app.performance_report
      (author_user_id, team_key, period, period_start, new_count, completed_count,
       overdue_count, opening_active)
    VALUES ('00000000-0000-4000-8000-0000000000a9', 'operations', 'weekly', '2099-01-12',
      0, 0, 0, -1)$$,
  '23514', NULL,
  'workload totals cannot be negative'
);

SELECT * FROM extensions.finish();
ROLLBACK;
