BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(11);

SELECT extensions.ok(
  NOT has_table_privilege('anon', 'app.chat_message', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'app.chat_message', 'INSERT')
  AND (SELECT relrowsecurity FROM pg_class WHERE oid = 'app.chat_message'::regclass),
  'client chat is private: no grants and row level security is on'
);

INSERT INTO auth.users (id, aud, role, email, encrypted_password)
VALUES ('00000000-0000-4000-8000-0000000008aa', 'authenticated', 'authenticated', 'chat-staff@example.test', '');
INSERT INTO app.customer_company (company_id, company_name)
VALUES ('00000000-0000-4000-8000-0000000008ba', 'Synthetic Chat Ltd');

SELECT extensions.lives_ok(
  $$INSERT INTO app.chat_message
      (message_id, company_id, direction, channel, body, email_from, email_message_id)
    VALUES ('00000000-0000-4000-8000-0000000008c1',
            '00000000-0000-4000-8000-0000000008ba', 'from_client', 'email',
            'Friday works', 'ama@example.test', '<reply-1@example.test>')$$,
  'an emailed reply is stored with its Message-ID'
);

SELECT extensions.throws_ok(
  $$INSERT INTO app.chat_message
      (company_id, direction, channel, body, email_from, email_message_id)
    VALUES ('00000000-0000-4000-8000-0000000008ba', 'from_client', 'email',
            'Friday works', 'ama@example.test', '<reply-1@example.test>')$$,
  '23505', NULL,
  'the same email cannot be added to a conversation twice'
);

SELECT extensions.lives_ok(
  $$INSERT INTO app.chat_message (company_id, direction, channel, body, author_user_id)
    VALUES ('00000000-0000-4000-8000-0000000008ba', 'to_client', 'portal',
            'Noted', '00000000-0000-4000-8000-0000000008aa'),
           ('00000000-0000-4000-8000-0000000008ba', 'to_client', 'portal',
            'Also noted', '00000000-0000-4000-8000-0000000008aa')$$,
  'messages without a Message-ID are not held to one'
);

SELECT extensions.throws_ok(
  $$INSERT INTO app.chat_message (company_id, direction, channel, body, author_user_id)
    VALUES ('00000000-0000-4000-8000-0000000008ba', 'to_client', 'email',
            'Not allowed', '00000000-0000-4000-8000-0000000008aa')$$,
  '23514', NULL,
  'only a client writes by email'
);

SELECT extensions.throws_ok(
  $$DELETE FROM app.chat_message
    WHERE message_id = '00000000-0000-4000-8000-0000000008c1'$$,
  'P0001', 'chat messages are kept',
  'a chat message cannot be deleted'
);

SELECT extensions.throws_ok(
  $$UPDATE app.chat_message SET body = 'Rewritten'
    WHERE message_id = '00000000-0000-4000-8000-0000000008c1'$$,
  'P0001', NULL,
  'a chat message cannot be edited'
);

SELECT extensions.throws_ok(
  $$UPDATE app.chat_message SET email_message_id = '<other@example.test>'
    WHERE message_id = '00000000-0000-4000-8000-0000000008c1'$$,
  'P0001', NULL,
  'a stored Message-ID cannot be changed'
);

SELECT extensions.lives_ok(
  $$UPDATE app.chat_message SET read_at = clock_timestamp()
    WHERE message_id = '00000000-0000-4000-8000-0000000008c1'$$,
  'a message can be marked read'
);

SELECT extensions.throws_ok(
  $$UPDATE app.chat_message SET read_at = clock_timestamp() + interval '1 hour'
    WHERE message_id = '00000000-0000-4000-8000-0000000008c1'$$,
  'P0001', NULL,
  'and only once'
);

SELECT extensions.is(
  (SELECT count(*)::int FROM pg_indexes
   WHERE schemaname = 'app'
     AND indexname IN ('job_status_opened', 'job_quote_request', 'quote_quote_request',
                       'lead_customer_company', 'document_extraction_document',
                       'job_charge_quote_line', 'chat_message_job',
                       'staff_notification_quote_request', 'customer_membership_user',
                       'team_read_state_user', 'chat_message_email_message_id')),
  11,
  'the lookup indexes from the audit exist'
);

SELECT * FROM extensions.finish();
ROLLBACK;
