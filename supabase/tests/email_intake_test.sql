BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(13);

SELECT extensions.ok(
  NOT has_table_privilege('anon', 'app.inbound_email', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'app.inbound_email', 'INSERT')
  AND NOT has_table_privilege('authenticated', 'app.inbound_email_attachment', 'SELECT')
  AND (SELECT relrowsecurity FROM pg_class WHERE oid = 'app.inbound_email'::regclass)
  AND (SELECT relrowsecurity FROM pg_class WHERE oid = 'app.inbound_email_attachment'::regclass),
  'inbound emails and their attachments are private: no grants and row level security is on'
);

INSERT INTO auth.users (id, aud, role, email, encrypted_password)
VALUES ('00000000-0000-4000-8000-0000000005aa', 'authenticated', 'authenticated', 'intake-test@example.test', '');

INSERT INTO app.inbound_email (email_id, message_id, from_email, subject, body_text, received_at)
VALUES ('00000000-0000-4000-8000-0000000005b1', '<synthetic-1@example.test>',
        'sender@example.test', 'Quote please', 'Two 40ft containers from Shanghai to Tema', now());

SELECT extensions.is(
  (SELECT extraction_status FROM app.inbound_email
   WHERE email_id = '00000000-0000-4000-8000-0000000005b1'),
  'pending',
  'a new email waits to be read'
);

SELECT extensions.throws_ok(
  $$INSERT INTO app.inbound_email (message_id, from_email, body_text, received_at)
    VALUES ('<synthetic-1@example.test>', 'other@example.test', 'again', now())$$,
  '23505', NULL,
  'the same Message-ID cannot become a second email'
);

SELECT extensions.throws_ok(
  $$UPDATE app.inbound_email SET extraction_status = 'failed'
    WHERE email_id = '00000000-0000-4000-8000-0000000005b1'$$,
  '23514', NULL,
  'a failed reading must say why'
);

SELECT extensions.lives_ok(
  $$UPDATE app.inbound_email
    SET extraction_status = 'failed', extraction_error = 'The AI service is busy'
    WHERE email_id = '00000000-0000-4000-8000-0000000005b1'$$,
  'a failed reading with its reason is accepted'
);

INSERT INTO app.quote_request (request_id, company_name, contact_name, email, message, inbound_email_id, source)
VALUES ('00000000-0000-4000-8000-0000000005c1', 'Sender Co', 'Sender', 'sender@example.test',
        'Two 40ft containers from Shanghai to Tema', '00000000-0000-4000-8000-0000000005b1', 'email');

SELECT extensions.is(
  (SELECT details::text FROM app.quote_request
   WHERE request_id = '00000000-0000-4000-8000-0000000005c1'),
  '{}',
  'a request starts with no details'
);

SELECT extensions.throws_ok(
  $$UPDATE app.quote_request SET reviewed_at = now()
    WHERE request_id = '00000000-0000-4000-8000-0000000005c1'$$,
  '23514', NULL,
  'a review records who checked it, not only when'
);

INSERT INTO app.quote_request (request_id, company_name, contact_name, email, message)
VALUES ('00000000-0000-4000-8000-0000000005c2', 'Form Co', 'Form', 'form@example.test', 'From the form');

SELECT extensions.throws_ok(
  $$UPDATE app.quote_request SET source = 'email'
    WHERE request_id = '00000000-0000-4000-8000-0000000005c2'$$,
  '23514', NULL,
  'an email or website source needs an email behind the request'
);

SELECT extensions.throws_ok(
  $$UPDATE app.quote_request SET source = 'portal'
    WHERE request_id = '00000000-0000-4000-8000-0000000005c1'$$,
  '23514', NULL,
  'a request with an email behind it cannot be a portal or staff request'
);

INSERT INTO app.inbound_email (email_id, message_id, from_email, subject, body_text, received_at)
VALUES ('00000000-0000-4000-8000-0000000005b2', '<synthetic-2@example.test>',
        'old@example.test', 'Quote please', 'Made before sources were recorded', now());

SELECT extensions.lives_ok(
  $$INSERT INTO app.quote_request (request_id, company_name, contact_name, email, message, inbound_email_id)
    VALUES ('00000000-0000-4000-8000-0000000005c3', 'Old Co', 'Old', 'old@example.test', 'Made before sources were recorded',
            '00000000-0000-4000-8000-0000000005b2')$$,
  'an emailed request that records no source is accepted, as the API from before this column makes them'
);

SELECT extensions.throws_ok(
  $$UPDATE app.quote_request SET source = 'fax'
    WHERE request_id = '00000000-0000-4000-8000-0000000005c2'$$,
  '23514', NULL,
  'a source is portal, staff, email or website'
);

SELECT extensions.throws_ok(
  $$UPDATE app.quote_request
    SET reviewed_at = now(), reviewed_by = '00000000-0000-4000-8000-0000000005aa'
    WHERE request_id = '00000000-0000-4000-8000-0000000005c2'$$,
  '23514', NULL,
  'only a request that came by email is reviewed'
);

SELECT extensions.lives_ok(
  $$UPDATE app.quote_request
    SET reviewed_at = now(), reviewed_by = '00000000-0000-4000-8000-0000000005aa'
    WHERE request_id = '00000000-0000-4000-8000-0000000005c1'$$,
  'an email request can be reviewed by a named person'
);

SELECT * FROM extensions.finish();
ROLLBACK;
