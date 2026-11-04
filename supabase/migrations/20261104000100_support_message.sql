-- Support tickets (Evans, 2026-11-04): a support request becomes a ticket with
-- a conversation. The request's own description stays the first message; each
-- reply, from the super admin or from the person who sent it, is a row here.
-- Only the API reads or writes them.

CREATE TABLE app.support_message (
  support_message_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  support_request_id uuid NOT NULL REFERENCES app.support_request (support_request_id),
  author_user_id uuid NOT NULL REFERENCES auth.users (id),
  -- 'support' is the super admin answering; 'reporter' is the person who sent the request.
  author_role text NOT NULL CHECK (author_role IN ('support', 'reporter')),
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX support_message_request
  ON app.support_message (support_request_id, created_at);

ALTER TABLE app.support_message ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE app.support_message FROM PUBLIC, anon, authenticated;
