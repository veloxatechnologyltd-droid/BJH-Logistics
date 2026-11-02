-- A client's emailed reply is kept once. The mailbox position lives in memory,
-- so after every API restart the mailbox is read again from INBOUND_IMAP_SINCE;
-- quote requests were already skipped by Message-ID, chat replies were not and
-- were added a second time. Storing the Message-ID with the reply, unique, stops
-- that (docs/audit-2026-11-02.md, S9). Replies already stored have no Message-ID,
-- so the first read after this runs may repeat those once.
ALTER TABLE app.chat_message
  ADD COLUMN email_message_id text
    CHECK (email_message_id IS NULL OR length(email_message_id) <= 998);

CREATE UNIQUE INDEX chat_message_email_message_id
  ON app.chat_message (email_message_id)
  WHERE email_message_id IS NOT NULL;

-- The update guard compares a fixed list of columns; the new one joins it so a
-- stored Message-ID can no more be changed than the rest of the message.
CREATE OR REPLACE FUNCTION app.protect_chat_message()
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
         NEW.created_at, NEW.email_message_id)
     IS DISTINCT FROM
     ROW(OLD.message_id, OLD.company_id, OLD.direction, OLD.channel, OLD.body,
         OLD.author_user_id, OLD.author_name, OLD.email_from, OLD.job_id,
         OLD.created_at, OLD.email_message_id)
     OR (OLD.read_at IS NOT NULL AND NEW.read_at IS DISTINCT FROM OLD.read_at) THEN
    RAISE EXCEPTION 'a chat message can only be marked read, once';
  END IF;
  RETURN NEW;
END;
$$;
