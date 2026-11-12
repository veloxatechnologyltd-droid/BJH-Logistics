BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(1);

SELECT extensions.ok(
  NOT has_table_privilege('anon', 'app.sales_email_folder_membership', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'app.sales_email_folder_membership', 'SELECT')
  AND (SELECT relrowsecurity FROM pg_class
       WHERE oid = 'app.sales_email_folder_membership'::regclass),
  'folder membership is private to the API role'
);

SELECT extensions.finish();
ROLLBACK;
