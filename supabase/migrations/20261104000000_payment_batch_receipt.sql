-- One receipt for one payment (Evans, 2026-11-04): money that settles several
-- invoices at once gets a single receipt listing them all, instead of one
-- receipt per invoice. Each invoice still gets its own payment row (balances,
-- statements and reversals stay per invoice); the rows of one payment share a
-- batch and its receipt number. A payment on one invoice is unchanged.
CREATE TABLE app.payment_batch (
  batch_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_number text NOT NULL UNIQUE,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (batch_id, receipt_number)
);

ALTER TABLE app.invoice_payment ADD COLUMN batch_id uuid;

-- A batch payment carries its batch's receipt number, and no other.
ALTER TABLE app.invoice_payment
  ADD CONSTRAINT invoice_payment_batch_receipt
    FOREIGN KEY (batch_id, receipt_number)
    REFERENCES app.payment_batch (batch_id, receipt_number),
  ADD CONSTRAINT invoice_payment_batch_has_receipt
    CHECK (batch_id IS NULL OR receipt_number IS NOT NULL);

-- Outside a batch a receipt number stays on one payment only.
ALTER TABLE app.invoice_payment DROP CONSTRAINT invoice_payment_receipt_number_key;
CREATE UNIQUE INDEX invoice_payment_receipt_number_single
  ON app.invoice_payment (receipt_number)
  WHERE batch_id IS NULL;
CREATE INDEX invoice_payment_batch ON app.invoice_payment (batch_id)
  WHERE batch_id IS NOT NULL;

-- A batch never changes once recorded.
CREATE FUNCTION app.protect_payment_batch()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'payment batches are append-only';
END;
$$;

REVOKE ALL ON FUNCTION app.protect_payment_batch() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER payment_batch_protect
  BEFORE UPDATE OR DELETE ON app.payment_batch
  FOR EACH ROW EXECUTE FUNCTION app.protect_payment_batch();

ALTER TABLE app.payment_batch ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE app.payment_batch FROM PUBLIC, anon, authenticated;
