-- The assistant opens a lead when a first-time sender asks for a quote, so a
-- lead may have no person as its creator. Every lead has exactly one of the
-- two, the same rule quotes follow.
ALTER TABLE app.lead
  ALTER COLUMN created_by DROP NOT NULL,
  ADD COLUMN created_by_assistant boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT lead_creator_check
    CHECK ((created_by IS NULL) = created_by_assistant);
