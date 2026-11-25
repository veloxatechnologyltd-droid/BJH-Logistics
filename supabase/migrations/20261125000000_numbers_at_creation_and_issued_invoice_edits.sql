-- Client request (2026-11-25): staff print a quote or invoice before it is
-- shared, so the number must exist from the moment it is generated, and a
-- client's changes must not cost a new number.
--
-- 1. An invoice takes its number when it is created (a quote already can: the
--    API now allocates it in the same insert). Only the "issued" state still
--    needs lines; the number may exist on a draft.
-- 2. An issued invoice with no payment standing against it can be edited. It
--    keeps its number, issue date, client and currency; every edit raises
--    `revision` and keeps the replaced version in app.invoice_revision.
--    With a payment standing, it is still locked (reverse the payment first),
--    and void remains available as before.
-- 3. Drafts and quotes made before this change get their numbers now.

ALTER TABLE app.invoice
  ADD COLUMN revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  ADD COLUMN revised_at timestamptz,
  ADD COLUMN revised_by uuid REFERENCES auth.users (id);

ALTER TABLE app.invoice DROP CONSTRAINT invoice_issue_check;
ALTER TABLE app.invoice ADD CONSTRAINT invoice_issue_check CHECK (
  (issued_by IS NULL) = (issued_at IS NULL)
  AND (status <> 'issued' OR issued_at IS NOT NULL)
  AND (status <> 'draft' OR issued_at IS NULL)
  AND (issued_at IS NULL
       OR (invoice_number IS NOT NULL AND jsonb_array_length(lines) >= 1))
);

ALTER TABLE app.invoice ADD CONSTRAINT invoice_revised_fields_check CHECK (
  (revision = 0) = (revised_at IS NULL AND revised_by IS NULL)
);

-- The version an edit replaced: revision n holds the invoice as it was before
-- edit n. Append-only.
CREATE TABLE app.invoice_revision (
  invoice_id uuid NOT NULL REFERENCES app.invoice (invoice_id),
  revision integer NOT NULL CHECK (revision >= 1),
  previous jsonb NOT NULL,
  edited_by uuid NOT NULL REFERENCES auth.users (id),
  edited_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (invoice_id, revision)
);

CREATE FUNCTION app.invoice_revision_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'invoice revisions are append-only';
END;
$$;

REVOKE ALL ON FUNCTION app.invoice_revision_append_only()
  FROM PUBLIC, anon, authenticated;

CREATE TRIGGER invoice_revision_append_only
  BEFORE UPDATE OR DELETE ON app.invoice_revision
  FOR EACH ROW
  EXECUTE FUNCTION app.invoice_revision_append_only();

ALTER TABLE app.invoice_revision ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE app.invoice_revision FROM PUBLIC, anon, authenticated;

-- A draft can be edited, issued or voided. An issued invoice can be edited
-- while nothing is paid on it, or voided. Its number, issue date, client,
-- job and currency never change.
CREATE OR REPLACE FUNCTION app.protect_invoice()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  content_changed boolean;
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
  -- A number, once given, stays.
  IF OLD.invoice_number IS NOT NULL
    AND NEW.invoice_number IS DISTINCT FROM OLD.invoice_number THEN
    RAISE EXCEPTION 'an invoice keeps its number';
  END IF;
  IF OLD.status = 'issued' THEN
    IF NEW.status NOT IN ('issued', 'void') THEN
      RAISE EXCEPTION 'an issued invoice cannot go back to draft';
    END IF;
    IF ROW(NEW.currency, NEW.issued_by, NEW.issued_at)
       IS DISTINCT FROM ROW(OLD.currency, OLD.issued_by, OLD.issued_at) THEN
      RAISE EXCEPTION 'the currency and issue date of an issued invoice cannot change';
    END IF;
    content_changed :=
      ROW(NEW.lines, NEW.due_date, NEW.notes, NEW.subtotal_minor,
          NEW.tax_lines, NEW.tax_total_minor, NEW.total_minor, NEW.shipment)
      IS DISTINCT FROM
      ROW(OLD.lines, OLD.due_date, OLD.notes, OLD.subtotal_minor,
          OLD.tax_lines, OLD.tax_total_minor, OLD.total_minor, OLD.shipment);
    IF NEW.status = 'void' AND content_changed THEN
      RAISE EXCEPTION 'an issued invoice is immutable';
    END IF;
    IF content_changed AND NEW.revision <> OLD.revision + 1 THEN
      RAISE EXCEPTION 'editing an issued invoice raises its revision by one';
    END IF;
    IF NOT content_changed AND NEW.revision <> OLD.revision THEN
      RAISE EXCEPTION 'the revision only changes with an edit';
    END IF;
    IF (NEW.status = 'void' OR content_changed) AND EXISTS (
      SELECT 1 FROM app.invoice_payment p
      WHERE p.invoice_id = OLD.invoice_id
        AND NOT EXISTS (
          SELECT 1 FROM app.invoice_payment_reversal r WHERE r.payment_id = p.payment_id
        )
    ) THEN
      RAISE EXCEPTION 'reverse the payments before voiding or editing the invoice';
    END IF;
  ELSIF NEW.revision <> OLD.revision THEN
    RAISE EXCEPTION 'only an issued invoice has revisions';
  END IF;
  RETURN NEW;
END;
$$;

-- Existing drafts and quotes get the number they would have had at creation.
DO $$
DECLARE
  item record;
BEGIN
  FOR item IN
    SELECT quote_id, service_line,
           EXTRACT(YEAR FROM created_at)::integer AS year
    FROM app.quote
    WHERE quote_number IS NULL
    ORDER BY created_at, quote_id
  LOOP
    UPDATE app.quote
    SET quote_number = app.allocate_quote_number(
      item.service_line, item.year,
      COALESCE((SELECT settings #>> '{numbering,quotePrefix}'
                FROM app.business_settings_revision
                ORDER BY revision_number DESC LIMIT 1), 'BJH/Q'))
    WHERE quote_id = item.quote_id;
  END LOOP;

  FOR item IN
    SELECT invoice_id, EXTRACT(YEAR FROM created_at)::integer AS year
    FROM app.invoice
    WHERE status = 'draft' AND invoice_number IS NULL
    ORDER BY created_at, invoice_id
  LOOP
    UPDATE app.invoice
    SET invoice_number = app.allocate_invoice_number(
      item.year,
      COALESCE((SELECT settings #>> '{numbering,invoicePrefix}'
                FROM app.business_settings_revision
                ORDER BY revision_number DESC LIMIT 1), 'BJH/INV'))
    WHERE invoice_id = item.invoice_id;
  END LOOP;
END;
$$;
