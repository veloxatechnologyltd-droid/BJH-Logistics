-- Indexes for lookups that had none (docs/audit-2026-11-02.md, D5; D2 for the
-- jobs board). Purely additive: nothing in the API changes, queries and the
-- foreign-key checks on delete and update just stop scanning whole tables.
-- Columns that only record "who did it" (references to auth.users) are left out
-- on purpose; nobody looks rows up by them.

-- The jobs board filters by status and lists newest first.
CREATE INDEX IF NOT EXISTS job_status_opened ON app.job (status, opened_at DESC);
CREATE INDEX IF NOT EXISTS job_quote_request ON app.job (quote_request_id)
  WHERE quote_request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS quote_quote_request ON app.quote (quote_request_id)
  WHERE quote_request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS lead_customer_company ON app.lead (customer_company_id)
  WHERE customer_company_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS document_extraction_document
  ON app.document_extraction (document_id);
CREATE INDEX IF NOT EXISTS job_charge_quote_line ON app.job_charge (quote_line_id)
  WHERE quote_line_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS chat_message_job ON app.chat_message (job_id)
  WHERE job_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS staff_notification_quote_request
  ON app.staff_notification (quote_request_id)
  WHERE quote_request_id IS NOT NULL;
-- A customer's companies are found by their user on every portal request.
CREATE INDEX IF NOT EXISTS customer_membership_user
  ON app.customer_membership (user_id);
-- Unread counts in Team chat are found by user.
CREATE INDEX IF NOT EXISTS team_read_state_user ON app.team_read_state (user_id);
