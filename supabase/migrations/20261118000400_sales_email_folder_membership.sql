-- Preserve one canonical message while recording every mailbox folder copy.

CREATE TABLE app.sales_email_folder_membership (
  folder_path text NOT NULL CHECK (length(folder_path) BETWEEN 1 AND 500),
  uid_validity bigint NOT NULL,
  mailbox_uid bigint NOT NULL CHECK (mailbox_uid > 0),
  email_id uuid NOT NULL REFERENCES app.sales_email_message (email_id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (folder_path, uid_validity, mailbox_uid)
);

INSERT INTO app.sales_email_folder_membership
  (folder_path, uid_validity, mailbox_uid, email_id)
SELECT folder_path, uid_validity, mailbox_uid, email_id
FROM app.sales_email_message
WHERE folder_path IS NOT NULL;

ALTER TABLE app.sales_email_folder_membership ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE app.sales_email_folder_membership FROM PUBLIC, anon, authenticated;
