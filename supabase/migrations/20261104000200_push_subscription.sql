-- Web Push (Evans, 2026-11-04): a staff member's browser or phone that has
-- agreed to receive notifications, so new messages and requests reach them
-- even when BJH is not open. One row per browser subscription (its endpoint is
-- unique, so signing in as someone else on the same browser moves it).
-- Only the API reads or writes them; the keys are what encrypts each message.

CREATE TABLE app.push_subscription (
  push_subscription_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id),
  endpoint text NOT NULL UNIQUE
    CHECK (endpoint LIKE 'https://%' AND length(endpoint) <= 2048),
  p256dh text NOT NULL CHECK (length(p256dh) BETWEEN 1 AND 256),
  auth text NOT NULL CHECK (length(auth) BETWEEN 1 AND 256),
  user_agent text CHECK (length(user_agent) <= 400),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX push_subscription_user ON app.push_subscription (user_id);

ALTER TABLE app.push_subscription ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE app.push_subscription FROM PUBLIC, anon, authenticated;
