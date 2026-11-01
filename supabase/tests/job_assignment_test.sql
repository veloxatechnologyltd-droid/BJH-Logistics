BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(9);

SELECT extensions.ok(
  NOT has_table_privilege('authenticated', 'app.job_assignment', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'app.invoice_acceptance', 'SELECT')
  AND (SELECT relrowsecurity FROM pg_class WHERE oid = 'app.job_assignment'::regclass)
  AND (SELECT relrowsecurity FROM pg_class WHERE oid = 'app.invoice_acceptance'::regclass),
  'assignments and acceptances are private: no grants and row level security is on'
);

INSERT INTO auth.users (id, aud, role, email, encrypted_password)
VALUES
  ('00000000-0000-4000-8000-0000000003aa', 'authenticated', 'authenticated', 'assign-a@example.test', ''),
  ('00000000-0000-4000-8000-0000000003ab', 'authenticated', 'authenticated', 'assign-b@example.test', '');
INSERT INTO app.customer_company (company_id, company_name)
VALUES ('00000000-0000-4000-8000-0000000003ba', 'Synthetic Assign Ltd');
INSERT INTO app.job (job_id, file_number, service_line, customer_company_id, opened_by)
VALUES ('00000000-0000-4000-8000-0000000003ca', 'BJH/SI/2099/9401', 'sea_import',
        '00000000-0000-4000-8000-0000000003ba', '00000000-0000-4000-8000-0000000003aa');
INSERT INTO app.invoice (invoice_id, job_id, status, currency, created_by)
VALUES ('00000000-0000-4000-8000-0000000003d0', '00000000-0000-4000-8000-0000000003ca',
        'draft', 'GHS', '00000000-0000-4000-8000-0000000003aa');
INSERT INTO app.invoice (invoice_id, job_id, invoice_number, status, currency, lines,
  subtotal_minor, total_minor, created_by, issued_at, issued_by)
VALUES ('00000000-0000-4000-8000-0000000003e0', '00000000-0000-4000-8000-0000000003ca',
        'BJH/INV/2099/9401', 'issued', 'GHS',
        '[{"description":"x","amountMinor":1000,"taxable":false}]'::jsonb, 1000, 1000,
        '00000000-0000-4000-8000-0000000003aa', now(), '00000000-0000-4000-8000-0000000003aa');

SELECT extensions.throws_ok(
  $$INSERT INTO app.invoice_acceptance (invoice_id, accepted_by, signatory_name, via)
    VALUES ('00000000-0000-4000-8000-0000000003d0', '00000000-0000-4000-8000-0000000003aa', 'Kojo', 'staff')$$,
  '23514', NULL, 'a draft invoice cannot be accepted'
);
INSERT INTO app.invoice_acceptance (invoice_id, accepted_by, signatory_name, via)
VALUES ('00000000-0000-4000-8000-0000000003e0', '00000000-0000-4000-8000-0000000003aa', 'Kojo', 'portal');
SELECT extensions.throws_ok(
  $$UPDATE app.invoice_acceptance SET signatory_name = 'Someone else'
    WHERE invoice_id = '00000000-0000-4000-8000-0000000003e0'$$,
  NULL, 'invoice acceptances are append-only', 'an acceptance cannot be changed'
);
SELECT extensions.throws_ok(
  $$DELETE FROM app.invoice_acceptance WHERE invoice_id = '00000000-0000-4000-8000-0000000003e0'$$,
  NULL, 'invoice acceptances are append-only', 'an acceptance cannot be deleted'
);

INSERT INTO app.job_assignment (assignment_id, job_id, user_id, kind, assigned_by)
VALUES ('00000000-0000-4000-8000-0000000003f0', '00000000-0000-4000-8000-0000000003ca',
        '00000000-0000-4000-8000-0000000003aa', 'lead', '00000000-0000-4000-8000-0000000003aa');
SELECT extensions.throws_ok(
  $$INSERT INTO app.job_assignment (job_id, user_id, kind, assigned_by)
    VALUES ('00000000-0000-4000-8000-0000000003ca', '00000000-0000-4000-8000-0000000003ab',
            'lead', '00000000-0000-4000-8000-0000000003aa')$$,
  '23505', NULL, 'a job has one lead at a time'
);
SELECT extensions.throws_ok(
  $$UPDATE app.job_assignment SET kind = 'assistant'
    WHERE assignment_id = '00000000-0000-4000-8000-0000000003f0'$$,
  NULL, 'a job assignment can only be removed, once', 'an assignment cannot be rewritten'
);
SELECT extensions.lives_ok(
  $$UPDATE app.job_assignment
    SET removed_at = clock_timestamp(), removed_by = '00000000-0000-4000-8000-0000000003aa'
    WHERE assignment_id = '00000000-0000-4000-8000-0000000003f0'$$,
  'an assignment can be removed'
);
SELECT extensions.throws_ok(
  $$UPDATE app.job_assignment
    SET removed_at = clock_timestamp(), removed_by = '00000000-0000-4000-8000-0000000003ab'
    WHERE assignment_id = '00000000-0000-4000-8000-0000000003f0'$$,
  NULL, 'a job assignment can only be removed, once', 'a removal is not rewritten'
);
SELECT extensions.throws_ok(
  $$DELETE FROM app.job_assignment WHERE assignment_id = '00000000-0000-4000-8000-0000000003f0'$$,
  NULL, 'job assignments are kept; remove them instead', 'an assignment is never deleted'
);

SELECT * FROM extensions.finish();
ROLLBACK;
