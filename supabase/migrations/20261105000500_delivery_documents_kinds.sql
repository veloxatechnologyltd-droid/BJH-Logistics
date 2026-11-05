-- The delivery order and the proof of delivery note (BJH's samples, 2026-11-05):
-- sea-job documents prepared like the other transport documents, so the kind
-- list gains two values.

ALTER TABLE app.transport_document
  DROP CONSTRAINT transport_document_kind_check;

ALTER TABLE app.transport_document
  ADD CONSTRAINT transport_document_kind_check
  CHECK (kind IN (
    'house_bl', 'house_awb', 'air_manifest', 'sea_manifest',
    'delivery_order', 'proof_of_delivery'
  ));
