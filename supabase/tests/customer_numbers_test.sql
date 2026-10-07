BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(3);

INSERT INTO app.customer_company (company_id, company_name)
VALUES
  ('70000000-0000-4000-8000-000000000001', 'Customer Number Test One'),
  ('70000000-0000-4000-8000-000000000002', 'Customer Number Test Two');

SELECT extensions.ok(
  (SELECT bool_and(customer_number ~ '^CUS-[0-9]{4,}$')
   FROM app.customer_company
   WHERE company_id IN (
     '70000000-0000-4000-8000-000000000001',
     '70000000-0000-4000-8000-000000000002'
   )),
  'new customer companies receive readable customer IDs'
);

SELECT extensions.isnt(
  (SELECT customer_number FROM app.customer_company
   WHERE company_id = '70000000-0000-4000-8000-000000000001'),
  (SELECT customer_number FROM app.customer_company
   WHERE company_id = '70000000-0000-4000-8000-000000000002'),
  'customer IDs are unique'
);

SELECT extensions.throws_ok(
  $$INSERT INTO app.customer_company (company_id, company_name, customer_number)
    SELECT '70000000-0000-4000-8000-000000000003', 'Duplicate Customer ID', customer_number
    FROM app.customer_company
    WHERE company_id = '70000000-0000-4000-8000-000000000001'$$,
  '23505',
  NULL,
  'duplicate customer IDs are rejected'
);

SELECT * FROM extensions.finish();
ROLLBACK;
