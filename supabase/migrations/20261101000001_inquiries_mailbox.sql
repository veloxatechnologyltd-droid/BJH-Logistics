-- A second mailbox for inquiries, kept apart from quote requests, answered from
-- a knowledge base BJH writes, and escalated to a person when the knowledge
-- base does not answer the question or the email is unclear.

-- Which mailbox a request belongs to. The mailbox the email reached decides;
-- a person may move it. Requests made any other way are quote requests.
ALTER TABLE app.quote_request
  ADD COLUMN mailbox text NOT NULL DEFAULT 'quotes'
    CHECK (mailbox IN ('quotes', 'inquiries')),
  -- The assistant could not answer by itself: a person must read and send the reply.
  ADD COLUMN escalated_at timestamptz,
  ADD COLUMN escalation_reason text
    CHECK (escalation_reason IS NULL OR length(escalation_reason) BETWEEN 1 AND 1000),
  -- The knowledge entries (titles, as they were) the drafted reply drew on.
  ADD COLUMN reply_sources jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(reply_sources) = 'array'),
  ADD CONSTRAINT quote_request_escalation_pair
    CHECK ((escalated_at IS NULL) = (escalation_reason IS NULL));

CREATE INDEX quote_request_mailbox ON app.quote_request (mailbox, created_at DESC);

-- What the assistant may tell people who ask: one topic and its answer per entry.
CREATE TABLE app.knowledge_entry (
  entry_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  answer text NOT NULL CHECK (length(answer) BETWEEN 1 AND 5000),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_by uuid NOT NULL REFERENCES auth.users (id)
);

ALTER TABLE app.knowledge_entry ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE app.knowledge_entry FROM PUBLIC, anon, authenticated;
