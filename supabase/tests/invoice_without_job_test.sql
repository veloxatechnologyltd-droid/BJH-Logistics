BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(7);

INSERT INTO auth.users (id, aud, role, email, encrypted_password)
VALUES ('00000000-0000-4000-8000-0000000004aa', 'authenticated', 'authenticated', 'nojob@example.test', '');
INSERT INTO app.customer_company (company_id, company_name)
VALUES ('00000000-0000-4000-8000-0000000004ba', 'Synthetic NoJob Ltd'),
       ('00000000-0000-4000-8000-0000000004bb', 'Synthetic Other Ltd');
INSERT INTO app.job (job_id, file_number, service_line, customer_company_id, opened_by)
VALUES ('00000000-0000-4000-8000-0000000004ca', 'BJH/SI/2099/9501', 'sea_import',
        '00000000-0000-4000-8000-0000000004ba', '00000000-0000-4000-8000-0000000004aa');

-- An invoice may have no job; it then names its own client.
INSERT INTO app.invoice (invoice_id, customer_company_id, status, currency, created_by, shipment)
VALUES ('00000000-0000-4000-8000-0000000004d0', '00000000-0000-4000-8000-0000000004ba',
        'draft', 'GHS', '00000000-0000-4000-8000-0000000004aa', '{"billOfLading":"TAOF1"}'::jsonb);
SELECT extensions.is(
  (SELECT job_id FROM app.invoice WHERE invoice_id = '00000000-0000-4000-8000-0000000004d0'),
  NULL::uuid, 'an invoice can be made with no job'
);

-- With a job and no client named, the job's client is taken.
INSERT INTO app.invoice (invoice_id, job_id, status, currency, created_by)
VALUES ('00000000-0000-4000-8000-0000000004d1', '00000000-0000-4000-8000-0000000004ca',
        'draft', 'GHS', '00000000-0000-4000-8000-0000000004aa');
SELECT extensions.is(
  (SELECT customer_company_id FROM app.invoice WHERE invoice_id = '00000000-0000-4000-8000-0000000004d1'),
  '00000000-0000-4000-8000-0000000004ba'::uuid, 'the job''s client is filled in'
);

SELECT extensions.throws_ok(
  $$INSERT INTO app.invoice (job_id, customer_company_id, status, currency, created_by)
    VALUES ('00000000-0000-4000-8000-0000000004ca', '00000000-0000-4000-8000-0000000004bb',
            'draft', 'GHS', '00000000-0000-4000-8000-0000000004aa')$$,
  NULL, 'an invoice on a job must be for the job''s client', 'a job''s invoice cannot name another client'
);

SELECT extensions.throws_ok(
  $$INSERT INTO app.invoice (status, currency, created_by)
    VALUES ('draft', 'GHS', '00000000-0000-4000-8000-0000000004aa')$$,
  '23502', NULL, 'an invoice with no job still needs a client'
);

SELECT extensions.throws_ok(
  $$UPDATE app.invoice SET customer_company_id = '00000000-0000-4000-8000-0000000004bb'
    WHERE invoice_id = '00000000-0000-4000-8000-0000000004d0'$$,
  NULL, 'invoice identity fields are immutable', 'the client of an invoice cannot change'
);

UPDATE app.invoice
SET status = 'issued', invoice_number = 'BJH/INV/2099/9501', issued_at = now(),
    issued_by = '00000000-0000-4000-8000-0000000004aa',
    lines = '[{"description":"x","amountMinor":1000,"taxable":false}]'::jsonb,
    subtotal_minor = 1000, total_minor = 1000
WHERE invoice_id = '00000000-0000-4000-8000-0000000004d0';
SELECT extensions.throws_ok(
  $$UPDATE app.invoice SET shipment = '{"billOfLading":"CHANGED"}'::jsonb
    WHERE invoice_id = '00000000-0000-4000-8000-0000000004d0'$$,
  NULL, 'an issued invoice is immutable', 'the shipment details freeze when the invoice is issued'
);

SELECT extensions.ok(
  NOT has_table_privilege('authenticated', 'app.invoice', 'SELECT'),
  'invoices stay private to the API'
);

SELECT * FROM extensions.finish();
ROLLBACK;
