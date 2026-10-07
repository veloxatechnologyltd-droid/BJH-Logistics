BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(12);

SELECT extensions.ok(
  NOT has_table_privilege('anon', 'app.delivery', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'app.driver', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'app.vehicle', 'SELECT')
  AND (SELECT relrowsecurity FROM pg_class WHERE oid = 'app.delivery'::regclass)
  AND (SELECT relrowsecurity FROM pg_class WHERE oid = 'app.driver'::regclass)
  AND (SELECT relrowsecurity FROM pg_class WHERE oid = 'app.vehicle'::regclass),
  'transport records are private: no grants and row level security is on'
);

INSERT INTO auth.users (id, aud, role, email, encrypted_password)
VALUES ('00000000-0000-4000-8000-0000000000aa', 'authenticated', 'authenticated', 'delivery-test@example.test', '');
INSERT INTO app.customer_company (company_id, company_name)
VALUES ('00000000-0000-4000-8000-0000000000ba', 'Synthetic Delivery Ltd');
INSERT INTO app.job (job_id, file_number, service_line, customer_company_id, opened_by)
VALUES ('00000000-0000-4000-8000-0000000000ca', 'BJH/SI/2099/9101', 'sea_import',
        '00000000-0000-4000-8000-0000000000ba', '00000000-0000-4000-8000-0000000000aa');
INSERT INTO app.document (document_id, job_id, document_type, created_by)
VALUES ('00000000-0000-4000-8000-0000000000da', '00000000-0000-4000-8000-0000000000ca',
        'delivery_note', '00000000-0000-4000-8000-0000000000aa'),
       ('00000000-0000-4000-8000-0000000000db', '00000000-0000-4000-8000-0000000000ca',
        'commercial_invoice', '00000000-0000-4000-8000-0000000000aa');
INSERT INTO app.driver (driver_id, driver_name, phone, created_by)
VALUES ('00000000-0000-4000-8000-0000000000ea', 'Synthetic Driver', '000', '00000000-0000-4000-8000-0000000000aa');
INSERT INTO app.vehicle (vehicle_id, registration, created_by)
VALUES ('00000000-0000-4000-8000-0000000000fa', 'GX 1-26', '00000000-0000-4000-8000-0000000000aa');

SELECT extensions.throws_ok(
  $$INSERT INTO app.vehicle (registration, created_by)
    VALUES ('gx 1-26', '00000000-0000-4000-8000-0000000000aa')$$,
  '23505', NULL, 'a registration is unique regardless of case'
);
SELECT extensions.is(
  app.allocate_waybill_number(2098),
  'BJH/WB/2098/0001',
  'waybill numbers default to the BJH/WB prefix'
);
SELECT extensions.is(
  app.allocate_waybill_number(2098, 'SYN/WB'),
  'SYN/WB/2098/0002',
  'waybill numbers take the configured prefix and keep counting'
);

INSERT INTO app.delivery (delivery_id, job_id, waybill_number, driver_id, vehicle_id, driver_name,
  driver_phone, vehicle_registration, cargo_description, delivery_address, dispatched_by)
VALUES ('00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-0000000000ca',
        'BJH/WB/2099/9001', '00000000-0000-4000-8000-0000000000ea',
        '00000000-0000-4000-8000-0000000000fa', 'Synthetic Driver', '000', 'GX 1-26',
        'Synthetic goods', '1 Test Road', '00000000-0000-4000-8000-0000000000aa');

SELECT extensions.throws_ok(
  $$INSERT INTO app.delivery (job_id, waybill_number, driver_id, vehicle_id, driver_name,
      driver_phone, vehicle_registration, cargo_description, delivery_address, dispatched_by)
    VALUES ('00000000-0000-4000-8000-0000000000ca', 'BJH/WB/2099/9001',
            '00000000-0000-4000-8000-0000000000ea', '00000000-0000-4000-8000-0000000000fa',
            'x', 'x', 'x', 'x', 'x', '00000000-0000-4000-8000-0000000000aa')$$,
  '23505', NULL, 'a waybill number is used once'
);
SELECT extensions.throws_ok(
  $$UPDATE app.delivery SET cargo_description = 'changed'
    WHERE delivery_id = '00000000-0000-4000-8000-0000000000a0'$$,
  'an issued waybill is immutable',
  'the cargo on an issued waybill cannot change'
);
SELECT extensions.throws_ok(
  $$UPDATE app.delivery SET driver_name = 'Someone else'
    WHERE delivery_id = '00000000-0000-4000-8000-0000000000a0'$$,
  'an issued waybill is immutable',
  'the frozen driver name cannot change'
);
SELECT extensions.throws_ok(
  $$UPDATE app.delivery SET status = 'delivered'
    WHERE delivery_id = '00000000-0000-4000-8000-0000000000a0'$$,
  '23514', NULL, 'delivered needs the receiver and time'
);
SELECT extensions.throws_ok(
  $$UPDATE app.delivery SET status = 'delivered', receiver_name = 'R', delivered_at = now(),
      pod_recorded_by = '00000000-0000-4000-8000-0000000000aa', pod_recorded_at = now(),
      pod_document_id = '00000000-0000-4000-8000-0000000000db'
    WHERE delivery_id = '00000000-0000-4000-8000-0000000000a0'$$,
  'the proof of delivery document must be a delivery note on the same job',
  'the proof document must be a delivery note'
);
SELECT extensions.lives_ok(
  $$UPDATE app.delivery SET status = 'delivered', receiver_name = 'A. Receiver', delivered_at = now(),
      damage_notes = 'None', pod_document_id = '00000000-0000-4000-8000-0000000000da',
      pod_recorded_by = '00000000-0000-4000-8000-0000000000aa', pod_recorded_at = now()
    WHERE delivery_id = '00000000-0000-4000-8000-0000000000a0'$$,
  'the proof of delivery can be recorded'
);
SELECT extensions.throws_ok(
  $$UPDATE app.delivery SET receiver_name = 'Someone else'
    WHERE delivery_id = '00000000-0000-4000-8000-0000000000a0'$$,
  'the proof of delivery is already recorded',
  'the proof of delivery is recorded once'
);
SELECT extensions.throws_ok(
  $$DELETE FROM app.delivery$$,
  'deliveries cannot be deleted',
  'a delivery cannot be deleted'
);

SELECT * FROM extensions.finish();
ROLLBACK;
