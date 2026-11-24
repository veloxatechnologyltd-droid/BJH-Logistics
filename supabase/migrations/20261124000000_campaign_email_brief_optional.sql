-- The knowledge base in Settings now tells the drafting model what BJH offers, so a
-- campaign that writes emails no longer has to carry its own context and call to action.
-- Both stay optional text with the same length limits; only the rule that required them
-- is dropped. Loosens a rule only: no data changes.

ALTER TABLE app.lead_campaign
  DROP CONSTRAINT IF EXISTS lead_campaign_emails_need_brief;
