-- Idempotent staff-composed sends: one request represents one reviewed recipient preview.

CREATE TABLE app.sales_email_send_request (
  request_id uuid PRIMARY KEY,
  created_by uuid NOT NULL REFERENCES auth.users (id),
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  queued_count integer NOT NULL DEFAULT 0 CHECK (queued_count >= 0),
  suppressed_count integer NOT NULL DEFAULT 0 CHECK (suppressed_count >= 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

ALTER TABLE app.sales_email_message
  ADD COLUMN send_request_id uuid REFERENCES app.sales_email_send_request (request_id);

CREATE UNIQUE INDEX sales_email_message_send_request_recipient
  ON app.sales_email_message (send_request_id, lower(to_recipients->0->>'email'))
  WHERE send_request_id IS NOT NULL;

ALTER TABLE app.sales_email_send_request ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE app.sales_email_send_request FROM PUBLIC, anon, authenticated;
