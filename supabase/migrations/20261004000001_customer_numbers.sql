CREATE SEQUENCE app.customer_number_seq AS bigint START WITH 1;

ALTER TABLE app.customer_company
  ADD COLUMN customer_number text;

WITH numbered AS (
  SELECT
    company_id,
    row_number() OVER (ORDER BY created_at, company_id) AS number
  FROM app.customer_company
)
UPDATE app.customer_company AS company
SET customer_number = 'CUS-' || lpad(numbered.number::text, 4, '0')
FROM numbered
WHERE company.company_id = numbered.company_id;

SELECT setval(
  'app.customer_number_seq',
  COALESCE(MAX(NULLIF(substring(customer_number FROM 5), '')::bigint), 1),
  COUNT(*) > 0
)
FROM app.customer_company;

ALTER TABLE app.customer_company
  ALTER COLUMN customer_number SET NOT NULL,
  ALTER COLUMN customer_number SET DEFAULT
    ('CUS-' || lpad(nextval('app.customer_number_seq')::text, 4, '0')),
  ADD CONSTRAINT customer_company_customer_number_unique UNIQUE (customer_number);
