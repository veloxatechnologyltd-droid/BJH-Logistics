BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(5);

SELECT extensions.ok(
  NOT has_table_privilege('authenticated', 'app.push_subscription', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'app.push_subscription', 'INSERT')
  AND NOT has_table_privilege('anon', 'app.push_subscription', 'SELECT')
  AND (SELECT relrowsecurity FROM pg_class WHERE oid = 'app.push_subscription'::regclass),
  'push subscriptions are private: no grants and row level security is on'
);

INSERT INTO auth.users (id, aud, role, email, encrypted_password)
VALUES
  ('00000000-0000-4000-8000-0000000008aa', 'authenticated', 'authenticated', 'push-a@example.test', ''),
  ('00000000-0000-4000-8000-0000000008ab', 'authenticated', 'authenticated', 'push-b@example.test', '');

INSERT INTO app.push_subscription (user_id, endpoint, p256dh, auth)
VALUES ('00000000-0000-4000-8000-0000000008aa', 'https://fcm.googleapis.com/fcm/send/one', 'key', 'secret');

SELECT extensions.lives_ok(
  $$INSERT INTO app.push_subscription (user_id, endpoint, p256dh, auth)
    VALUES ('00000000-0000-4000-8000-0000000008aa', 'https://fcm.googleapis.com/fcm/send/two', 'key', 'secret')$$,
  'one person may have several browsers'
);

SELECT extensions.throws_ok(
  $$INSERT INTO app.push_subscription (user_id, endpoint, p256dh, auth)
    VALUES ('00000000-0000-4000-8000-0000000008ab', 'https://fcm.googleapis.com/fcm/send/one', 'key', 'secret')$$,
  '23505', NULL, 'a browser subscription belongs to one person at a time'
);

SELECT extensions.throws_ok(
  $$INSERT INTO app.push_subscription (user_id, endpoint, p256dh, auth)
    VALUES ('00000000-0000-4000-8000-0000000008ab', 'http://fcm.googleapis.com/fcm/send/three', 'key', 'secret')$$,
  '23514', NULL, 'only https addresses are kept'
);

SELECT extensions.throws_ok(
  $$INSERT INTO app.push_subscription (user_id, endpoint, p256dh, auth)
    VALUES ('00000000-0000-4000-8000-0000000008ff', 'https://fcm.googleapis.com/fcm/send/four', 'key', 'secret')$$,
  '23503', NULL, 'a subscription needs an existing account'
);

SELECT * FROM extensions.finish();
ROLLBACK;
