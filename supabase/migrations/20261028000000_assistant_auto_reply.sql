-- The email assistant may send its reply itself (ASSISTANT_AUTO_REPLY=on): such a
-- reply has no person as its sender and is marked as sent by the assistant.
-- Quotes still need a person to issue them.

ALTER TABLE app.quote_request
  ADD COLUMN reply_sent_by_assistant boolean NOT NULL DEFAULT false,
  DROP CONSTRAINT quote_request_reply_sent,
  ADD CONSTRAINT quote_request_reply_sent
    CHECK ((reply_sent_at IS NULL) = (reply_notification_id IS NULL)
       AND (reply_sent_at IS NULL OR reply_body IS NOT NULL)
       AND (reply_sent_at IS NULL) = (reply_sent_by IS NULL AND NOT reply_sent_by_assistant)
       AND NOT (reply_sent_by IS NOT NULL AND reply_sent_by_assistant));
