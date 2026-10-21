-- AI document reading. When an AI key is set up, "Read details" sends the one
-- chosen PDF or image (scans and photos too) to the AI service, which proposes
-- the same shipment references. read_by records the model that read it; NULL
-- means the PDF's text layer was read inside the API, as before. A draft is
-- still only a proposal until a person applies it.

ALTER TABLE app.document_extraction
  ADD COLUMN read_by text CHECK (read_by IS NULL OR length(read_by) BETWEEN 1 AND 100);

CREATE OR REPLACE FUNCTION app.protect_document_extraction()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'extraction drafts cannot be deleted';
  END IF;
  IF OLD.status <> 'draft' THEN
    RAISE EXCEPTION 'a reviewed extraction cannot change';
  END IF;
  IF NEW.job_id IS DISTINCT FROM OLD.job_id
    OR NEW.document_id IS DISTINCT FROM OLD.document_id
    OR NEW.version_number IS DISTINCT FROM OLD.version_number
    OR NEW.text_found IS DISTINCT FROM OLD.text_found
    OR NEW.read_by IS DISTINCT FROM OLD.read_by
    OR NEW.fields IS DISTINCT FROM OLD.fields
    OR NEW.created_by IS DISTINCT FROM OLD.created_by
    OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'the proposed fields of an extraction never change';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION app.protect_document_extraction() FROM PUBLIC, anon, authenticated;
