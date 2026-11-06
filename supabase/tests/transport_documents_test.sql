BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(10);

SELECT extensions.ok(
  NOT has_table_privilege('anon', 'app.transport_document', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'app.transport_document', 'INSERT')
  AND (SELECT relrowsecurity FROM pg_class WHERE oid = 'app.transport_document'::regclass),
  'transport documents are private: no grants and row level security is on'
);

INSERT INTO auth.users (id, aud, role, email, encrypted_password)
VALUES ('00000000-0000-4000-8000-0000000007aa', 'authenticated', 'authenticated', 'doc-test@example.test', '');
INSERT INTO app.customer_company (company_id, company_name)
VALUES ('00000000-0000-4000-8000-0000000007ba', 'Synthetic Docs Ltd');
INSERT INTO app.job (job_id, file_number, service_line, customer_company_id, opened_by)
VALUES ('00000000-0000-4000-8000-0000000007ca', 'BJH/SI/2099/9701', 'sea_import',
        '00000000-0000-4000-8000-0000000007ba', '00000000-0000-4000-8000-0000000007aa');

INSERT INTO app.transport_document (document_id, job_id, kind, fields, created_by)
VALUES ('00000000-0000-4000-8000-0000000007e0', '00000000-0000-4000-8000-0000000007ca',
        'house_bl', '{"shipper":"Synthetic Shipper"}'::jsonb, '00000000-0000-4000-8000-0000000007aa');

SELECT extensions.throws_ok(
  $$UPDATE app.transport_document SET status = 'issued', issued_at = now(),
      issued_by = '00000000-0000-4000-8000-0000000007aa'
    WHERE document_id = '00000000-0000-4000-8000-0000000007e0'$$,
  '23514', NULL, 'an issued document needs its number'
);
UPDATE app.transport_document
SET status = 'issued', document_number = 'SYN-HBL-1', issued_at = now(),
    issued_by = '00000000-0000-4000-8000-0000000007aa'
WHERE document_id = '00000000-0000-4000-8000-0000000007e0';

SELECT extensions.throws_ok(
  $$INSERT INTO app.transport_document (job_id, kind, document_number, status, fields, created_by, issued_at, issued_by)
    VALUES ('00000000-0000-4000-8000-0000000007ca', 'house_bl', 'syn-hbl-1', 'issued', '{}'::jsonb,
            '00000000-0000-4000-8000-0000000007aa', now(), '00000000-0000-4000-8000-0000000007aa')$$,
  '23505', NULL, 'an issued number is unique per kind regardless of case'
);
SELECT extensions.lives_ok(
  $$INSERT INTO app.transport_document (job_id, kind, document_number, status, fields, created_by, issued_at, issued_by)
    VALUES ('00000000-0000-4000-8000-0000000007ca', 'house_awb', 'SYN-HBL-1', 'issued', '{}'::jsonb,
            '00000000-0000-4000-8000-0000000007aa', now(), '00000000-0000-4000-8000-0000000007aa')$$,
  'the same number can exist on a different kind of document'
);
SELECT extensions.throws_ok(
  $$UPDATE app.transport_document SET fields = '{"shipper":"Changed"}'::jsonb
    WHERE document_id = '00000000-0000-4000-8000-0000000007e0'$$,
  'P0001', 'an issued document is immutable', 'an issued document cannot be edited'
);
UPDATE app.transport_document
SET status = 'void', voided_at = now(), voided_by = '00000000-0000-4000-8000-0000000007aa',
    void_reason = 'Wrong consignee'
WHERE document_id = '00000000-0000-4000-8000-0000000007e0';
SELECT extensions.lives_ok(
  $$INSERT INTO app.transport_document (job_id, kind, document_number, status, fields, created_by, issued_at, issued_by)
    VALUES ('00000000-0000-4000-8000-0000000007ca', 'house_bl', 'SYN-HBL-1', 'issued', '{}'::jsonb,
            '00000000-0000-4000-8000-0000000007aa', now(), '00000000-0000-4000-8000-0000000007aa')$$,
  'voiding a document frees its number for the corrected one'
);
SELECT extensions.throws_ok(
  $$UPDATE app.transport_document SET fields = '{}'::jsonb
    WHERE document_id = '00000000-0000-4000-8000-0000000007e0'$$,
  'P0001', 'a voided document cannot change', 'a voided document is final'
);
SELECT extensions.throws_ok(
  $$DELETE FROM app.transport_document$$,
  'P0001', 'transport documents cannot be deleted; void them instead', 'documents cannot be deleted'
);
SELECT extensions.lives_ok(
  $$INSERT INTO app.transport_document (job_id, kind, fields, created_by)
    VALUES ('00000000-0000-4000-8000-0000000007ca', 'delivery_order', '{}'::jsonb, '00000000-0000-4000-8000-0000000007aa'),
           ('00000000-0000-4000-8000-0000000007ca', 'proof_of_delivery', '{}'::jsonb, '00000000-0000-4000-8000-0000000007aa')$$,
  'a delivery order and a proof of delivery note can be saved'
);
SELECT extensions.throws_ok(
  $$INSERT INTO app.transport_document (job_id, kind, fields, created_by)
    VALUES ('00000000-0000-4000-8000-0000000007ca', 'passport', '{}'::jsonb, '00000000-0000-4000-8000-0000000007aa')$$,
  '23514', NULL, 'an unknown kind is still refused'
);

SELECT * FROM extensions.finish();
ROLLBACK;
