-- Notices for staff, shown in the workspace (client meeting, 2026-11-01):
--   request_overdue / inquiry_overdue: raised for customer service when a quote
--     request has had no quote sent, or an inquiry no reply, for two days;
--   reminder: "I will attend to this on <date, time>", set by a person (or the
--     assistant on their behalf); it pops up on their screen when due.
-- Each notice belongs to one person, so dismissing it is theirs alone.

CREATE TABLE app.staff_notification (
  notification_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id),
  kind text NOT NULL CHECK (kind IN ('request_overdue', 'inquiry_overdue', 'reminder')),
  quote_request_id uuid REFERENCES app.quote_request (request_id),
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  note text CHECK (note IS NULL OR length(note) <= 500),
  due_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  -- Null when the system raised it.
  created_by uuid REFERENCES auth.users (id),
  dismissed_at timestamptz,
  CHECK (kind = 'reminder' OR quote_request_id IS NOT NULL)
);

-- An overdue notice is raised once per person and request.
CREATE UNIQUE INDEX staff_notification_overdue_once
  ON app.staff_notification (user_id, kind, quote_request_id)
  WHERE kind <> 'reminder';
CREATE INDEX staff_notification_open
  ON app.staff_notification (user_id, due_at)
  WHERE dismissed_at IS NULL;

ALTER TABLE app.staff_notification ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE app.staff_notification FROM PUBLIC, anon, authenticated;
