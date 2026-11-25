BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(26);

SELECT extensions.ok(
  NOT has_table_privilege('anon', 'app.invoice', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'app.invoice', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'app.invoice_payment', 'INSERT')
  AND NOT has_table_privilege('authenticated', 'app.invoice_payment_reversal', 'SELECT')
  AND (SELECT relrowsecurity FROM pg_class WHERE oid = 'app.invoice'::regclass)
  AND (SELECT relrowsecurity FROM pg_class WHERE oid = 'app.invoice_payment'::regclass)
  AND (SELECT relrowsecurity FROM pg_class WHERE oid = 'app.invoice_payment_reversal'::regclass),
  'finance records are private: no grants and row level security is on'
);

INSERT INTO auth.users (id, aud, role, email, encrypted_password)
VALUES ('00000000-0000-4000-8000-0000000001aa', 'authenticated', 'authenticated', 'invoice-test@example.test', '');
INSERT INTO app.customer_company (company_id, company_name)
VALUES ('00000000-0000-4000-8000-0000000001ba', 'Synthetic Invoice Ltd');
INSERT INTO app.job (job_id, file_number, service_line, customer_company_id, opened_by)
VALUES ('00000000-0000-4000-8000-0000000001ca', 'BJH/SI/2099/9201', 'sea_import',
        '00000000-0000-4000-8000-0000000001ba', '00000000-0000-4000-8000-0000000001aa'),
       ('00000000-0000-4000-8000-0000000001cb', 'BJH/SI/2099/9202', 'sea_import',
        '00000000-0000-4000-8000-0000000001ba', '00000000-0000-4000-8000-0000000001aa');
INSERT INTO app.document (document_id, job_id, document_type, created_by)
VALUES ('00000000-0000-4000-8000-0000000001da', '00000000-0000-4000-8000-0000000001ca',
        'other', '00000000-0000-4000-8000-0000000001aa'),
       ('00000000-0000-4000-8000-0000000001db', '00000000-0000-4000-8000-0000000001cb',
        'other', '00000000-0000-4000-8000-0000000001aa');

SELECT extensions.is(
  app.allocate_invoice_number(2098),
  'BJH/INV/2098/0001',
  'invoice numbers default to the BJH/INV prefix'
);
SELECT extensions.is(
  app.allocate_invoice_number(2098, 'SYN/INV'),
  'SYN/INV/2098/0002',
  'invoice numbers take the configured prefix and keep counting'
);

INSERT INTO app.invoice (invoice_id, job_id, currency, lines, subtotal_minor, tax_total_minor,
  total_minor, created_by)
VALUES ('00000000-0000-4000-8000-0000000001e0', '00000000-0000-4000-8000-0000000001ca', 'GHS',
        '[{"description":"Handling","amountMinor":10000,"taxable":true}]'::jsonb,
        10000, 2000, 12000, '00000000-0000-4000-8000-0000000001aa');

SELECT extensions.throws_ok(
  $$INSERT INTO app.invoice (job_id, currency, subtotal_minor, tax_total_minor, total_minor, created_by)
    VALUES ('00000000-0000-4000-8000-0000000001ca', 'GHS', 100, 10, 999,
            '00000000-0000-4000-8000-0000000001aa')$$,
  '23514', NULL, 'the total must equal the subtotal plus tax'
);
SELECT extensions.throws_ok(
  $$UPDATE app.invoice SET status = 'issued', issued_at = now(),
      issued_by = '00000000-0000-4000-8000-0000000001aa'
    WHERE invoice_id = '00000000-0000-4000-8000-0000000001e0'$$,
  '23514', NULL, 'an issued invoice needs its number'
);
SELECT extensions.throws_ok(
  $$INSERT INTO app.invoice_payment (invoice_id, amount_minor, received_on, method, recorded_by)
    VALUES ('00000000-0000-4000-8000-0000000001e0', 100, '2099-01-01', 'cash',
            '00000000-0000-4000-8000-0000000001aa')$$,
  'P0001', 'payments can only be recorded against an issued invoice',
  'a draft invoice takes no payments'
);

UPDATE app.invoice
SET status = 'issued', invoice_number = 'BJH/INV/2099/9001', issued_at = now(),
    issued_by = '00000000-0000-4000-8000-0000000001aa'
WHERE invoice_id = '00000000-0000-4000-8000-0000000001e0';

SELECT extensions.throws_ok(
  $$UPDATE app.invoice SET notes = 'changed' WHERE invoice_id = '00000000-0000-4000-8000-0000000001e0'$$,
  'P0001', 'editing an issued invoice raises its revision by one',
  'an issued invoice changes only through a counted revision'
);
SELECT extensions.throws_ok(
  $$UPDATE app.invoice SET status = 'draft' WHERE invoice_id = '00000000-0000-4000-8000-0000000001e0'$$,
  'P0001', 'an issued invoice cannot go back to draft', 'an issued invoice cannot go back to draft'
);

