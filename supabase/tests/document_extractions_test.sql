BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(7);

SELECT extensions.ok(
  NOT has_table_privilege('anon', 'app.document_extraction', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'app.document_extraction', 'INSERT')
  AND (SELECT relrowsecurity FROM pg_class WHERE oid = 'app.document_extraction'::regclass),
  'extraction drafts are private: no grants and row level security is on'
);

INSERT INTO auth.users (id, aud, role, email, encrypted_password)
VALUES ('00000000-0000-4000-8000-0000000006aa', 'authenticated', 'authenticated', 'extract-test@example.test', '');
INSERT INTO app.customer_company (company_id, company_name)
VALUES ('00000000-0000-4000-8000-0000000006ba', 'Synthetic Extract Ltd');
INSERT INTO app.job (job_id, file_number, service_line, customer_company_id, opened_by)
VALUES ('00000000-0000-4000-8000-0000000006ca', 'BJH/SI/2099/9601', 'sea_import',
        '00000000-0000-4000-8000-0000000006ba', '00000000-0000-4000-8000-0000000006aa'),
       ('00000000-0000-4000-8000-0000000006cb', 'BJH/SI/2099/9602', 'sea_import',
        '00000000-0000-4000-8000-0000000006ba', '00000000-0000-4000-8000-0000000006aa');
INSERT INTO app.document (document_id, job_id, document_type, created_by)
VALUES ('00000000-0000-4000-8000-0000000006da', '00000000-0000-4000-8000-0000000006ca',
        'bill_of_lading', '00000000-0000-4000-8000-0000000006aa');

SELECT extensions.throws_ok(
  $$INSERT INTO app.document_extraction (job_id, document_id, version_number, text_found, created_by)
    VALUES ('00000000-0000-4000-8000-0000000006cb', '00000000-0000-4000-8000-0000000006da', 1, true,
            '00000000-0000-4000-8000-0000000006aa')$$,
  'P0001', 'the document must belong to the same job', 'a draft must be for a document on the same job'
);

INSERT INTO app.document_extraction (extraction_id, job_id, document_id, version_number, text_found, fields, created_by)
VALUES ('00000000-0000-4000-8000-0000000006e0', '00000000-0000-4000-8000-0000000006ca',
        '00000000-0000-4000-8000-0000000006da', 1, true,
        '[{"key":"container","value":"CSQU3054383"}]'::jsonb, '00000000-0000-4000-8000-0000000006aa');

SELECT extensions.throws_ok(
  $$UPDATE app.document_extraction SET fields = '[]'::jsonb WHERE extraction_id = '00000000-0000-4000-8000-0000000006e0'$$,
  'P0001', 'the proposed fields of an extraction never change', 'the proposed fields never change'
);
SELECT extensions.throws_ok(
  $$UPDATE app.document_extraction SET read_by = 'claude-haiku-5-5' WHERE extraction_id = '00000000-0000-4000-8000-0000000006e0'$$,
  'P0001', 'the proposed fields of an extraction never change', 'who read a draft never changes'
);
SELECT extensions.throws_ok(
  $$UPDATE app.document_extraction SET status = 'approved' WHERE extraction_id = '00000000-0000-4000-8000-0000000006e0'$$,
  '23514', NULL, 'an approval needs its reviewer and time'
);
UPDATE app.document_extraction
SET status = 'approved', reviewed_at = now(), reviewed_by = '00000000-0000-4000-8000-0000000006aa',
    applied = '[{"key":"container","result":"added"}]'::jsonb
WHERE extraction_id = '00000000-0000-4000-8000-0000000006e0';
SELECT extensions.throws_ok(
  $$UPDATE app.document_extraction SET status = 'rejected', reviewed_at = now(),
      reviewed_by = '00000000-0000-4000-8000-0000000006aa' WHERE extraction_id = '00000000-0000-4000-8000-0000000006e0'$$,
  'P0001', 'a reviewed extraction cannot change', 'a reviewed draft is final'
);
SELECT extensions.throws_ok(
  $$DELETE FROM app.document_extraction WHERE extraction_id = '00000000-0000-4000-8000-0000000006e0'$$,
  'P0001', 'extraction drafts cannot be deleted', 'drafts cannot be deleted'
);

SELECT * FROM extensions.finish();
ROLLBACK;
