-- One conversation per client company (client meeting, 2026-11-01). The client
-- writes in the portal or answers by email; customer service answers in the
-- system, and each answer shows in the portal and is emailed to the client.
-- Messages are never edited or deleted.

CREATE TABLE app.chat_message (
  message_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES app.customer_company (company_id),
  direction text NOT NULL CHECK (direction IN ('from_client', 'to_client')),
  channel text NOT NULL CHECK (channel IN ('portal', 'email')),
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 5000),
  -- The person who wrote it: a staff member, or a customer account in the portal.
  -- Null for a client's emailed message, whose sender address is kept instead.
  author_user_id uuid REFERENCES auth.users (id),
  author_name text CHECK (author_name IS NULL OR length(author_name) <= 200),
  email_from text CHECK (email_from IS NULL OR length(email_from) <= 320),
  -- A message may be about one of the client's jobs.
  job_id uuid REFERENCES app.job (job_id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  -- When the other side first opened it.
  read_at timestamptz,
  CHECK (direction = 'from_client' OR author_user_id IS NOT NULL),
  CHECK (channel = 'portal' OR direction = 'from_client')
);

CREATE INDEX chat_message_thread ON app.chat_message (company_id, created_at);
CREATE INDEX chat_message_unread ON app.chat_message (company_id)
  WHERE read_at IS NULL;

CREATE FUNCTION app.protect_chat_message()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'chat messages are kept';
  END IF;
  IF ROW(NEW.message_id, NEW.company_id, NEW.direction, NEW.channel, NEW.body,
         NEW.author_user_id, NEW.author_name, NEW.email_from, NEW.job_id,
         NEW.created_at)
     IS DISTINCT FROM
     ROW(OLD.message_id, OLD.company_id, OLD.direction, OLD.channel, OLD.body,
         OLD.author_user_id, OLD.author_name, OLD.email_from, OLD.job_id,
         OLD.created_at)
     OR (OLD.read_at IS NOT NULL AND NEW.read_at IS DISTINCT FROM OLD.read_at) THEN
    RAISE EXCEPTION 'a chat message can only be marked read, once';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION app.protect_chat_message() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER chat_message_protect
  BEFORE UPDATE OR DELETE ON app.chat_message
  FOR EACH ROW
  EXECUTE FUNCTION app.protect_chat_message();

ALTER TABLE app.chat_message ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE app.chat_message FROM PUBLIC, anon, authenticated;
