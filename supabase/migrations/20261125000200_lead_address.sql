-- A lead's address, so the Leads table can show it in its own column. Leads found by a
-- campaign take the business's address from the prospect (until now it was only a line
-- inside the notes); a lead typed in by hand may leave it empty.

ALTER TABLE app.lead
  ADD COLUMN IF NOT EXISTS address text CHECK (
    address IS NULL OR length(btrim(address)) BETWEEN 1 AND 500
  );

UPDATE app.lead lead
SET address = btrim(prospect.address)
FROM app.prospect prospect
WHERE prospect.promoted_lead_id = lead.lead_id
  AND lead.address IS NULL
  AND length(btrim(COALESCE(prospect.address, ''))) BETWEEN 1 AND 500;