-- An unpaid issued invoice can be edited: same number, revision one, the old
-- version kept; the number, issue date and currency stay.
SELECT extensions.lives_ok(
  $$UPDATE app.invoice SET notes = 'changed', revision = 1, revised_at = now(),
      revised_by = '00000000-0000-4000-8000-0000000001aa'
    WHERE invoice_id = '00000000-0000-4000-8000-0000000001e0'$$,
  'an unpaid issued invoice can be edited with a counted revision'
);
SELECT extensions.throws_ok(
  $$UPDATE app.invoice SET invoice_number = 'BJH/INV/2099/9999'
    WHERE invoice_id = '00000000-0000-4000-8000-0000000001e0'$$,
  'P0001', 'an invoice keeps its number', 'an invoice keeps its number'
);
SELECT extensions.throws_ok(
  $$UPDATE app.invoice SET currency = 'USD'
    WHERE invoice_id = '00000000-0000-4000-8000-0000000001e0'$$,
  'P0001', 'the currency and issue date of an issued invoice cannot change',
  'an issued invoice keeps its currency'
);
INSERT INTO app.invoice_revision (invoice_id, revision, previous, edited_by)
VALUES ('00000000-0000-4000-8000-0000000001e0', 1, '{}'::jsonb,
        '00000000-0000-4000-8000-0000000001aa');
SELECT extensions.throws_ok(
  $$DELETE FROM app.invoice_revision WHERE invoice_id = '00000000-0000-4000-8000-0000000001e0'$$,
  'P0001', 'invoice revisions are append-only', 'the revision history is append-only'
);
SELECT extensions.lives_ok(
  $$INSERT INTO app.invoice (invoice_id, job_id, invoice_number, currency, created_by)
    VALUES ('00000000-0000-4000-8000-0000000001e9', '00000000-0000-4000-8000-0000000001ca', 'BJH/INV/2099/9098', 'GHS',
            '00000000-0000-4000-8000-0000000001aa')$$,
  'a draft takes its number when it is made'
);
SELECT extensions.throws_ok(
  $$UPDATE app.invoice SET revision = 1 WHERE invoice_id = '00000000-0000-4000-8000-0000000001e9'$$,
  'P0001', 'only an issued invoice has revisions', 'a draft has no revisions'
);
SELECT extensions.throws_ok(
  $$DELETE FROM app.invoice WHERE invoice_id = '00000000-0000-4000-8000-0000000001e0'$$,
  'P0001', 'invoices cannot be deleted; void them instead', 'invoices cannot be deleted'
);
SELECT extensions.throws_ok(
  $$INSERT INTO app.invoice (job_id, invoice_number, status, currency, lines, subtotal_minor,
      total_minor, created_by, issued_at, issued_by)
    VALUES ('00000000-0000-4000-8000-0000000001ca', 'BJH/INV/2099/9001', 'issued', 'GHS',
            '[{"description":"x","amountMinor":1,"taxable":true}]'::jsonb, 1, 1,
            '00000000-0000-4000-8000-0000000001aa', now(),
            '00000000-0000-4000-8000-0000000001aa')$$,
  '23505', NULL, 'invoice numbers are unique'
);

-- Payments: 12000 total.
INSERT INTO app.invoice_payment (payment_id, invoice_id, amount_minor, received_on, method,
  reference, evidence_document_id, recorded_by)
VALUES ('00000000-0000-4000-8000-0000000001f1', '00000000-0000-4000-8000-0000000001e0', 5000,
        '2099-01-01', 'bank_transfer', 'TXN-1', '00000000-0000-4000-8000-0000000001da',
        '00000000-0000-4000-8000-0000000001aa');
INSERT INTO app.invoice_payment (payment_id, invoice_id, amount_minor, received_on, method,
  recorded_by)
VALUES ('00000000-0000-4000-8000-0000000001f2', '00000000-0000-4000-8000-0000000001e0', 7000,
        '2099-01-02', 'cash', '00000000-0000-4000-8000-0000000001aa');

