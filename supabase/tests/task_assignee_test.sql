BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(5);

INSERT INTO auth.users (id, aud, role, email, encrypted_password)
VALUES ('00000000-0000-4000-8000-0000000000a7', 'authenticated', 'authenticated', 'task-person@example.test', '');
INSERT INTO app.customer_company (company_id, company_name)
VALUES ('00000000-0000-4000-8000-0000000000b7', 'Synthetic Task Ltd');
INSERT INTO app.job (job_id, file_number, service_line, customer_company_id, opened_by)
VALUES ('00000000-0000-4000-8000-0000000000c7', 'BJH/SI/2099/0007', 'sea_import',
        '00000000-0000-4000-8000-0000000000b7', '00000000-0000-4000-8000-0000000000a7');

SELECT extensions.lives_ok(
  $$INSERT INTO app.job_task (job_id, kind, title, assigned_user_id, created_by)
    VALUES ('00000000-0000-4000-8000-0000000000c7', 'task', 'Chase the bill of lading',
            '00000000-0000-4000-8000-0000000000a7', '00000000-0000-4000-8000-0000000000a7')$$,
  'a job task can be assigned to a person with no role'
);
SELECT extensions.lives_ok(
  $$INSERT INTO app.job_task (kind, title, assigned_user_id, created_by)
    VALUES ('task', 'Call the customs broker', '00000000-0000-4000-8000-0000000000a7',
            '00000000-0000-4000-8000-0000000000a7')$$,
  'a to-do with no job can be assigned to a person'
);
SELECT extensions.throws_ok(
  $$INSERT INTO app.job_task (kind, title, assigned_role, created_by)
    VALUES ('task', 'Nobody can see this', 'sea_import_rep',
            '00000000-0000-4000-8000-0000000000a7')$$,
  '23514',
  NULL,
  'a to-do with no job must name a person'
);
SELECT extensions.throws_ok(
  $$INSERT INTO app.job_task (job_id, kind, title, created_by)
    VALUES ('00000000-0000-4000-8000-0000000000c7', 'task', 'Assigned to no one',
            '00000000-0000-4000-8000-0000000000a7')$$,
  '23514',
  NULL,
  'a task must name a person or a role'
);
SELECT extensions.lives_ok(
  $$INSERT INTO app.job_task (job_id, kind, title, assigned_role, created_by)
    VALUES ('00000000-0000-4000-8000-0000000000c7', 'task', 'Older role-only task',
            'sea_import_rep', '00000000-0000-4000-8000-0000000000a7')$$,
  'a task that names only a role is still accepted'
);

SELECT * FROM extensions.finish();
ROLLBACK;
