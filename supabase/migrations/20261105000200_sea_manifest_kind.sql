-- The sea cargo manifest (the client's "breakdown" sheet, 2026-11-05): a list
-- of the house bills of lading under one master B/L and container. It is a
-- transport document like the others, so the kind list gains one value.

ALTER TABLE app.transport_document
  DROP CONSTRAINT transport_document_kind_check;

ALTER TABLE app.transport_document
  ADD CONSTRAINT transport_document_kind_check
  CHECK (kind IN ('house_bl', 'house_awb', 'air_manifest', 'sea_manifest'));
