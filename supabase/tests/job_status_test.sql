BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(8);

SELECT extensions.has_table('app', 'job_status_history', 'status history table exists');
SELECT extensions.ok(
  NOT has_table_privilege('anon', 'app.job_status_history', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'app.job_status_history', 'SELECT'),
  'anon and authenticated cannot read status history'
);

INSERT INTO auth.users (id, aud, role, email, encrypted_password)
VALUES ('00000000-0000-4000-8000-0000000000a4', 'authenticated', 'authenticated', 'status-test@example.test', '');
INSERT INTO app.customer_company (company_id, company_name)
VALUES ('00000000-0000-4000-8000-0000000000b4', 'Synthetic Status Ltd');
INSERT INTO app.job (job_id, file_number, service_line, customer_company_id, opened_by)
VALUES ('00000000-0000-4000-8000-0000000000c4', 'BJH/SI/2099/0004', 'sea_import',
        '00000000-0000-4000-8000-0000000000b4', '00000000-0000-4000-8000-0000000000a4');

SELECT extensions.lives_ok(
  $$UPDATE app.job SET status = 'ready_to_close'
    WHERE job_id = '00000000-0000-4000-8000-0000000000c4'$$,
  'a job can move to ready_to_close without a close date'
);
SELECT extensions.throws_ok(
  $$UPDATE app.job SET status = 'closed'
    WHERE job_id = '00000000-0000-4000-8000-0000000000c4'$$,
  '23514',
  NULL,
  'closing requires a close date'
);
SELECT extensions.lives_ok(
  $$UPDATE app.job SET status = 'closed', closed_at = now()
    WHERE job_id = '00000000-0000-4000-8000-0000000000c4'$$,
  'a job can be closed with a close date'
);
SELECT extensions.throws_ok(
  $$UPDATE app.job SET status = 'in_progress'
    WHERE job_id = '00000000-0000-4000-8000-0000000000c4'$$,
  '23514',
  NULL,
  'reopening must clear the close date'
);
SELECT extensions.lives_ok(
  $$INSERT INTO app.job_status_history (job_id, from_status, to_status, reason, changed_by)
    VALUES ('00000000-0000-4000-8000-0000000000c4', 'closed', 'in_progress', 'client query',
            '00000000-0000-4000-8000-0000000000a4')$$,
  'a status change can be recorded'
);
SELECT extensions.throws_ok(
  $$DELETE FROM app.job_status_history$$,
  'job status history is append-only',
  'status history cannot be deleted'
);

SELECT * FROM extensions.finish();
ROLLBACK;
