BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(11);

SELECT extensions.ok(
  NOT has_table_privilege('anon', 'app.outreach_draft', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'app.outreach_draft', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'app.outreach_draft', 'INSERT')
  AND NOT has_table_privilege('authenticated', 'app.outreach_draft', 'UPDATE')
  AND NOT has_table_privilege('authenticated', 'app.outreach_draft', 'DELETE')
  AND (SELECT relrowsecurity FROM pg_class WHERE oid = 'app.outreach_draft'::regclass),
  'outreach drafts are private: no grants and row level security is on'
);

INSERT INTO auth.users (id, aud, role, email, encrypted_password)
VALUES
  ('00000000-0000-4000-8000-0000000006aa', 'authenticated', 'authenticated', 'draft-staff@example.test', ''),
  ('00000000-0000-4000-8000-0000000006ab', 'authenticated', 'authenticated', 'draft-customer@example.test', '');

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-0000000006ab';
SELECT extensions.throws_ok(
  $$SELECT count(*) FROM app.outreach_draft$$, '42501', NULL,
  'a signed-in customer cannot read drafts'
);
RESET ROLE;

INSERT INTO app.lead_campaign (campaign_id, name, target_service, target_industry, target_location, created_by)
VALUES ('00000000-0000-4000-8000-0000000006ca', 'Synthetic Draft Campaign', 'Sea freight',
        'Food importers', 'Accra, Ghana', '00000000-0000-4000-8000-0000000006aa');
INSERT INTO app.prospect (prospect_id, campaign_id, business_name, source, normalized_name, emails)
VALUES ('00000000-0000-4000-8000-0000000006da', '00000000-0000-4000-8000-0000000006ca',
        'Synthetic Foods Ltd', 'stub', 'synthetic foods', '{info@synthetic-foods.example}'),
       ('00000000-0000-4000-8000-0000000006db', '00000000-0000-4000-8000-0000000006ca',
        'Synthetic Grains Ltd', 'stub', 'synthetic grains', '{info@synthetic-grains.example}');

-- A new draft is pending and undecided.
INSERT INTO app.outreach_draft (draft_id, prospect_id, recipient_email, subject, body, method, created_by)
VALUES ('00000000-0000-4000-8000-0000000006ea', '00000000-0000-4000-8000-0000000006da',
        'info@synthetic-foods.example', 'Sea freight for Synthetic Foods', 'Hello.', 'template',
        '00000000-0000-4000-8000-0000000006aa');
SELECT extensions.is(
  (SELECT status || '/' || (decided_at IS NULL) || '/' || edited FROM app.outreach_draft
     WHERE draft_id = '00000000-0000-4000-8000-0000000006ea'),
  'pending/true/false',
  'a new draft is pending, undecided and unedited'
);

-- Only one open draft per prospect.
SELECT extensions.throws_ok(
  $$INSERT INTO app.outreach_draft (prospect_id, recipient_email, subject, body, method, created_by)
    VALUES ('00000000-0000-4000-8000-0000000006da', 'info@synthetic-foods.example', 'Again', 'Hello again.',
            'ai', '00000000-0000-4000-8000-0000000006aa')$$,
  '23505', NULL,
  'a prospect cannot have two open drafts'
);

-- A decision needs a person and a time.
SELECT extensions.throws_ok(
  $$UPDATE app.outreach_draft SET status = 'approved'
    WHERE draft_id = '00000000-0000-4000-8000-0000000006ea'$$,
  '23514', NULL,
  'approving without who and when is refused'
);
UPDATE app.outreach_draft
SET status = 'approved', decided_at = now(), decided_by = '00000000-0000-4000-8000-0000000006aa'
WHERE draft_id = '00000000-0000-4000-8000-0000000006ea';
SELECT extensions.is(
  (SELECT status FROM app.outreach_draft WHERE draft_id = '00000000-0000-4000-8000-0000000006ea'),
  'approved',
  'a draft is approved with who and when'
);

-- A reason belongs to a rejection only.
SELECT extensions.throws_ok(
  $$UPDATE app.outreach_draft SET rejected_reason = 'Not now'
    WHERE draft_id = '00000000-0000-4000-8000-0000000006ea'$$,
  '23514', NULL,
  'a reason on an approved draft is refused'
);

-- A rejected draft frees the prospect for a new one.
UPDATE app.outreach_draft
SET status = 'rejected', rejected_reason = 'Wrong tone',
    decided_at = now(), decided_by = '00000000-0000-4000-8000-0000000006aa'
WHERE draft_id = '00000000-0000-4000-8000-0000000006ea';
SELECT extensions.lives_ok(
  $$INSERT INTO app.outreach_draft (prospect_id, recipient_email, subject, body, method, created_by)
    VALUES ('00000000-0000-4000-8000-0000000006da', 'info@synthetic-foods.example', 'Second try',
            'Hello.', 'ai', '00000000-0000-4000-8000-0000000006aa')$$,
  'after a rejection the prospect can be drafted again'
);

-- A prospect is dismissed with who did it, or not at all.
SELECT extensions.throws_ok(
  $$UPDATE app.prospect SET dismissed_at = now()
    WHERE prospect_id = '00000000-0000-4000-8000-0000000006db'$$,
  '23514', NULL,
  'dismissing without who is refused'
);
UPDATE app.prospect
SET dismissed_at = now(), dismissed_by = '00000000-0000-4000-8000-0000000006aa'
WHERE prospect_id = '00000000-0000-4000-8000-0000000006db';
SELECT extensions.is(
  (SELECT count(*) FROM app.prospect
    WHERE campaign_id = '00000000-0000-4000-8000-0000000006ca' AND dismissed_at IS NOT NULL),
  1::bigint,
  'a prospect can be dismissed from the pool and stays in the table'
);

-- Deleting the campaign removes its prospects and their drafts.
DELETE FROM app.lead_campaign WHERE campaign_id = '00000000-0000-4000-8000-0000000006ca';
SELECT extensions.is(
  (SELECT count(*) FROM app.outreach_draft WHERE prospect_id IN
    ('00000000-0000-4000-8000-0000000006da', '00000000-0000-4000-8000-0000000006db')),
  0::bigint,
  'deleting a campaign removes the drafts of its prospects'
);

SELECT * FROM extensions.finish();
ROLLBACK;
