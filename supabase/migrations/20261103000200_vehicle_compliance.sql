-- Vehicle papers and servicing (client walkthrough, 2026-11-03): insurance
-- start and end, DVLA roadworthy expiry, and servicing every N months from
-- the last service. The super admin gets a notice 14 days before each date
-- and again on the day.
ALTER TABLE app.vehicle
  ADD COLUMN insurance_start_on date,
  ADD COLUMN insurance_end_on date,
  ADD COLUMN dvla_expires_on date,
  ADD COLUMN service_every_months smallint
    CHECK (service_every_months IS NULL OR service_every_months BETWEEN 1 AND 60),
  ADD COLUMN last_serviced_on date,
  ADD CONSTRAINT vehicle_insurance_order_check CHECK (
    insurance_start_on IS NULL OR insurance_end_on IS NULL
    OR insurance_end_on >= insurance_start_on
  );

-- Vehicle notices: one per person, vehicle, paper, date and stage, through a
-- dedupe key, so changing a date raises fresh notices for the new date.
ALTER TABLE app.staff_notification
  DROP CONSTRAINT staff_notification_kind_check,
  ADD CONSTRAINT staff_notification_kind_check CHECK (
    kind IN ('request_overdue', 'inquiry_overdue', 'reminder', 'vehicle_due')
  ),
  DROP CONSTRAINT staff_notification_check,
  ADD COLUMN vehicle_id uuid REFERENCES app.vehicle (vehicle_id),
  ADD COLUMN dedupe_key text CHECK (dedupe_key IS NULL OR length(dedupe_key) <= 200),
  ADD CONSTRAINT staff_notification_subject_check CHECK (
    kind = 'reminder'
    OR (kind = 'vehicle_due' AND vehicle_id IS NOT NULL AND dedupe_key IS NOT NULL)
    OR (kind IN ('request_overdue', 'inquiry_overdue') AND quote_request_id IS NOT NULL)
  );

CREATE UNIQUE INDEX staff_notification_dedupe_once
  ON app.staff_notification (user_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL;
CREATE INDEX staff_notification_vehicle
  ON app.staff_notification (vehicle_id) WHERE vehicle_id IS NOT NULL;
