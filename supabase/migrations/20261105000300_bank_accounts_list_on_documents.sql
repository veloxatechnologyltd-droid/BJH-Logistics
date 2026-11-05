-- A quote version or invoice can now print several bank accounts (client
-- request, 2026-11-05: Settings marks default accounts, and a document prints
-- all that are ticked). `bank_account` keeps its name and holds a JSON list of
-- copies of the accounts; documents made earlier the same day hold one object,
-- which the API still reads. NULL = made before bank accounts existed; an empty
-- list = no bank details printed.

ALTER TABLE app.quote_version
  DROP CONSTRAINT quote_version_bank_account_check,
  ADD CONSTRAINT quote_version_bank_account_check
    CHECK (bank_account IS NULL
           OR jsonb_typeof(bank_account) IN ('object', 'array'));

ALTER TABLE app.invoice
  DROP CONSTRAINT invoice_bank_account_check,
  ADD CONSTRAINT invoice_bank_account_check
    CHECK (bank_account IS NULL
           OR jsonb_typeof(bank_account) IN ('object', 'array'));
