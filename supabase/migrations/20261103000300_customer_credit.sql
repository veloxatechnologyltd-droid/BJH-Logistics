-- Money a customer paid that is not (yet) set against an invoice (client
-- walkthrough, 2026-11-03): a payment with no invoice, or the part of a
-- payment beyond what the chosen invoices owe. It is kept as credit on the
-- customer's account, in one currency, with its own receipt, and Finance
-- applies it to later invoices. An invoice payment made from credit points to
-- it (credit_id) and carries no receipt of its own: no new money came in.
CREATE TABLE app.customer_credit (
  credit_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES app.customer_company (company_id),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  amount_minor bigint NOT NULL CHECK (amount_minor BETWEEN 1 AND 1000000000000),
  received_on date NOT NULL,
  method text NOT NULL CHECK (method IN ('cash', 'bank_transfer', 'cheque', 'mobile_money', 'other')),
  reference text CHECK (reference IS NULL OR length(reference) <= 200),
  note text CHECK (note IS NULL OR length(note) <= 2000),
  receipt_number text NOT NULL UNIQUE,
  recorded_by uuid NOT NULL REFERENCES auth.users (id),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  reversed_at timestamptz,
  reversed_by uuid REFERENCES auth.users (id),
  reversal_reason text CHECK (reversal_reason IS NULL OR length(reversal_reason) BETWEEN 1 AND 500),
  CONSTRAINT customer_credit_reversal_check CHECK (
    (reversed_at IS NULL) = (reversed_by IS NULL)
    AND (reversed_at IS NULL) = (reversal_reason IS NULL)
  )
);

CREATE INDEX customer_credit_company ON app.customer_credit (company_id, received_on);

ALTER TABLE app.invoice_payment
  ADD COLUMN credit_id uuid REFERENCES app.customer_credit (credit_id);
CREATE INDEX invoice_payment_credit ON app.invoice_payment (credit_id)
  WHERE credit_id IS NOT NULL;

-- A credit never changes; it can only be reversed, once, and never deleted.
CREATE FUNCTION app.protect_customer_credit()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'customer credits cannot be deleted';
  END IF;
  IF OLD.reversed_at IS NOT NULL THEN
    RAISE EXCEPTION 'the credit is already reversed';
  END IF;
  IF NEW.company_id IS DISTINCT FROM OLD.company_id
    OR NEW.currency IS DISTINCT FROM OLD.currency
    OR NEW.amount_minor IS DISTINCT FROM OLD.amount_minor
    OR NEW.received_on IS DISTINCT FROM OLD.received_on
    OR NEW.method IS DISTINCT FROM OLD.method
    OR NEW.reference IS DISTINCT FROM OLD.reference
    OR NEW.note IS DISTINCT FROM OLD.note
    OR NEW.receipt_number IS DISTINCT FROM OLD.receipt_number
    OR NEW.recorded_by IS DISTINCT FROM OLD.recorded_by
    OR NEW.recorded_at IS DISTINCT FROM OLD.recorded_at THEN
    RAISE EXCEPTION 'a recorded credit is immutable';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION app.protect_customer_credit() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER customer_credit_protect
  BEFORE UPDATE OR DELETE ON app.customer_credit
  FOR EACH ROW EXECUTE FUNCTION app.protect_customer_credit();

ALTER TABLE app.customer_credit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE app.customer_credit FROM PUBLIC, anon, authenticated;
