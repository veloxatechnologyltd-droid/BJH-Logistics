-- Email assistant: after AI reads an emailed request, the assistant links or
-- creates the customer, drafts a quote from the most similar past quote, and
-- drafts a reply. A person checks the quote and the reply; nothing is sent
-- without a person pressing Send.

-- The first version of a quote the assistant drafted has no person as its
-- creator; every quote has exactly one of the two.
ALTER TABLE app.quote
  ALTER COLUMN created_by DROP NOT NULL,
  ADD COLUMN created_by_assistant boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT quote_creator_check
    CHECK ((created_by IS NULL) = created_by_assistant);

ALTER TABLE app.quote_version
  ALTER COLUMN created_by DROP NOT NULL,
  ADD COLUMN created_by_assistant boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT quote_version_creator_check
    CHECK ((created_by IS NULL) = created_by_assistant);

ALTER TABLE app.quote_request
  -- What the email is: a request for a quote, a question, or something else.
  ADD COLUMN kind text CHECK (kind IS NULL OR kind IN ('quote', 'inquiry', 'other')),
  -- What the assistant did, in order, for staff to read.
  ADD COLUMN assistant_notes jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(assistant_notes) = 'array'),
  ADD COLUMN reply_subject text CHECK (reply_subject IS NULL OR length(reply_subject) BETWEEN 1 AND 300),
  ADD COLUMN reply_body text CHECK (reply_body IS NULL OR length(reply_body) BETWEEN 1 AND 5000),
  ADD COLUMN reply_model text CHECK (reply_model IS NULL OR length(reply_model) <= 100),
  ADD COLUMN reply_drafted_at timestamptz,
  ADD COLUMN reply_sent_at timestamptz,
  ADD COLUMN reply_sent_by uuid REFERENCES auth.users (id),
  ADD COLUMN reply_notification_id uuid REFERENCES app.notification (notification_id),
  ADD CONSTRAINT quote_request_reply_pair
    CHECK ((reply_subject IS NULL) = (reply_body IS NULL)),
  ADD CONSTRAINT quote_request_reply_sent
    CHECK ((reply_sent_at IS NULL) = (reply_sent_by IS NULL)
       AND (reply_sent_at IS NULL) = (reply_notification_id IS NULL)
       AND (reply_sent_at IS NULL OR reply_body IS NOT NULL));
