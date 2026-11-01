-- Bra Evans, the staff helper (2026-11-01): each person's past conversations,
-- kept so they can be reopened from the sidebar. Private to the person who
-- had them; only the API reads or writes them.

CREATE TABLE app.assistant_conversation (
  conversation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  -- The conversation as the model sees it, tool calls and results included.
  messages jsonb NOT NULL CHECK (jsonb_typeof(messages) = 'array'),
  -- What the screen shows: the person's questions, the answers and confirmed actions.
  lines jsonb NOT NULL CHECK (jsonb_typeof(lines) = 'array'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX assistant_conversation_user
  ON app.assistant_conversation (user_id, updated_at DESC);

ALTER TABLE app.assistant_conversation ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE app.assistant_conversation FROM PUBLIC, anon, authenticated;
