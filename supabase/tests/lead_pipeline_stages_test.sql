BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(4);

INSERT INTO auth.users (id, aud, role, email, encrypted_password)
VALUES ('00000000-0000-4000-8000-0000000008aa', 'authenticated', 'authenticated', 'pipeline-staff@example.test', '');

INSERT INTO app.lead (lead_id, company_name, source, stage, created_by)
VALUES ('00000000-0000-4000-8000-0000000008b1', 'Synthetic Generated Ltd', 'campaign', 'new',
        '00000000-0000-4000-8000-0000000008aa'),
       ('00000000-0000-4000-8000-0000000008b2', 'Synthetic Manual Ltd', 'referral', 'new',
        '00000000-0000-4000-8000-0000000008aa');

UPDATE app.lead SET stage = 'replied' WHERE lead_id = '00000000-0000-4000-8000-0000000008b1';
SELECT extensions.is(
  (SELECT stage FROM app.lead WHERE lead_id = '00000000-0000-4000-8000-0000000008b1'),
  'replied',
  'a campaign lead can be Replied'
);
UPDATE app.lead SET stage = 'interested' WHERE lead_id = '00000000-0000-4000-8000-0000000008b1';
SELECT extensions.is(
  (SELECT stage FROM app.lead WHERE lead_id = '00000000-0000-4000-8000-0000000008b1'),
  'interested',
  'a campaign lead can be Interested'
);

SELECT extensions.throws_ok(
  $$UPDATE app.lead SET stage = 'replied' WHERE lead_id = '00000000-0000-4000-8000-0000000008b2'$$,
  '23514', NULL,
  'a manual lead cannot be Replied'
);
SELECT extensions.throws_ok(
  $$UPDATE app.lead SET stage = 'warm' WHERE lead_id = '00000000-0000-4000-8000-0000000008b1'$$,
  '23514', NULL,
  'an unknown stage is refused'
);

SELECT * FROM extensions.finish();
ROLLBACK;
