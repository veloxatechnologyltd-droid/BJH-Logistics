BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(18);

SELECT extensions.ok(
  NOT has_table_privilege('anon', 'app.job_charge', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'app.job_charge_actual', 'SELECT')
  AND (SELECT relrowsecurity FROM pg_class WHERE oid = 'app.job_charge'::regclass)
  AND (SELECT relrowsecurity FROM pg_class WHERE oid = 'app.job_charge_actual'::regclass),
  'charges are private: no grants and row level security is on'
);

INSERT INTO auth.users (id, aud, role, email, encrypted_password)
VALUES ('00000000-0000-4000-8000-0000000000a8', 'authenticated', 'authenticated', 'charges-test@example.test', '');
INSERT INTO app.customer_company (company_id, company_name)
VALUES ('00000000-0000-4000-8000-0000000000b8', 'Synthetic Charges Ltd');
INSERT INTO app.job (job_id, file_number, service_line, customer_company_id, opened_by)
VALUES ('00000000-0000-4000-8000-0000000000c8', 'BJH/SI/2099/8001', 'sea_import',
        '00000000-0000-4000-8000-0000000000b8', '00000000-0000-4000-8000-0000000000a8'),
       ('00000000-0000-4000-8000-0000000000c9', 'BJH/SI/2099/8002', 'sea_import',
        '00000000-0000-4000-8000-0000000000b8', '00000000-0000-4000-8000-0000000000a8');
INSERT INTO app.document (document_id, job_id, document_type, created_by)
VALUES ('00000000-0000-4000-8000-0000000000d8', '00000000-0000-4000-8000-0000000000c8',
        'supplier_invoice', '00000000-0000-4000-8000-0000000000a8'),
       ('00000000-0000-4000-8000-0000000000d9', '00000000-0000-4000-8000-0000000000c8',
        'commercial_invoice', '00000000-0000-4000-8000-0000000000a8'),
       ('00000000-0000-4000-8000-0000000000da', '00000000-0000-4000-8000-0000000000c9',
        'supplier_invoice', '00000000-0000-4000-8000-0000000000a8');
INSERT INTO app.job_charge (charge_id, job_id, kind, description, currency, unit_quoted_minor, created_by)
VALUES ('00000000-0000-4000-8000-0000000000e8', '00000000-0000-4000-8000-0000000000c8',
        'disbursement', 'Terminal handling', 'GHS', 50000, '00000000-0000-4000-8000-0000000000a8');

INSERT INTO app.quote (quote_id, service_line, customer_company_id, created_by)
VALUES ('00000000-0000-4000-8000-000000000ab8', 'sea_import',
        '00000000-0000-4000-8000-0000000000b8', '00000000-0000-4000-8000-0000000000a8');
INSERT INTO app.quote_version (version_id, quote_id, version_number, currency, title, size_labels, created_by)
VALUES ('00000000-0000-4000-8000-000000000ac8', '00000000-0000-4000-8000-000000000ab8',
        1, 'GHS', 'Synthetic container quote', ARRAY['20ft', '50ft'],
        '00000000-0000-4000-8000-0000000000a8');
INSERT INTO app.quote_line (line_id, version_id, position, description, basis, size_amounts_minor)
VALUES ('00000000-0000-4000-8000-000000000ad8', '00000000-0000-4000-8000-000000000ac8',
        0, 'Container handling', 'per_container', ARRAY[100, 300]::bigint[]);

SELECT extensions.lives_ok(
  $$INSERT INTO app.job_charge
      (charge_id, job_id, kind, description, currency, unit_quoted_minor,
       quote_line_id, quote_container_size, created_by)
    VALUES
      ('00000000-0000-4000-8000-000000000aa1', '00000000-0000-4000-8000-0000000000c8',
       'service', 'Container handling', 'GHS', 100, '00000000-0000-4000-8000-000000000ad8',
       '20ft', '00000000-0000-4000-8000-0000000000a8'),
      ('00000000-0000-4000-8000-000000000aa2', '00000000-0000-4000-8000-0000000000c8',
       'service', 'Container handling', 'GHS', 300, '00000000-0000-4000-8000-000000000ad8',
       '50ft', '00000000-0000-4000-8000-0000000000a8')$$,
  'one quote line can be imported for multiple container sizes'
);
SELECT extensions.throws_ok(
  $$INSERT INTO app.job_charge
      (job_id, kind, description, currency, unit_quoted_minor,
       quote_line_id, quote_container_size, created_by)
    VALUES ('00000000-0000-4000-8000-0000000000c8', 'service', 'Duplicate', 'GHS', 100,
       '00000000-0000-4000-8000-000000000ad8', '20FT',
       '00000000-0000-4000-8000-0000000000a8')$$,
  '23505', NULL,
  'a quote line and size combination can only be imported once'
);
SELECT extensions.throws_ok(
  $$UPDATE app.job_charge SET quote_container_size = '40ft'
    WHERE charge_id = '00000000-0000-4000-8000-000000000aa1'$$,
  'job charge fields are immutable',
  'an imported container size cannot be changed'
);

