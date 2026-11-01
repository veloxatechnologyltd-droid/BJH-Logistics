-- Moves accounts from the old per-mode roles to the new ones (Evans, 2026-11-01):
-- air or sea import -> import_rep, air or sea export -> export_rep.
--
-- Production: run only after the API that understands the new roles is live;
-- the API before it does not recognise import_rep or export_rep.
--
-- Assignments are immutable, so each old role is revoked and the new one is
-- assigned by whoever assigned the old one (the audit trigger records both).

INSERT INTO app.staff_role_assignment (user_id, role_key, assigned_by)
SELECT DISTINCT ON (legacy.user_id, replacement.role_key)
  legacy.user_id,
  replacement.role_key,
  legacy.assigned_by
FROM app.staff_role_assignment AS legacy
JOIN (VALUES
  ('air_import_rep', 'import_rep'),
  ('sea_import_rep', 'import_rep'),
  ('air_export_rep', 'export_rep'),
  ('sea_export_rep', 'export_rep')
) AS replacement (legacy_key, role_key)
  ON replacement.legacy_key = legacy.role_key
WHERE legacy.revoked_at IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM app.staff_role_assignment AS current
    WHERE current.user_id = legacy.user_id
      AND current.role_key = replacement.role_key
      AND current.revoked_at IS NULL
  )
ORDER BY legacy.user_id, replacement.role_key, legacy.assigned_at;

UPDATE app.staff_role_assignment
SET revoked_at = greatest(now(), assigned_at)
WHERE revoked_at IS NULL
  AND role_key IN (
    'air_import_rep', 'sea_import_rep', 'air_export_rep', 'sea_export_rep'
  );

UPDATE app.job_task
SET assigned_role = CASE assigned_role
  WHEN 'air_import_rep' THEN 'import_rep'
  WHEN 'sea_import_rep' THEN 'import_rep'
  WHEN 'air_export_rep' THEN 'export_rep'
  WHEN 'sea_export_rep' THEN 'export_rep'
END
WHERE assigned_role IN (
  'air_import_rep', 'sea_import_rep', 'air_export_rep', 'sea_export_rep'
);
