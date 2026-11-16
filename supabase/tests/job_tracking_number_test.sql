BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(6);

INSERT INTO auth.users (id, aud, role, email, encrypted_password)
VALUES ('00000000-0000-4000-8000-0000000000a9', 'authenticated', 'authenticated', 'tracking-test@example.test', '');
INSERT INTO app.customer_company (company_id, company_name)
VALUES ('00000000-0000-4000-8000-0000000000b9', 'Synthetic Tracking Ltd');
INSERT INTO app.job (job_id, file_number, service_line, customer_company_id, opened_by)
VALUES ('00000000-0000-4000-8000-0000000000c9', 'BJH/SI/2099/0009', 'sea_import',
        '00000000-0000-4000-8000-0000000000b9', '00000000-0000-4000-8000-0000000000a9');
INSERT INTO app.job (job_id, file_number, service_line, customer_company_id, opened_by)
VALUES ('00000000-0000-4000-8000-0000000000c8', 'BJH/SI/2099/0008', 'sea_import',
        '00000000-0000-4000-8000-0000000000b9', '00000000-0000-4000-8000-0000000000a9');

SELECT extensions.matches(
  (SELECT tracking_number FROM app.job WHERE job_id = '00000000-0000-4000-8000-0000000000c9'),
  '^BJH-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$',
  'a new job gets a tracking number in the BJH-XXXX-XXXX format'
);
SELECT extensions.isnt(
  (SELECT tracking_number FROM app.job WHERE job_id = '00000000-0000-4000-8000-0000000000c9'),
  (SELECT tracking_number FROM app.job WHERE job_id = '00000000-0000-4000-8000-0000000000c8'),
  'two jobs get different tracking numbers'
);
SELECT extensions.ok(
  (SELECT tracking_number NOT LIKE '%' || replace(file_number, '/', '-') || '%'
   FROM app.job WHERE job_id = '00000000-0000-4000-8000-0000000000c9'),
  'the tracking number is not derived from the sequential file number'
);
SELECT extensions.throws_ok(
  $$UPDATE app.job SET tracking_number = 'BJH-AAAA-AAAA'
    WHERE job_id = '00000000-0000-4000-8000-0000000000c9'$$,
  'P0001',
  'job identity fields are immutable',
  'a tracking number cannot be changed once given'
);
SELECT extensions.throws_ok(
  $$INSERT INTO app.job (file_number, service_line, customer_company_id, opened_by, tracking_number)
    VALUES ('BJH/SI/2099/0007', 'sea_import', '00000000-0000-4000-8000-0000000000b9',
            '00000000-0000-4000-8000-0000000000a9', 'BJH-0O1I-LLLL')$$,
  '23514',
  NULL,
  'a tracking number with look-alike characters is refused'
);
SELECT extensions.ok(
  NOT has_function_privilege('anon', 'app.generate_tracking_number()', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'app.generate_tracking_number()', 'EXECUTE'),
  'anon and authenticated cannot run the generator'
);

SELECT * FROM extensions.finish();
ROLLBACK;
