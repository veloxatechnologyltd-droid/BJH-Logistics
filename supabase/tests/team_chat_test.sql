BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(9);

SELECT extensions.ok(
  NOT has_table_privilege('authenticated', 'app.team_conversation', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'app.team_conversation_member', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'app.team_message', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'app.team_read_state', 'SELECT')
  AND NOT has_table_privilege('anon', 'app.team_message', 'SELECT')
  AND (SELECT relrowsecurity FROM pg_class WHERE oid = 'app.team_message'::regclass)
  AND (SELECT relrowsecurity FROM pg_class WHERE oid = 'app.team_conversation'::regclass),
  'team chat is private: no grants and row level security is on'
);

SELECT extensions.is(
  (SELECT array_agg(team_key ORDER BY team_key) FROM app.team_conversation WHERE kind = 'team'),
  ARRAY['customer_service', 'finance', 'operations', 'sales'],
  'one channel per team exists'
);

INSERT INTO auth.users (id, aud, role, email, encrypted_password)
VALUES
  ('00000000-0000-4000-8000-0000000007aa', 'authenticated', 'authenticated', 'team-a@example.test', ''),
  ('00000000-0000-4000-8000-0000000007ab', 'authenticated', 'authenticated', 'team-b@example.test', '');

SELECT extensions.throws_ok(
  $$INSERT INTO app.team_conversation (kind, created_by)
    VALUES ('group', '00000000-0000-4000-8000-0000000007aa')$$,
  '23514', NULL, 'a group needs a title'
);
SELECT extensions.throws_ok(
  $$INSERT INTO app.team_conversation (kind, title, team_key)
    VALUES ('team', 'Warehouse', 'warehouse')$$,
  '23514', NULL, 'only the four teams have channels'
);

INSERT INTO app.team_conversation (conversation_id, kind, direct_key, created_by)
VALUES ('00000000-0000-4000-8000-0000000007c0', 'direct',
        '00000000-0000-4000-8000-0000000007aa:00000000-0000-4000-8000-0000000007ab',
        '00000000-0000-4000-8000-0000000007aa');
SELECT extensions.throws_ok(
  $$INSERT INTO app.team_conversation (kind, direct_key, created_by)
    VALUES ('direct',
            '00000000-0000-4000-8000-0000000007aa:00000000-0000-4000-8000-0000000007ab',
            '00000000-0000-4000-8000-0000000007ab')$$,
  '23505', NULL, 'two people share one direct conversation'
);

INSERT INTO app.team_conversation_member (conversation_id, user_id, added_by)
VALUES ('00000000-0000-4000-8000-0000000007c0', '00000000-0000-4000-8000-0000000007aa', NULL);
INSERT INTO app.team_message (message_id, conversation_id, author_user_id, body, tags)
VALUES ('00000000-0000-4000-8000-0000000007d0', '00000000-0000-4000-8000-0000000007c0',
        '00000000-0000-4000-8000-0000000007aa', 'Synthetic hello', '[]'::jsonb);

SELECT extensions.throws_ok(
  $$UPDATE app.team_message SET body = 'changed'
    WHERE message_id = '00000000-0000-4000-8000-0000000007d0'$$,
  'P0001', 'team chat messages are kept as sent', 'a message cannot be edited'
);
SELECT extensions.throws_ok(
  $$DELETE FROM app.team_message
    WHERE message_id = '00000000-0000-4000-8000-0000000007d0'$$,
  'P0001', 'team chat messages are kept as sent', 'a message cannot be deleted'
);
SELECT extensions.throws_ok(
  $$DELETE FROM app.team_conversation_member
    WHERE conversation_id = '00000000-0000-4000-8000-0000000007c0'$$,
  'P0001', NULL, 'members are kept; leaving sets left_at'
);
SELECT extensions.lives_ok(
  $$UPDATE app.team_conversation_member SET left_at = now()
    WHERE conversation_id = '00000000-0000-4000-8000-0000000007c0'$$,
  'a member can leave'
);

SELECT * FROM extensions.finish();
ROLLBACK;
