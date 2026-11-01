-- Vessel and ports on a job (client meeting, 2026-11-01), so the jobs list and
-- board can be filtered by them. Free text, optional, kept up to date by staff;
-- the shipping documents stay the source of truth.

ALTER TABLE app.job
  ADD COLUMN vessel text CHECK (vessel IS NULL OR length(vessel) BETWEEN 1 AND 120),
  ADD COLUMN port_of_loading text
    CHECK (port_of_loading IS NULL OR length(port_of_loading) BETWEEN 1 AND 120),
  ADD COLUMN port_of_discharge text
    CHECK (port_of_discharge IS NULL OR length(port_of_discharge) BETWEEN 1 AND 120);
