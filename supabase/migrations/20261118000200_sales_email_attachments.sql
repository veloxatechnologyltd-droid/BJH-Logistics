-- Private attachment metadata for messages synced from the sales mailbox.
-- File bytes live under the sales-email/ prefix in the private job-documents bucket.

CREATE TABLE app.sales_email_attachment (
  attachment_id uuid PRIMARY KEY,
  email_id uuid NOT NULL REFERENCES app.sales_email_message (email_id) ON DELETE CASCADE,
  part_index integer NOT NULL CHECK (part_index >= 0),
  filename text NOT NULL CHECK (length(filename) BETWEEN 1 AND 255),
  size_bytes integer NOT NULL CHECK (size_bytes >= 0),
  object_key text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (email_id, part_index)
);

CREATE INDEX sales_email_attachment_email_id ON app.sales_email_attachment (email_id);
ALTER TABLE app.sales_email_attachment ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE app.sales_email_attachment FROM PUBLIC, anon, authenticated;
