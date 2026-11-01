-- Sales follow-up history (client meeting, 2026-11-01): every call, visit,
-- email or meeting with a lead, kept in order and never edited.

CREATE TABLE app.lead_activity (
  activity_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES app.lead (lead_id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('call', 'visit', 'email', 'meeting', 'note')),
  note text NOT NULL CHECK (length(note) BETWEEN 1 AND 2000),
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  created_by uuid NOT NULL REFERENCES auth.users (id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX lead_activity_lead ON app.lead_activity (lead_id, occurred_at DESC);

CREATE FUNCTION app.protect_lead_activity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'lead activities are append-only';
END;
$$;

REVOKE ALL ON FUNCTION app.protect_lead_activity() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER lead_activity_protect
  BEFORE UPDATE ON app.lead_activity
  FOR EACH ROW
  EXECUTE FUNCTION app.protect_lead_activity();

ALTER TABLE app.lead_activity ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE app.lead_activity FROM PUBLIC, anon, authenticated;
