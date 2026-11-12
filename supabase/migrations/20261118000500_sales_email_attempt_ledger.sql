-- Keep one durable record for each actual worker claim, including retries.

CREATE TABLE app.sales_email_send_attempt (
  attempt_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email_id uuid NOT NULL REFERENCES app.sales_email_message (email_id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL,
  finished_at timestamptz,
  status text NOT NULL CHECK (
    status IN ('sending', 'accepted', 'failed', 'unknown', 'stubbed')
  ),
  error text CHECK (error IS NULL OR length(error) <= 2000),
  provider_message_id text,
  CHECK ((status = 'sending') = (finished_at IS NULL))
);

CREATE UNIQUE INDEX sales_email_send_attempt_one_active
  ON app.sales_email_send_attempt (email_id) WHERE status = 'sending';
CREATE INDEX sales_email_send_attempt_started
  ON app.sales_email_send_attempt (started_at DESC);

INSERT INTO app.sales_email_send_attempt
  (email_id, started_at, finished_at, status, error, provider_message_id)
SELECT email_id, send_started_at,
       CASE WHEN send_status = 'sending' THEN NULL ELSE COALESCE(accepted_at, send_started_at) END,
       CASE WHEN send_status IN ('sending', 'accepted', 'failed', 'unknown', 'stubbed')
            THEN send_status ELSE 'failed' END,
       error, message_id
FROM app.sales_email_message
WHERE source = 'platform' AND send_started_at IS NOT NULL;

ALTER TABLE app.sales_email_send_attempt ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE app.sales_email_send_attempt FROM PUBLIC, anon, authenticated;
