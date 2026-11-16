-- Public tracking number (Evans, 2026-11-16): every job carries a random
-- number the customer can type on the public website to follow the shipment
-- without logging in. It is separate from the file number on purpose: file
-- numbers are sequential (BJH/SI/2026/0001), so anyone could guess the next
-- customer's job from one. Format BJH-XXXX-XXXX, eight characters from an
-- alphabet without look-alikes (no 0/O, 1/I/L), about 39 bits.
--
-- Additive: existing jobs are given a number too, so every job can be
-- tracked, but nobody is messaged about them.

CREATE FUNCTION app.generate_tracking_number()
RETURNS text
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  alphabet constant text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  random_bytes bytea;
  chars text;
  candidate text;
BEGIN
  LOOP
    -- A version 4 uuid is random except bytes 6 and 8, which are skipped.
    random_bytes := uuid_send(gen_random_uuid());
    chars := '';
    FOR position IN 0..7 LOOP
      chars := chars || substr(
        alphabet,
        1 + (get_byte(random_bytes, CASE WHEN position < 6 THEN position ELSE position + 3 END) % length(alphabet)),
        1
      );
    END LOOP;
    candidate := 'BJH-' || substr(chars, 1, 4) || '-' || substr(chars, 5, 4);
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM app.job WHERE tracking_number = candidate
    );
  END LOOP;
  RETURN candidate;
END;
$$;

REVOKE ALL ON FUNCTION app.generate_tracking_number()
  FROM PUBLIC, anon, authenticated;

ALTER TABLE app.job ADD COLUMN tracking_number text;

UPDATE app.job SET tracking_number = app.generate_tracking_number()
WHERE tracking_number IS NULL;

ALTER TABLE app.job
  ALTER COLUMN tracking_number SET DEFAULT app.generate_tracking_number(),
  ALTER COLUMN tracking_number SET NOT NULL,
  ADD CONSTRAINT job_tracking_number_format
    CHECK (tracking_number ~ '^BJH-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$'),
  ADD CONSTRAINT job_tracking_number_key UNIQUE (tracking_number);

-- Once given, the number is what the customer holds; it must not change.
CREATE OR REPLACE FUNCTION app.prevent_job_identity_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.file_number IS DISTINCT FROM OLD.file_number
    OR NEW.tracking_number IS DISTINCT FROM OLD.tracking_number
    OR NEW.service_line IS DISTINCT FROM OLD.service_line
    OR NEW.customer_company_id IS DISTINCT FROM OLD.customer_company_id
    OR NEW.opened_by IS DISTINCT FROM OLD.opened_by
    OR NEW.opened_at IS DISTINCT FROM OLD.opened_at THEN
    RAISE EXCEPTION 'job identity fields are immutable';
  END IF;
  RETURN NEW;
END;
$$;
