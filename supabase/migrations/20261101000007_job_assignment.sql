-- Who works a job (client meeting, 2026-11-01). Customer service assigns the
-- import or export rep who leads a job, and may add others to assist, once the
-- client has accepted the job's invoice. The super admin may assign earlier,
-- giving a reason.

-- The client's acceptance of an issued invoice: recorded once, by customer
-- service on the client's word or by the client in the portal.
CREATE TABLE app.invoice_acceptance (
  invoice_id uuid PRIMARY KEY REFERENCES app.invoice (invoice_id),
  accepted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  accepted_by uuid NOT NULL REFERENCES auth.users (id),
  signatory_name text NOT NULL CHECK (length(signatory_name) BETWEEN 1 AND 160),
  via text NOT NULL CHECK (via IN ('staff', 'portal'))
);

CREATE FUNCTION app.check_invoice_acceptance()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'invoice acceptances are append-only';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM app.invoice
    WHERE invoice_id = NEW.invoice_id AND status = 'issued'
  ) THEN
    RAISE EXCEPTION 'only an issued invoice can be accepted'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION app.check_invoice_acceptance() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER invoice_acceptance_check
  BEFORE INSERT OR UPDATE OR DELETE ON app.invoice_acceptance
  FOR EACH ROW
  EXECUTE FUNCTION app.check_invoice_acceptance();

ALTER TABLE app.invoice_acceptance ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE app.invoice_acceptance FROM PUBLIC, anon, authenticated;

-- One lead per job at a time, any number of assistants. Removing someone keeps
-- the row (who, when, by whom), so the history of who worked the job remains.
CREATE TABLE app.job_assignment (
  assignment_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES app.job (job_id),
  user_id uuid NOT NULL REFERENCES auth.users (id),
  kind text NOT NULL CHECK (kind IN ('lead', 'assistant')),
  assigned_by uuid NOT NULL REFERENCES auth.users (id),
  assigned_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  -- Set only when the super admin assigned before the client accepted an invoice.
  override_reason text CHECK (
    override_reason IS NULL OR length(override_reason) BETWEEN 1 AND 500
  ),
  removed_by uuid REFERENCES auth.users (id),
  removed_at timestamptz,
  CHECK ((removed_at IS NULL) = (removed_by IS NULL)),
  CHECK (removed_at IS NULL OR removed_at >= assigned_at)
);

CREATE UNIQUE INDEX job_assignment_one_lead
  ON app.job_assignment (job_id)
  WHERE kind = 'lead' AND removed_at IS NULL;
CREATE UNIQUE INDEX job_assignment_once_per_person
  ON app.job_assignment (job_id, user_id)
  WHERE removed_at IS NULL;
CREATE INDEX job_assignment_user ON app.job_assignment (user_id)
  WHERE removed_at IS NULL;

CREATE FUNCTION app.protect_job_assignment()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'job assignments are kept; remove them instead';
  END IF;
  IF ROW(NEW.assignment_id, NEW.job_id, NEW.user_id, NEW.kind,
         NEW.assigned_by, NEW.assigned_at, NEW.override_reason)
     IS DISTINCT FROM
     ROW(OLD.assignment_id, OLD.job_id, OLD.user_id, OLD.kind,
         OLD.assigned_by, OLD.assigned_at, OLD.override_reason)
     OR OLD.removed_at IS NOT NULL THEN
    RAISE EXCEPTION 'a job assignment can only be removed, once';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION app.protect_job_assignment() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER job_assignment_protect
  BEFORE UPDATE OR DELETE ON app.job_assignment
  FOR EACH ROW
  EXECUTE FUNCTION app.protect_job_assignment();

ALTER TABLE app.job_assignment ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE app.job_assignment FROM PUBLIC, anon, authenticated;
