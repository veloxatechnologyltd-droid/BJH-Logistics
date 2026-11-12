BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(5);

SELECT extensions.ok(
  NOT has_table_privilege('anon', 'app.sales_email_attachment', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'app.sales_email_attachment', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'app.sales_email_attachment', 'INSERT')
  AND (SELECT relrowsecurity FROM pg_class WHERE oid = 'app.sales_email_attachment'::regclass),
  'sales email attachments are private'
);

INSERT INTO app.sales_email_message
  (email_id, direction, source, send_status, from_email, subject, body_text,
   folder_path, uid_validity, mailbox_uid)
VALUES
  ('00000000-0000-4000-8000-0000000006aa', 'incoming', 'mailbox', 'mailbox',
   'sender@example.test', 'Synthetic attachment', 'Synthetic only', 'INBOX', 1, 990);

INSERT INTO app.sales_email_attachment
  (attachment_id, email_id, part_index, filename, size_bytes, object_key)
VALUES
  ('00000000-0000-4000-8000-0000000006ab', '00000000-0000-4000-8000-0000000006aa',
   0, 'invoice.pdf', 100, 'sales-email/synthetic/invoice');

SELECT extensions.is(
  (SELECT filename FROM app.sales_email_attachment WHERE email_id = '00000000-0000-4000-8000-0000000006aa'),
  'invoice.pdf',
  'attachment metadata belongs to its message'
);

SELECT extensions.throws_ok(
  $$INSERT INTO app.sales_email_attachment
      (attachment_id, email_id, part_index, filename, size_bytes, object_key)
    VALUES ('00000000-0000-4000-8000-0000000006ac',
      '00000000-0000-4000-8000-0000000006aa', 0, 'copy.pdf', 100,
      'sales-email/synthetic/copy')$$,
  '23505', NULL,
  'one attachment part is recorded once per message'
);

SELECT extensions.throws_ok(
  $$INSERT INTO app.sales_email_attachment
      (attachment_id, email_id, part_index, filename, size_bytes, object_key)
    VALUES ('00000000-0000-4000-8000-0000000006ad',
      '00000000-0000-4000-8000-0000000006ae', 0, 'orphan.pdf', 100,
      'sales-email/synthetic/orphan')$$,
  '23503', NULL,
  'an attachment cannot point at a missing message'
);

SET LOCAL ROLE authenticated;
SELECT extensions.throws_ok(
  $$SELECT count(*) FROM app.sales_email_attachment$$,
  '42501', NULL,
  'a signed-in customer cannot read sales attachments'
);
RESET ROLE;

SELECT extensions.finish();
ROLLBACK;
