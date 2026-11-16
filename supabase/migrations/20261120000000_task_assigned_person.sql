-- Tasks go to a person (Evans, 2026-11-16: each person holds one role, so a
-- task is assigned to the person, not to a role label). Also allows a to-do
-- that belongs to no job ("call the customs broker on Friday").
--
-- Additive: existing tasks keep their job and role and stay valid. New tasks
-- carry assigned_user_id; assigned_role is kept only for older rows and for
-- callers that still name a role. A task that belongs to no job must name a
-- person, so it always has someone who can see it.

ALTER TABLE app.job_task
  ADD COLUMN assigned_user_id uuid REFERENCES auth.users (id);

ALTER TABLE app.job_task ALTER COLUMN job_id DROP NOT NULL;
ALTER TABLE app.job_task ALTER COLUMN assigned_role DROP NOT NULL;

ALTER TABLE app.job_task
  ADD CONSTRAINT job_task_assignee_check
    CHECK (assigned_user_id IS NOT NULL OR assigned_role IS NOT NULL),
  ADD CONSTRAINT job_task_standalone_person_check
    CHECK (job_id IS NOT NULL OR assigned_user_id IS NOT NULL);

CREATE INDEX job_task_open_by_person ON app.job_task (assigned_user_id, due_date)
  WHERE status = 'open';
