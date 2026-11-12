BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(4);

SELECT extensions.ok(
  NOT has_table_privilege('anon', 'app.sales_email_send_attempt', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'app.sales_email_send_attempt', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'app.sales_email_send_attempt', 'INSERT')
  AND (SELECT relrowsecurity FROM pg_class WHERE oid = 'app.sales_email_send_attempt'::regclass),
  'send attempts are private'
);

INSERT INTO app.sales_email_message
  (email_id, direction, source, send_status, from_email, to_recipients,
   subject, body_text, send_started_at)
VALUES
  ('00000000-0000-4000-8000-0000000007ba', 'outgoing', 'platform', 'sending',
   'sales@bjhlogistics.com', '[{"email":"ledger@example.test"}]'::jsonb,
   'Synthetic ledger', 'No real email', clock_timestamp());
INSERT INTO app.sales_email_send_attempt (email_id, started_at, status)
VALUES ('00000000-0000-4000-8000-0000000007ba', clock_timestamp(), 'sending');

SELECT extensions.throws_ok(
  $$INSERT INTO app.sales_email_send_attempt (email_id, started_at, status)
    VALUES ('00000000-0000-4000-8000-0000000007ba', clock_timestamp(), 'sending')$$,
  '23505', NULL,
  'a message cannot have two active attempts'
);

UPDATE app.sales_email_send_attempt
SET status = 'failed', finished_at = clock_timestamp(), error = 'Synthetic failure'
WHERE email_id = '00000000-0000-4000-8000-0000000007ba';
INSERT INTO app.sales_email_send_attempt
  (email_id, started_at, finished_at, status)
VALUES
  ('00000000-0000-4000-8000-0000000007ba', clock_timestamp(), clock_timestamp(), 'accepted');

SELECT extensions.is(
  (SELECT count(*)::int FROM app.sales_email_send_attempt
   WHERE email_id = '00000000-0000-4000-8000-0000000007ba'),
  2,
  'completed attempts remain after a later retry'
);

SET LOCAL ROLE authenticated;
SELECT extensions.throws_ok(
  $$SELECT count(*) FROM app.sales_email_send_attempt$$,
  '42501', NULL,
  'authenticated browser roles cannot read attempt history'
);
RESET ROLE;

SELECT extensions.finish();
ROLLBACK;
