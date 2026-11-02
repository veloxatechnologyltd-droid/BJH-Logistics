-- Internal team chat (Evans, 2026-11-02): staff talk to each other in direct
-- messages, groups anyone creates, and one channel per team (Sales, Customer
-- Service, Operations, Finance) whose members follow staff roles in the API.
-- Messages may tag people, jobs, invoices and documents; each reader sees a tag
-- only as far as their own access allows. Messages are kept as sent: never
-- edited or deleted. Customers never reach any of this.

CREATE TABLE app.team_conversation (
  conversation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('direct', 'group', 'team')),
  title text CHECK (title IS NULL OR length(title) BETWEEN 1 AND 80),
  -- A team channel's team; membership comes from staff roles, not rows below.
  team_key text UNIQUE
    CHECK (team_key IS NULL
      OR team_key IN ('sales', 'customer_service', 'operations', 'finance')),
  -- The two people of a direct conversation, smaller ID first, so each pair
  -- has exactly one.
  direct_key text UNIQUE,
  -- Null for the team channels, which the system creates.
  created_by uuid REFERENCES auth.users (id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((kind = 'team') = (team_key IS NOT NULL)),
  CHECK ((kind = 'direct') = (direct_key IS NOT NULL)),
  CHECK (kind <> 'group' OR title IS NOT NULL)
);

INSERT INTO app.team_conversation (kind, title, team_key) VALUES
  ('team', 'Sales', 'sales'),
  ('team', 'Customer Service', 'customer_service'),
  ('team', 'Operations', 'operations'),
  ('team', 'Finance', 'finance');

-- Members of direct conversations and groups. Leaving sets left_at; being
-- added again clears it. Rows are never deleted, so who was in a group is kept.
CREATE TABLE app.team_conversation_member (
  conversation_id uuid NOT NULL REFERENCES app.team_conversation (conversation_id),
  user_id uuid NOT NULL REFERENCES auth.users (id),
  added_by uuid REFERENCES auth.users (id),
  added_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  left_at timestamptz,
  PRIMARY KEY (conversation_id, user_id)
);

CREATE INDEX team_conversation_member_user
  ON app.team_conversation_member (user_id)
  WHERE left_at IS NULL;

CREATE TABLE app.team_message (
  message_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES app.team_conversation (conversation_id),
  -- Null for a message the system posts (for example "invoice accepted").
  author_user_id uuid REFERENCES auth.users (id),
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
  -- [{kind: user|job|invoice|document, id}]: what the message points to.
  tags jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(tags) = 'array'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX team_message_thread
  ON app.team_message (conversation_id, created_at);

CREATE FUNCTION app.protect_team_message()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'team chat messages are kept as sent';
END;
$$;

REVOKE ALL ON FUNCTION app.protect_team_message() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER team_message_protect
  BEFORE UPDATE OR DELETE ON app.team_message
  FOR EACH ROW
  EXECUTE FUNCTION app.protect_team_message();

CREATE FUNCTION app.protect_team_conversation_member()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'conversation members are kept; set left_at instead';
  END IF;
  IF NEW.conversation_id IS DISTINCT FROM OLD.conversation_id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'a membership cannot move to another conversation or person';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION app.protect_team_conversation_member() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER team_conversation_member_protect
  BEFORE UPDATE OR DELETE ON app.team_conversation_member
  FOR EACH ROW
  EXECUTE FUNCTION app.protect_team_conversation_member();

-- How far each person has read each conversation (for unread counts).
CREATE TABLE app.team_read_state (
  conversation_id uuid NOT NULL REFERENCES app.team_conversation (conversation_id),
  user_id uuid NOT NULL REFERENCES auth.users (id),
  last_read_at timestamptz NOT NULL,
  PRIMARY KEY (conversation_id, user_id)
);

ALTER TABLE app.team_conversation ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.team_conversation_member ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.team_message ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.team_read_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE app.team_conversation, app.team_conversation_member,
  app.team_message, app.team_read_state FROM PUBLIC, anon, authenticated;
