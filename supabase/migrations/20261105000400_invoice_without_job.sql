-- An invoice no longer needs a job (client request, 2026-11-05): customer
-- service can bill a client who has no job. The invoice now carries its own
-- client; when it does have a job, that must be the job's client. It also
-- keeps the shipment details printed on it (bill of lading, vessel, container,
-- goods, quantity), typed by staff or copied from the job when it is made.
-- {billOfLading, vesselAndRoute, containerAndSeal, goods, quantityAndWeight}

ALTER TABLE app.invoice
  ADD COLUMN customer_company_id uuid REFERENCES app.customer_company (company_id),
  ADD COLUMN shipment jsonb
    CHECK (shipment IS NULL OR jsonb_typeof(shipment) = 'object');

-- Existing invoices belong to the client of their job. The protect trigger
-- would refuse to touch issued and void invoices, so it is paused only for
-- this one fill of the new column.
ALTER TABLE app.invoice DISABLE TRIGGER invoice_protect;
UPDATE app.invoice AS invoice
SET customer_company_id = job.customer_company_id
FROM app.job AS job
WHERE job.job_id = invoice.job_id;
ALTER TABLE app.invoice ENABLE TRIGGER invoice_protect;

ALTER TABLE app.invoice
  ALTER COLUMN customer_company_id SET NOT NULL,
  ALTER COLUMN job_id DROP NOT NULL;

CREATE INDEX invoice_customer_company
  ON app.invoice (customer_company_id, created_at);

-- Runs before the NOT NULL check: an insert that names only a job takes that
-- job's client, and one that names both must name the same client.
CREATE FUNCTION app.set_invoice_company()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  job_company uuid;
BEGIN
  IF NEW.job_id IS NOT NULL THEN
    SELECT customer_company_id INTO job_company
    FROM app.job WHERE job_id = NEW.job_id;
    IF NEW.customer_company_id IS NULL THEN
      NEW.customer_company_id := job_company;
    ELSIF NEW.customer_company_id IS DISTINCT FROM job_company THEN
      RAISE EXCEPTION 'an invoice on a job must be for the job''s client';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION app.set_invoice_company() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER invoice_company_set
  BEFORE INSERT ON app.invoice
  FOR EACH ROW
  EXECUTE FUNCTION app.set_invoice_company();

-- The invoice's client joins the fields that never change; everything else in
-- the original protection is as it was.
CREATE OR REPLACE FUNCTION app.protect_invoice()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'invoices cannot be deleted; void them instead';
  END IF;
  IF OLD.status = 'void' THEN
    RAISE EXCEPTION 'a voided invoice cannot change';
  END IF;
  IF NEW.job_id IS DISTINCT FROM OLD.job_id
    OR NEW.customer_company_id IS DISTINCT FROM OLD.customer_company_id
    OR NEW.created_by IS DISTINCT FROM OLD.created_by
    OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'invoice identity fields are immutable';
  END IF;
  IF OLD.status = 'issued' THEN
    IF NEW.status <> 'void' THEN
      RAISE EXCEPTION 'an issued invoice is immutable';
    END IF;
    IF ROW(NEW.invoice_number, NEW.currency, NEW.lines, NEW.due_date, NEW.notes,
           NEW.subtotal_minor, NEW.tax_lines, NEW.tax_total_minor, NEW.total_minor,
           NEW.issued_by, NEW.issued_at, NEW.shipment)
       IS DISTINCT FROM
       ROW(OLD.invoice_number, OLD.currency, OLD.lines, OLD.due_date, OLD.notes,
           OLD.subtotal_minor, OLD.tax_lines, OLD.tax_total_minor, OLD.total_minor,
           OLD.issued_by, OLD.issued_at, OLD.shipment) THEN
      RAISE EXCEPTION 'an issued invoice is immutable';
    END IF;
    IF EXISTS (
      SELECT 1 FROM app.invoice_payment p
      WHERE p.invoice_id = OLD.invoice_id
        AND NOT EXISTS (
          SELECT 1 FROM app.invoice_payment_reversal r WHERE r.payment_id = p.payment_id
        )
    ) THEN
      RAISE EXCEPTION 'reverse the payments before voiding the invoice';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
