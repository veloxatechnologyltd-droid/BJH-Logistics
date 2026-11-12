-- Staff email workspace for the dedicated sales mailbox.
-- The API owns this table; no customer or browser role can read it directly.

CREATE TABLE app.sales_email_message (
  email_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  folder_path text,
  uid_validity bigint,
  mailbox_uid bigint,
  message_id text,
  in_reply_to text,
  references_ids text[] NOT NULL DEFAULT '{}',
  direction text NOT NULL CHECK (direction IN ('incoming', 'outgoing')),
  source text NOT NULL CHECK (source IN ('mailbox', 'platform')),
  send_status text NOT NULL CHECK (
    send_status IN ('mailbox', 'queued', 'sending', 'accepted', 'failed', 'unknown')
  ),
  from_name text,
  from_email text NOT NULL CHECK (length(from_email) BETWEEN 3 AND 254),
  to_recipients jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(to_recipients) = 'array'),
  cc_recipients jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(cc_recipients) = 'array'),
  subject text NOT NULL DEFAULT '' CHECK (length(subject) <= 1000),
  body_text text NOT NULL DEFAULT '' CHECK (length(body_text) <= 500000),
  received_at timestamptz,
  accepted_at timestamptz,
  smtp_response text CHECK (smtp_response IS NULL OR length(smtp_response) <= 2000),
  error text CHECK (error IS NULL OR length(error) <= 2000),
  created_by uuid REFERENCES auth.users (id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((folder_path IS NULL) = (mailbox_uid IS NULL)),
  CHECK ((folder_path IS NULL) = (uid_validity IS NULL)),
  CHECK (source <> 'mailbox' OR send_status = 'mailbox'),
  CHECK (source <> 'platform' OR folder_path IS NULL)
);

CREATE UNIQUE INDEX sales_email_message_mailbox_uid
  ON app.sales_email_message (folder_path, uid_validity, mailbox_uid)
  WHERE folder_path IS NOT NULL;
CREATE UNIQUE INDEX sales_email_message_message_id
  ON app.sales_email_message (message_id)
  WHERE message_id IS NOT NULL;
CREATE INDEX sales_email_message_history
  ON app.sales_email_message (COALESCE(received_at, accepted_at, created_at) DESC);

CREATE TABLE app.sales_email_sync_cursor (
  folder_path text PRIMARY KEY CHECK (length(folder_path) BETWEEN 1 AND 500),
  uid_validity bigint NOT NULL,
  last_uid bigint NOT NULL DEFAULT 0 CHECK (last_uid >= 0),
  synced_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

ALTER TABLE app.sales_email_message ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE app.sales_email_message FROM PUBLIC, anon, authenticated;
ALTER TABLE app.sales_email_sync_cursor ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE app.sales_email_sync_cursor FROM PUBLIC, anon, authenticated;
