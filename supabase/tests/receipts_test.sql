BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(9);

SELECT extensions.ok(
  NOT has_table_privilege('anon', 'app.receipt_number_sequence', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'app.receipt_number_sequence', 'SELECT')
  AND (SELECT relrowsecurity FROM pg_class WHERE oid = 'app.receipt_number_sequence'::regclass),
  'the receipt sequence is private: no grants and row level security is on'
);
SELECT extensions.is(
  app.allocate_receipt_number(2098),
  'BJH/RCT/2098/0001',
  'receipt numbers default to the BJH/RCT prefix'
);
SELECT extensions.is(
  app.allocate_receipt_number(2098, 'SYN/RCT'),
  'SYN/RCT/2098/0002',
  'receipt numbers take the configured prefix and keep counting'
);

INSERT INTO auth.users (id, aud, role, email, encrypted_password)
VALUES ('00000000-0000-4000-8000-0000000002aa', 'authenticated', 'authenticated', 'receipt-test@example.test', '');
INSERT INTO app.customer_company (company_id, company_name)
VALUES ('00000000-0000-4000-8000-0000000002ba', 'Synthetic Receipt Ltd');
INSERT INTO app.job (job_id, file_number, service_line, customer_company_id, opened_by)
VALUES ('00000000-0000-4000-8000-0000000002ca', 'BJH/SI/2099/9301', 'sea_import',
        '00000000-0000-4000-8000-0000000002ba', '00000000-0000-4000-8000-0000000002aa');
INSERT INTO app.invoice (invoice_id, job_id, invoice_number, status, currency, lines,
  subtotal_minor, total_minor, created_by, issued_at, issued_by)
VALUES ('00000000-0000-4000-8000-0000000002e0', '00000000-0000-4000-8000-0000000002ca',
        'BJH/INV/2099/9301', 'issued', 'GHS',
        '[{"description":"x","amountMinor":1000,"taxable":false}]'::jsonb, 1000, 1000,
        '00000000-0000-4000-8000-0000000002aa', now(), '00000000-0000-4000-8000-0000000002aa');
INSERT INTO app.invoice_payment (invoice_id, amount_minor, received_on, method, receipt_number, recorded_by)
VALUES ('00000000-0000-4000-8000-0000000002e0', 400, '2099-01-01', 'cash', 'BJH/RCT/2099/9301',
        '00000000-0000-4000-8000-0000000002aa');

SELECT extensions.throws_ok(
  $$INSERT INTO app.invoice_payment (invoice_id, amount_minor, received_on, method, receipt_number, recorded_by)
    VALUES ('00000000-0000-4000-8000-0000000002e0', 100, '2099-01-02', 'cash', 'BJH/RCT/2099/9301',
            '00000000-0000-4000-8000-0000000002aa')$$,
  '23505', NULL, 'a receipt number belongs to one payment'
);
SELECT extensions.lives_ok(
  $$INSERT INTO app.invoice_payment (invoice_id, amount_minor, received_on, method, recorded_by)
    VALUES ('00000000-0000-4000-8000-0000000002e0', 100, '2099-01-03', 'cash',
            '00000000-0000-4000-8000-0000000002aa')$$,
  'payments recorded before receipts existed have no number and remain valid'
);

-- One payment across several invoices: one receipt, shared by its invoices.
SELECT extensions.ok(
  NOT has_table_privilege('anon', 'app.payment_batch', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'app.payment_batch', 'SELECT')
  AND (SELECT relrowsecurity FROM pg_class WHERE oid = 'app.payment_batch'::regclass),
  'payment batches are private: no grants and row level security is on'
);
INSERT INTO app.payment_batch (batch_id, receipt_number)
VALUES ('00000000-0000-4000-8000-0000000002f0', 'BJH/RCT/2099/9302');
SELECT extensions.lives_ok(
  $$INSERT INTO app.invoice_payment (invoice_id, amount_minor, received_on, method, receipt_number, batch_id, recorded_by)
    VALUES ('00000000-0000-4000-8000-0000000002e0', 100, '2099-01-04', 'cash', 'BJH/RCT/2099/9302',
            '00000000-0000-4000-8000-0000000002f0', '00000000-0000-4000-8000-0000000002aa'),
           ('00000000-0000-4000-8000-0000000002e0', 100, '2099-01-04', 'cash', 'BJH/RCT/2099/9302',
            '00000000-0000-4000-8000-0000000002f0', '00000000-0000-4000-8000-0000000002aa')$$,
  'the payments of one batch share its receipt number'
);
SELECT extensions.throws_ok(
  $$INSERT INTO app.invoice_payment (invoice_id, amount_minor, received_on, method, receipt_number, batch_id, recorded_by)
    VALUES ('00000000-0000-4000-8000-0000000002e0', 50, '2099-01-04', 'cash', 'BJH/RCT/2099/9301',
            '00000000-0000-4000-8000-0000000002f0', '00000000-0000-4000-8000-0000000002aa')$$,
  '23503', NULL, 'a batch payment carries only its batch''s receipt number'
);
SELECT extensions.throws_ok(
  $$UPDATE app.payment_batch SET receipt_number = 'BJH/RCT/2099/9999'
    WHERE batch_id = '00000000-0000-4000-8000-0000000002f0'$$,
  'P0001', 'payment batches are append-only', 'a payment batch never changes'
);

SELECT * FROM extensions.finish();
ROLLBACK;
