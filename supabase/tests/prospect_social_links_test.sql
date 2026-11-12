BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(4);

INSERT INTO auth.users (id, aud, role, email, encrypted_password)
VALUES ('00000000-0000-4000-8000-0000000007aa', 'authenticated', 'authenticated', 'social-staff@example.test', '');
INSERT INTO app.lead_campaign (campaign_id, name, target_service, target_industry, target_location, created_by)
VALUES ('00000000-0000-4000-8000-0000000007ca', 'Synthetic Social Campaign', 'Sea freight',
        'Food importers', 'Accra, Ghana', '00000000-0000-4000-8000-0000000007aa');

INSERT INTO app.prospect (prospect_id, campaign_id, business_name, source, normalized_name)
VALUES ('00000000-0000-4000-8000-0000000007da', '00000000-0000-4000-8000-0000000007ca',
        'Synthetic Social Ltd', 'stub', 'synthetic social');

SELECT extensions.is(
  (SELECT social_links::text FROM app.prospect
     WHERE prospect_id = '00000000-0000-4000-8000-0000000007da'),
  '{}',
  'a prospect starts with no social links'
);

UPDATE app.prospect
SET social_links = '{"facebook": ["https://www.facebook.com/synthetic"], "instagram": ["https://www.instagram.com/synthetic"]}'
WHERE prospect_id = '00000000-0000-4000-8000-0000000007da';
SELECT extensions.is(
  (SELECT social_links->'facebook'->>0 FROM app.prospect
     WHERE prospect_id = '00000000-0000-4000-8000-0000000007da'),
  'https://www.facebook.com/synthetic',
  'social links are stored by platform'
);

SELECT extensions.throws_ok(
  $$UPDATE app.prospect SET social_links = '["https://www.facebook.com/x"]'
    WHERE prospect_id = '00000000-0000-4000-8000-0000000007da'$$,
  '23514', NULL,
  'social links must be an object'
);
SELECT extensions.throws_ok(
  $$UPDATE app.prospect SET social_links = jsonb_build_object('facebook', repeat('x', 5000))
    WHERE prospect_id = '00000000-0000-4000-8000-0000000007da'$$,
  '23514', NULL,
  'social links are kept small'
);

SELECT * FROM extensions.finish();
ROLLBACK;
