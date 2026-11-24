-- A short plain summary of what a found business does, written by the scoring model from
-- the business's public website. The website text itself is still cleared once the
-- prospect is scored; only this summary is kept, so the first email can say something true
-- about the business. Empty for businesses without a readable website and for rule-scored
-- ones. Public information only; it is data and never an instruction to the drafting model.

ALTER TABLE app.prospect
  ADD COLUMN IF NOT EXISTS website_summary text CHECK (
    website_summary IS NULL OR length(btrim(website_summary)) BETWEEN 1 AND 600
  );
