BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(8);

SELECT extensions.ok(
  NOT has_table_privilege('anon', 'app.lead', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'app.lead', 'INSERT')
  AND (SELECT relrowsecurity FROM pg_class WHERE oid = 'app.lead'::regclass),
  'leads are private: no grants and row level security is on'
);

INSERT INTO auth.users (id, aud, role, email, encrypted_password)
VALUES ('00000000-0000-4000-8000-0000000004aa', 'authenticated', 'authenticated', 'lead-test@example.test', '');
INSERT INTO app.customer_company (company_id, company_name)
VALUES ('00000000-0000-4000-8000-0000000004ba', 'Synthetic Won Lead Ltd');
INSERT INTO app.quote_request (request_id, company_name, contact_name, email, message)
VALUES ('00000000-0000-4000-8000-0000000004ca', 'Synthetic Request Ltd', 'Pat', 'pat@example.test', 'Need a quote');

SELECT extensions.lives_ok(
  $$INSERT INTO app.lead (lead_id, company_name, created_by)
    VALUES ('00000000-0000-4000-8000-0000000004da', 'Synthetic Prospect Ltd',
            '00000000-0000-4000-8000-0000000004aa')$$,
  'a new lead starts at stage new'
);

SELECT extensions.is(
  (SELECT stage FROM app.lead WHERE lead_id = '00000000-0000-4000-8000-0000000004da'),
  'new',
  'the default stage is new'
);

SELECT extensions.throws_ok(
  $$UPDATE app.lead SET stage = 'lost'
    WHERE lead_id = '00000000-0000-4000-8000-0000000004da'$$,
  '23514', NULL,
  'a lost lead must give a reason'
);

SELECT extensions.throws_ok(
  $$UPDATE app.lead SET lost_reason = 'Chose another forwarder'
    WHERE lead_id = '00000000-0000-4000-8000-0000000004da'$$,
  '23514', NULL,
  'only a lost lead can hold a lost reason'
);

SELECT extensions.throws_ok(
  $$UPDATE app.lead SET stage = 'won'
    WHERE lead_id = '00000000-0000-4000-8000-0000000004da'$$,
  '23514', NULL,
  'a won lead must point at a customer company'
);

SELECT extensions.lives_ok(
  $$UPDATE app.lead SET stage = 'won',
      customer_company_id = '00000000-0000-4000-8000-0000000004ba'
    WHERE lead_id = '00000000-0000-4000-8000-0000000004da'$$,
  'a won lead linked to a customer is accepted'
);

INSERT INTO app.lead (company_name, created_by, quote_request_id)
VALUES ('Synthetic Request Ltd', '00000000-0000-4000-8000-0000000004aa',
        '00000000-0000-4000-8000-0000000004ca');

SELECT extensions.throws_ok(
  $$INSERT INTO app.lead (company_name, created_by, quote_request_id)
    VALUES ('Synthetic Request Ltd', '00000000-0000-4000-8000-0000000004aa',
            '00000000-0000-4000-8000-0000000004ca')$$,
  '23505', NULL,
  'a quote request becomes at most one lead'
);

SELECT * FROM extensions.finish();
ROLLBACK;
