-- A campaign can choose to have first emails drafted for the qualified businesses it
-- finds (generate_emails), and then carries what the drafting model needs to write them:
-- the context (what BJH offers and why it matters to this kind of business) and the
-- call to action (what the reader is asked to do). Existing campaigns stay leads-only.
-- Drafts are only ever pending: nothing here sends mail.

ALTER TABLE app.lead_campaign
  ADD COLUMN generate_emails boolean NOT NULL DEFAULT false,
  ADD COLUMN email_context text CHECK (
    email_context IS NULL OR length(btrim(email_context)) BETWEEN 1 AND 2000
  ),
  ADD COLUMN email_cta text CHECK (
    email_cta IS NULL OR length(btrim(email_cta)) BETWEEN 1 AND 500
  ),
  ADD CONSTRAINT lead_campaign_emails_need_brief CHECK (
    NOT generate_emails OR (email_context IS NOT NULL AND email_cta IS NOT NULL)
  );
