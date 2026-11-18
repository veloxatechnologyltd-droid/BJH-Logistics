-- The written report follows the client's "Job Update & Performance Tracker"
-- form (Evans, 2026-11-18). A report names the person's department (the
-- client's seven). A daily report carries one or more job updates, as the
-- person chooses; each update is kept as sent, with the job's file number and
-- the next action's person copied in. A weekly review adds the tasks open at
-- the start and at the end of the week and the person's own department figure
-- (target, actual, action). Additive: older reports keep nulls.

ALTER TABLE app.performance_report
  ADD COLUMN department text CHECK (department IS NULL OR department IN (
    'customer_service', 'operations', 'documentation', 'field_operations',
    'finance', 'transport', 'sales_marketing')),
  ADD COLUMN job_updates jsonb
    CHECK (job_updates IS NULL OR (jsonb_typeof(job_updates) = 'array'
      AND jsonb_array_length(job_updates) BETWEEN 1 AND 20)),
  ADD COLUMN opening_active integer
    CHECK (opening_active IS NULL OR opening_active >= 0),
  ADD COLUMN closing_active integer
    CHECK (closing_active IS NULL OR closing_active >= 0),
  ADD COLUMN kpi_target text
    CHECK (kpi_target IS NULL OR length(kpi_target) BETWEEN 1 AND 1000),
  ADD COLUMN kpi_actual text
    CHECK (kpi_actual IS NULL OR length(kpi_actual) BETWEEN 1 AND 1000),
  ADD COLUMN kpi_action text
    CHECK (kpi_action IS NULL OR length(kpi_action) BETWEEN 1 AND 1000);
