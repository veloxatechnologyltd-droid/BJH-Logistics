BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(8);

SELECT extensions.ok(
  NOT has_table_privilege('anon', 'app.business_settings_revision', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'app.business_settings_revision', 'SELECT')
  AND (SELECT relrowsecurity FROM pg_class WHERE oid = 'app.business_settings_revision'::regclass),
  'settings are private: no grants and row level security is on'
);

INSERT INTO auth.users (id, aud, role, email, encrypted_password)
VALUES ('00000000-0000-4000-8000-0000000000a7', 'authenticated', 'authenticated', 'settings-test@example.test', '');

-- Revision numbers far above real ones, so a persistent local database that
-- already holds saved settings does not collide with the fixture.
SELECT extensions.lives_ok(
  $$INSERT INTO app.business_settings_revision (revision_number, settings, changed_by)
    VALUES (900001, '{"issuer": {"name": "Synthetic Ltd"}}', '00000000-0000-4000-8000-0000000000a7')$$,
  'a settings revision can be recorded'
);
SELECT extensions.throws_ok(
  $$INSERT INTO app.business_settings_revision (revision_number, settings, changed_by)
    VALUES (900001, '{}', '00000000-0000-4000-8000-0000000000a7')$$,
  '23505',
  NULL,
  'a revision number is used once'
);
SELECT extensions.throws_ok(
  $$INSERT INTO app.business_settings_revision (revision_number, settings, changed_by)
    VALUES (900002, '[]', '00000000-0000-4000-8000-0000000000a7')$$,
  '23514',
  NULL,
  'settings must be an object'
);
SELECT extensions.throws_ok(
  $$UPDATE app.business_settings_revision SET settings = '{}'$$,
  'business settings revisions are append-only',
  'a revision cannot be edited'
);
SELECT extensions.throws_ok(
  $$DELETE FROM app.business_settings_revision$$,
  'business settings revisions are append-only',
  'a revision cannot be deleted'
);
SELECT extensions.is(
  app.allocate_quote_number('air_export', 2098),
  'BJH/Q/AE/2098/0001',
  'quote numbers default to the BJH/Q prefix'
);
SELECT extensions.is(
  app.allocate_quote_number('air_export', 2098, 'SYN/Q'),
  'SYN/Q/AE/2098/0002',
  'quote numbers take the configured prefix and keep counting'
);

SELECT * FROM extensions.finish();
ROLLBACK;
