-- Departments as BJH works them (client meeting, 2026-11-01): one import rep and
-- one export rep (sea and air each), customer service, sales and finance.
--
-- The old per-mode roles stay allowed so the API still deployed keeps working;
-- 20261101000013 converts existing accounts once the new API is live.

ALTER TABLE app.staff_role_assignment
  DROP CONSTRAINT staff_role_assignment_role_key_check,
  ADD CONSTRAINT staff_role_assignment_role_key_check CHECK (
    role_key IN (
      'super_admin',
      'import_rep',
      'export_rep',
      'customer_service_rep',
      'sales_rep',
      'finance_rep',
      'air_import_rep',
      'air_export_rep',
      'sea_import_rep',
      'sea_export_rep'
    )
  );

ALTER TABLE app.job_task
  DROP CONSTRAINT job_task_assigned_role_check,
  ADD CONSTRAINT job_task_assigned_role_check CHECK (
    assigned_role IN (
      'super_admin',
      'import_rep',
      'export_rep',
      'customer_service_rep',
      'sales_rep',
      'finance_rep',
      'air_import_rep',
      'air_export_rep',
      'sea_import_rep',
      'sea_export_rep'
    )
  );

CREATE OR REPLACE FUNCTION app.current_user_can_read_workflow(
  requested_mode text,
  requested_direction text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM app.staff_role_assignment AS assignment
    WHERE assignment.user_id = (SELECT auth.uid())
      AND assignment.revoked_at IS NULL
      AND (
        assignment.role_key IN (
          'super_admin', 'customer_service_rep', 'sales_rep', 'finance_rep'
        )
        OR (assignment.role_key = 'import_rep' AND requested_direction = 'import')
        OR (assignment.role_key = 'export_rep' AND requested_direction = 'export')
        OR (assignment.role_key = 'air_import_rep'
          AND requested_mode = 'air' AND requested_direction = 'import')
        OR (assignment.role_key = 'air_export_rep'
          AND requested_mode = 'air' AND requested_direction = 'export')
        OR (assignment.role_key = 'sea_import_rep'
          AND requested_mode = 'sea' AND requested_direction = 'import')
        OR (assignment.role_key = 'sea_export_rep'
          AND requested_mode = 'sea' AND requested_direction = 'export')
      )
  );
$$;

CREATE OR REPLACE FUNCTION app.current_user_can_manage_workflow(
  requested_mode text,
  requested_direction text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM app.staff_role_assignment AS assignment
    WHERE assignment.user_id = (SELECT auth.uid())
      AND assignment.revoked_at IS NULL
      AND (
        (assignment.role_key = 'import_rep' AND requested_direction = 'import')
        OR (assignment.role_key = 'export_rep' AND requested_direction = 'export')
        OR (assignment.role_key = 'air_import_rep'
          AND requested_mode = 'air' AND requested_direction = 'import')
        OR (assignment.role_key = 'air_export_rep'
          AND requested_mode = 'air' AND requested_direction = 'export')
        OR (assignment.role_key = 'sea_import_rep'
          AND requested_mode = 'sea' AND requested_direction = 'import')
        OR (assignment.role_key = 'sea_export_rep'
          AND requested_mode = 'sea' AND requested_direction = 'export')
      )
  );
$$;
