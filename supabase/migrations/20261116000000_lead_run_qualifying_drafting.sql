-- A search run now has two more working steps after scoring:
--   qualifying: the run's qualified / disqualified / failed counts are worked out and saved;
--   drafting:   a first email is drafted for each qualified business that has an address.
-- Drafts are only ever pending here: nothing is sent, a person approves each one.

ALTER TABLE app.lead_campaign_run
  DROP CONSTRAINT lead_campaign_run_current_step_check,
  DROP CONSTRAINT lead_campaign_run_step_matches_status;

ALTER TABLE app.lead_campaign_run
  ADD CONSTRAINT lead_campaign_run_current_step_check CHECK (current_step IN (
    'queued', 'searching', 'enriching', 'scoring', 'qualifying', 'drafting',
    'ready', 'failed', 'cancelled'
  )),
  -- While running the step is one of the five working steps; otherwise it equals
  -- the status, so the two columns cannot disagree.
  ADD CONSTRAINT lead_campaign_run_step_matches_status CHECK (
    CASE WHEN status = 'running'
      THEN current_step IN ('searching', 'enriching', 'scoring', 'qualifying', 'drafting')
      ELSE current_step = status
    END
  );