SELECT extensions.throws_ok(
  $$INSERT INTO app.job_charge (job_id, kind, description, currency, created_by)
    VALUES ('00000000-0000-4000-8000-0000000000c8', 'gift', 'x', 'GHS', '00000000-0000-4000-8000-0000000000a8')$$,
  '23514', NULL, 'a charge is a service or a disbursement'
);
SELECT extensions.throws_ok(
  $$UPDATE app.job_charge SET description = 'renamed'$$,
  'job charge fields are immutable',
  'a charge cannot be edited'
);
SELECT extensions.throws_ok(
  $$DELETE FROM app.job_charge$$,
  'job charges cannot be deleted; remove them instead',
  'a charge cannot be deleted'
);

SELECT extensions.lives_ok(
  $$INSERT INTO app.job_charge_actual (actual_id, charge_id, amount_minor, currency, converted_minor, recorded_by)
    VALUES ('00000000-0000-4000-8000-0000000000f8', '00000000-0000-4000-8000-0000000000e8',
            60000, 'GHS', 60000, '00000000-0000-4000-8000-0000000000a8')$$,
  'an actual in the charge currency is recorded without a rate'
);
SELECT extensions.throws_ok(
  $$INSERT INTO app.job_charge_actual (charge_id, amount_minor, currency, exchange_rate, converted_minor, recorded_by)
    VALUES ('00000000-0000-4000-8000-0000000000e8', 100, 'GHS', 2, 200, '00000000-0000-4000-8000-0000000000a8')$$,
  'an actual in the charge currency has no exchange rate',
  'the charge currency takes no exchange rate'
);
SELECT extensions.throws_ok(
  $$INSERT INTO app.job_charge_actual (charge_id, amount_minor, currency, converted_minor, recorded_by)
    VALUES ('00000000-0000-4000-8000-0000000000e8', 100, 'USD', 1500, '00000000-0000-4000-8000-0000000000a8')$$,
  'an unconverted actual cannot have a converted amount',
  'another currency without a rate has no converted amount'
);
SELECT extensions.lives_ok(
  $$INSERT INTO app.job_charge_actual (charge_id, amount_minor, currency, exchange_rate, converted_minor, supplier_document_id, correction_of, recorded_by)
    VALUES ('00000000-0000-4000-8000-0000000000e8', 4000, 'USD', 15.25, 61000,
            '00000000-0000-4000-8000-0000000000d8', '00000000-0000-4000-8000-0000000000f8',
            '00000000-0000-4000-8000-0000000000a8')$$,
  'a foreign-currency correction with evidence is recorded'
);
SELECT extensions.throws_ok(
  $$INSERT INTO app.job_charge_actual (charge_id, amount_minor, currency, converted_minor, supplier_document_id, recorded_by)
    VALUES ('00000000-0000-4000-8000-0000000000e8', 100, 'GHS', 100,
            '00000000-0000-4000-8000-0000000000d9', '00000000-0000-4000-8000-0000000000a8')$$,
  'evidence must be a supplier invoice or disbursement evidence on the same job',
  'evidence must be a supplier document'
);
SELECT extensions.throws_ok(
  $$INSERT INTO app.job_charge_actual (charge_id, amount_minor, currency, converted_minor, supplier_document_id, recorded_by)
    VALUES ('00000000-0000-4000-8000-0000000000e8', 100, 'GHS', 100,
            '00000000-0000-4000-8000-0000000000da', '00000000-0000-4000-8000-0000000000a8')$$,
  'evidence must be a supplier invoice or disbursement evidence on the same job',
  'evidence must belong to the same job'
);
SELECT extensions.throws_ok(
  $$UPDATE app.job_charge_actual SET amount_minor = 1$$,
  'charge actual amounts are append-only',
  'an actual cannot be edited'
);
SELECT extensions.throws_ok(
  $$DELETE FROM app.job_charge_actual$$,
  'charge actual amounts are append-only',
  'an actual cannot be deleted'
);
SELECT extensions.throws_ok(
  $$UPDATE app.job_charge SET removed_at = now(), removed_by = '00000000-0000-4000-8000-0000000000a8'$$,
  'a charge with a recorded actual amount cannot be removed',
  'a charge with an actual cannot be removed'
);

INSERT INTO app.job_charge (charge_id, job_id, kind, description, currency, created_by)
VALUES ('00000000-0000-4000-8000-0000000000e9', '00000000-0000-4000-8000-0000000000c8',
        'service', 'Spare', 'GHS', '00000000-0000-4000-8000-0000000000a8');
SELECT extensions.lives_ok(
  $$UPDATE app.job_charge SET removed_at = now(), removed_by = '00000000-0000-4000-8000-0000000000a8'
    WHERE charge_id = '00000000-0000-4000-8000-0000000000e9'$$,
  'a charge without an actual can be removed'
);
SELECT extensions.throws_ok(
  $$INSERT INTO app.job_charge_actual (charge_id, amount_minor, currency, converted_minor, recorded_by)
    VALUES ('00000000-0000-4000-8000-0000000000e9', 1, 'GHS', 1, '00000000-0000-4000-8000-0000000000a8')$$,
  'a removed charge cannot receive an actual amount',
  'a removed charge takes no actual'
);

SELECT * FROM extensions.finish();
ROLLBACK;
