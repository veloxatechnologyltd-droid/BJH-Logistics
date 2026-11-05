-- The bank account printed on a quote version and on an invoice (client
-- request, 2026-11-05). The account is chosen from the list in Settings, and a
-- copy of its details is kept here so that editing or removing the account in
-- Settings later does not change a document already prepared.
-- {id, bankName, branch, accountName, accountNumber, currency, swiftCode, address}

ALTER TABLE app.quote_version
  ADD COLUMN bank_account jsonb
    CHECK (bank_account IS NULL OR jsonb_typeof(bank_account) = 'object');

ALTER TABLE app.invoice
  ADD COLUMN bank_account jsonb
    CHECK (bank_account IS NULL OR jsonb_typeof(bank_account) = 'object');