SELECT extensions.throws_ok(
  $$INSERT INTO app.invoice_payment (invoice_id, amount_minor, received_on, method, recorded_by)
    VALUES ('00000000-0000-4000-8000-0000000001e0', 1, '2099-01-03', 'cash',
            '00000000-0000-4000-8000-0000000001aa')$$,
  'P0001', 'payment exceeds the outstanding balance',
  'payments cannot take the invoice past its total'
);
SELECT extensions.throws_ok(
  $$UPDATE app.invoice_payment SET amount_minor = 1
    WHERE payment_id = '00000000-0000-4000-8000-0000000001f1'$$,
  'P0001', 'payments are append-only; reverse a mistaken payment', 'payments cannot be edited'
);
SELECT extensions.throws_ok(
  $$UPDATE app.invoice SET status = 'void', voided_at = now(), voided_by = '00000000-0000-4000-8000-0000000001aa',
      void_reason = 'mistake' WHERE invoice_id = '00000000-0000-4000-8000-0000000001e0'$$,
  'P0001', 'reverse the payments before voiding or editing the invoice',
  'an invoice with a standing payment cannot be voided'
);
SELECT extensions.throws_ok(
  $$UPDATE app.invoice SET notes = 'again', revision = 2, revised_at = now(),
      revised_by = '00000000-0000-4000-8000-0000000001aa'
    WHERE invoice_id = '00000000-0000-4000-8000-0000000001e0'$$,
  'P0001', 'reverse the payments before voiding or editing the invoice',
  'an invoice with a standing payment cannot be edited'
);

INSERT INTO app.invoice_payment_reversal (payment_id, reason, reversed_by)
VALUES ('00000000-0000-4000-8000-0000000001f2', 'Cheque bounced', '00000000-0000-4000-8000-0000000001aa');

SELECT extensions.throws_ok(
  $$INSERT INTO app.invoice_payment_reversal (payment_id, reason, reversed_by)
    VALUES ('00000000-0000-4000-8000-0000000001f2', 'again', '00000000-0000-4000-8000-0000000001aa')$$,
  '23505', NULL, 'a payment is reversed at most once'
);
SELECT extensions.throws_ok(
  $$UPDATE app.invoice_payment_reversal SET reason = 'edited'
    WHERE payment_id = '00000000-0000-4000-8000-0000000001f2'$$,
  'P0001', 'payment reversals are append-only', 'a reversal cannot be edited'
);

-- The reversed 7000 is available again: 12000 - 5000 = 7000 outstanding.
INSERT INTO app.invoice_payment (payment_id, invoice_id, amount_minor, received_on, method,
  recorded_by)
VALUES ('00000000-0000-4000-8000-0000000001f3', '00000000-0000-4000-8000-0000000001e0', 7000,
        '2099-01-04', 'cash', '00000000-0000-4000-8000-0000000001aa');
SELECT extensions.is(
  (SELECT sum(p.amount_minor) FROM app.invoice_payment p
   WHERE p.invoice_id = '00000000-0000-4000-8000-0000000001e0'
     AND NOT EXISTS (SELECT 1 FROM app.invoice_payment_reversal r WHERE r.payment_id = p.payment_id)),
  12000::numeric,
  'a reversed payment frees its amount and the standing payments reach the total'
);

-- Evidence must sit on the invoice's own job.
INSERT INTO app.invoice (invoice_id, job_id, invoice_number, status, currency, lines,
  subtotal_minor, total_minor, created_by, issued_at, issued_by)
VALUES ('00000000-0000-4000-8000-0000000001e1', '00000000-0000-4000-8000-0000000001ca',
        'BJH/INV/2099/9002', 'issued', 'GHS',
        '[{"description":"x","amountMinor":100,"taxable":false}]'::jsonb, 100, 100,
        '00000000-0000-4000-8000-0000000001aa', now(), '00000000-0000-4000-8000-0000000001aa');
SELECT extensions.throws_ok(
  $$INSERT INTO app.invoice_payment (invoice_id, amount_minor, received_on, method,
      evidence_document_id, recorded_by)
    VALUES ('00000000-0000-4000-8000-0000000001e1', 50, '2099-01-05', 'cash',
            '00000000-0000-4000-8000-0000000001db', '00000000-0000-4000-8000-0000000001aa')$$,
  'P0001', 'evidence must be a document on the same job',
  'payment evidence must belong to the invoice job'
);

-- With nothing standing, an issued invoice can be voided and then never changes.
UPDATE app.invoice
SET status = 'void', voided_at = now(), voided_by = '00000000-0000-4000-8000-0000000001aa',
    void_reason = 'Wrong customer'
WHERE invoice_id = '00000000-0000-4000-8000-0000000001e1';
SELECT extensions.throws_ok(
  $$UPDATE app.invoice SET notes = 'x' WHERE invoice_id = '00000000-0000-4000-8000-0000000001e1'$$,
  'P0001', 'a voided invoice cannot change', 'a voided invoice cannot change'
);
SELECT extensions.throws_ok(
  $$INSERT INTO app.invoice_payment (invoice_id, amount_minor, received_on, method, recorded_by)
    VALUES ('00000000-0000-4000-8000-0000000001e1', 1, '2099-01-06', 'cash',
            '00000000-0000-4000-8000-0000000001aa')$$,
  'P0001', 'payments can only be recorded against an issued invoice',
  'a voided invoice takes no payments'
);

SELECT * FROM extensions.finish();
ROLLBACK;
