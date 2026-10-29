CREATE OR REPLACE FUNCTION app.next_customer_number()
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  sequence_value bigint;
  sequence_called boolean;
  highest_customer_number bigint;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('app.customer_number_seq')::bigint);

  SELECT last_value, is_called
  INTO sequence_value, sequence_called
  FROM app.customer_number_seq;

  SELECT MAX(NULLIF(substring(customer_number FROM 5), '')::bigint)
  INTO highest_customer_number
  FROM app.customer_company;

  IF highest_customer_number IS NOT NULL
     AND (NOT sequence_called OR sequence_value < highest_customer_number) THEN
    PERFORM setval('app.customer_number_seq', highest_customer_number, true);
  END IF;

  RETURN 'CUS-' || lpad(nextval('app.customer_number_seq')::text, 4, '0');
END;
$$;

ALTER TABLE app.customer_company
  ALTER COLUMN customer_number
  SET DEFAULT app.next_customer_number();
