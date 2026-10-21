-- Email intake: customer requests that arrive by email. The raw email is kept
-- (with its attachments), a customer request is created from it, and AI reads
-- the email to fill in the request details; a person then checks them.
-- Nothing here reads a mailbox: an email service posts each message in.

CREATE TABLE app.inbound_email (
  email_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The mail's own Message-ID (or one made from its content), so an email
  -- delivered twice by the service becomes one request.
  message_id text NOT NULL UNIQUE CHECK (length(message_id) BETWEEN 1 AND 500),
  from_email text NOT NULL CHECK (length(from_email) BETWEEN 3 AND 254),
  from_name text CHECK (from_name IS NULL OR length(from_name) <= 200),
  to_address text CHECK (to_address IS NULL OR length(to_address) <= 500),
  subject text NOT NULL DEFAULT '' CHECK (length(subject) <= 500),
  body_text text NOT NULL CHECK (length(body_text) <= 200000),
  received_at timestamptz NOT NULL,
  extraction_status text NOT NULL DEFAULT 'pending'
    CHECK (extraction_status IN ('pending', 'done', 'failed')),
  extraction_error text CHECK (extraction_error IS NULL OR length(extraction_error) <= 500),
  extraction_model text CHECK (extraction_model IS NULL OR length(extraction_model) <= 100),
  -- [{filename, reason}] for attachments that were not kept (too large, or a type BJH does not store).
  skipped_attachments jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(skipped_attachments) = 'array'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT inbound_email_error_matches_status
    CHECK ((extraction_status = 'failed') = (extraction_error IS NOT NULL))
);

CREATE TABLE app.inbound_email_attachment (
  attachment_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email_id uuid NOT NULL REFERENCES app.inbound_email (email_id) ON DELETE CASCADE,
  filename text NOT NULL CHECK (length(filename) BETWEEN 1 AND 200),
  content_type text NOT NULL CHECK (length(content_type) BETWEEN 1 AND 200),
  size_bytes bigint NOT NULL CHECK (size_bytes BETWEEN 1 AND 31457280),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  object_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX inbound_email_attachment_email ON app.inbound_email_attachment (email_id);

-- Details (service, route, cargo...) as agreed in app code; a person checks an
-- email request once, which records who and when.
ALTER TABLE app.quote_request
  ADD COLUMN details jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(details) = 'object'),
  ADD COLUMN inbound_email_id uuid UNIQUE REFERENCES app.inbound_email (email_id),
  ADD COLUMN reviewed_at timestamptz,
  ADD COLUMN reviewed_by uuid REFERENCES auth.users (id),
  ADD CONSTRAINT quote_request_review_pair
    CHECK ((reviewed_at IS NULL) = (reviewed_by IS NULL)),
  ADD CONSTRAINT quote_request_review_needs_email
    CHECK (reviewed_at IS NULL OR inbound_email_id IS NOT NULL);

ALTER TABLE app.inbound_email ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE app.inbound_email FROM PUBLIC, anon, authenticated;
ALTER TABLE app.inbound_email_attachment ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE app.inbound_email_attachment FROM PUBLIC, anon, authenticated;
