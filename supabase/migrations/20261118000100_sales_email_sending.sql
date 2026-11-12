-- Per-recipient send tracking and staff-managed suppression for the Sales email workspace.

ALTER TABLE app.sales_email_message
  DROP CONSTRAINT sales_email_message_send_status_check,
  ADD CONSTRAINT sales_email_message_send_status_check CHECK (
    send_status IN ('mailbox', 'queued', 'sending', 'accepted', 'failed', 'unknown', 'stubbed')
  ),
  ADD COLUMN draft_id uuid REFERENCES app.outreach_draft (draft_id),
  ADD COLUMN campaign_ids uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN send_started_at timestamptz;

CREATE UNIQUE INDEX sales_email_message_draft_once
  ON app.sales_email_message (draft_id)
  WHERE draft_id IS NOT NULL;
CREATE INDEX sales_email_message_queue
  ON app.sales_email_message (created_at)
  WHERE send_status = 'queued';

CREATE TABLE app.sales_email_suppression (
  email text PRIMARY KEY CHECK (length(email) BETWEEN 3 AND 254),
  reason text NOT NULL CHECK (reason IN ('unsubscribe', 'manual', 'bounce')),
  source_message_id uuid REFERENCES app.sales_email_message (email_id),
  created_by uuid REFERENCES auth.users (id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

ALTER TABLE app.sales_email_suppression ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE app.sales_email_suppression FROM PUBLIC, anon, authenticated;
