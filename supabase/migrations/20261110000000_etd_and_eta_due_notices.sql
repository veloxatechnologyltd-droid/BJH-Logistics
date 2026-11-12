-- ETD and "ETA reached" notices (client meeting, 2026-11-10).
--   job.etd_at: the estimated departure (ETD) staff record by hand, next to the
--     ETA. One current value; the ETA keeps its own append-only history.
--   eta_due notices: when a job's current ETA passes and the job is still open,
--     the people working it get a notice that stays until they dismiss it. One
--     per person and ETA, through the dedupe key, so a new ETA raises a new one.

ALTER TABLE app.job ADD COLUMN etd_at timestamptz;

ALTER TABLE app.staff_notification
  DROP CONSTRAINT staff_notification_kind_check,
  DROP CONSTRAINT staff_notification_subject_check,
  ADD COLUMN job_id uuid REFERENCES app.job (job_id),
  ADD CONSTRAINT staff_notification_kind_check CHECK (
    kind IN ('request_overdue', 'inquiry_overdue', 'reminder', 'vehicle_due', 'eta_due')
  ),
  ADD CONSTRAINT staff_notification_subject_check CHECK (
    kind = 'reminder'
    OR (kind = 'vehicle_due' AND vehicle_id IS NOT NULL AND dedupe_key IS NOT NULL)
    OR (kind = 'eta_due' AND job_id IS NOT NULL AND dedupe_key IS NOT NULL)
    OR (kind IN ('request_overdue', 'inquiry_overdue') AND quote_request_id IS NOT NULL)
  );

CREATE INDEX staff_notification_job
  ON app.staff_notification (job_id) WHERE job_id IS NOT NULL;
