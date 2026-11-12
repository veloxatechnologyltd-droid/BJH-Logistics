BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(4);

SELECT extensions.ok(
  NOT has_table_privilege('anon', 'app.sales_email_send_request', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'app.sales_email_send_request', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'app.sales_email_send_request', 'INSERT')
  AND (SELECT relrowsecurity FROM pg_class WHERE oid = 'app.sales_email_send_request'::regclass),
  'send request receipts are private'
);

INSERT INTO auth.users (id, aud, role, email, encrypted_password)
VALUES ('00000000-0000-4000-8000-0000000007aa', 'authenticated',
        'authenticated', 'synthetic-sender@example.test', '');
INSERT INTO app.sales_email_send_request (request_id, created_by, payload_hash, queued_count)
VALUES ('00000000-0000-4000-8000-0000000007ab',
        '00000000-0000-4000-8000-0000000007aa', repeat('a', 64), 1);

INSERT INTO app.sales_email_message
  (email_id, direction, source, send_status, from_email, to_recipients,
   subject, body_text, created_by, send_request_id)
VALUES
  ('00000000-0000-4000-8000-0000000007ac', 'outgoing', 'platform', 'queued',
   'sales@bjhlogistics.com', '[{"email":"person@example.test"}]'::jsonb,
   'Synthetic', 'No real email', '00000000-0000-4000-8000-0000000007aa',
   '00000000-0000-4000-8000-0000000007ab');

SELECT extensions.throws_ok(
  $$INSERT INTO app.sales_email_message
      (email_id, direction, source, send_status, from_email, to_recipients,
       subject, body_text, created_by, send_request_id)
    VALUES ('00000000-0000-4000-8000-0000000007ad', 'outgoing', 'platform',
      'queued', 'sales@bjhlogistics.com',
      '[{"email":"PERSON@example.test"}]'::jsonb, 'Synthetic',
      'No real email', '00000000-0000-4000-8000-0000000007aa',
      '00000000-0000-4000-8000-0000000007ab')$$,
  '23505', NULL,
  'one send request cannot queue the same recipient twice'
);

SELECT extensions.throws_ok(
  $$INSERT INTO app.sales_email_message
      (email_id, direction, source, send_status, from_email, to_recipients,
       subject, body_text, created_by, send_request_id)
    VALUES ('00000000-0000-4000-8000-0000000007ae', 'outgoing', 'platform',
      'queued', 'sales@bjhlogistics.com', '[{"email":"other@example.test"}]'::jsonb,
      'Synthetic', 'No real email', '00000000-0000-4000-8000-0000000007aa',
      '00000000-0000-4000-8000-0000000007af')$$,
  '23503', NULL,
  'queued message must reference a real send request'
);

SET LOCAL ROLE authenticated;
SELECT extensions.throws_ok(
  $$SELECT count(*) FROM app.sales_email_send_request$$,
  '42501', NULL,
  'authenticated browser roles cannot read send receipts'
);
RESET ROLE;

SELECT extensions.finish();
ROLLBACK;
