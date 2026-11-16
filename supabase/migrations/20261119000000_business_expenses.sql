-- Business expenses: what it costs to run BJH (salaries, fuel, rent, tax...),
-- not tied to a client's job (those are job costs, kept on the job). Staff in
-- finance record them; the API checks the category list and who may see
-- payroll. A wrong entry is voided with a reason, never edited or deleted, so
-- the record of what was paid stays whole.

CREATE TABLE app.business_expense (
  expense_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  spent_on date NOT NULL,
  category text NOT NULL CHECK (category ~ '^[a-z_]{2,40}$'),
  description text CHECK (description IS NULL OR length(description) <= 300),
  payee text CHECK (payee IS NULL OR length(payee) <= 200),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  payment_method text NOT NULL CHECK (payment_method ~ '^[a-z_]{2,40}$'),
  reference text CHECK (reference IS NULL OR length(reference) <= 200),
  note text CHECK (note IS NULL OR length(note) <= 2000),
  recorded_by uuid NOT NULL REFERENCES auth.users (id),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  voided_at timestamptz,
  voided_by uuid REFERENCES auth.users (id),
  void_reason text CHECK (void_reason IS NULL OR length(void_reason) BETWEEN 1 AND 300),
  CHECK ((voided_at IS NULL) = (voided_by IS NULL) AND (voided_at IS NULL) = (void_reason IS NULL))
);

CREATE INDEX business_expense_spent_on ON app.business_expense (spent_on DESC, recorded_at DESC);
CREATE INDEX business_expense_category ON app.business_expense (category, spent_on);

-- No deletes; the only change allowed is voiding a live entry once.
CREATE FUNCTION app.check_business_expense_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'business expenses are voided, not deleted';
  END IF;
  IF OLD.voided_at IS NOT NULL THEN
    RAISE EXCEPTION 'this expense is already voided';
  END IF;
  IF NEW.voided_at IS NULL
     OR (to_jsonb(NEW) - 'voided_at' - 'voided_by' - 'void_reason')
        IS DISTINCT FROM (to_jsonb(OLD) - 'voided_at' - 'voided_by' - 'void_reason') THEN
    RAISE EXCEPTION 'a business expense can only be voided';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER business_expense_change
  BEFORE UPDATE OR DELETE ON app.business_expense
  FOR EACH ROW EXECUTE FUNCTION app.check_business_expense_change();

ALTER TABLE app.business_expense ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE app.business_expense FROM PUBLIC, anon, authenticated;
