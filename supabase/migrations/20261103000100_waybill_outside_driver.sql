-- A waybill may name a driver or a vehicle from outside BJH (a hired truck).
-- Then there is no driver/vehicle record; the frozen name, phone and
-- registration typed on the waybill are the only copy, as for internal ones.
ALTER TABLE app.delivery
  ALTER COLUMN driver_id DROP NOT NULL,
  ALTER COLUMN vehicle_id DROP NOT NULL,
  ADD CONSTRAINT delivery_driver_text_check CHECK (
    length(btrim(driver_name)) BETWEEN 1 AND 160
    AND length(btrim(driver_phone)) BETWEEN 1 AND 40
  ) NOT VALID,
  ADD CONSTRAINT delivery_vehicle_text_check CHECK (
    length(btrim(vehicle_registration)) BETWEEN 1 AND 40
  ) NOT VALID;
