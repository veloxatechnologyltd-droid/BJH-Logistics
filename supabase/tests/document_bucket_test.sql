BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(7);

SELECT extensions.ok(
  EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'job-documents'),
  'the job document bucket exists'
);
SELECT extensions.is(
  (SELECT public FROM storage.buckets WHERE id = 'job-documents'),
  false,
  'the job document bucket is private'
);
SELECT extensions.ok(
  (SELECT file_size_limit FROM storage.buckets WHERE id = 'job-documents') <= 26214400
  AND (SELECT allowed_mime_types FROM storage.buckets WHERE id = 'job-documents')
      <@ ARRAY['application/pdf', 'image/png', 'image/jpeg',
               'application/octet-stream'],  -- sales email attachments (20261118000600)
  'the bucket limits size and file types'
);
SELECT extensions.ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'storage.objects'::regclass),
  'row level security is enabled on storage objects'
);
SELECT extensions.is(
  (SELECT count(*) FROM pg_policies
   WHERE schemaname = 'storage' AND tablename = 'objects'
     AND (qual ILIKE '%job-documents%' OR with_check ILIKE '%job-documents%')),
  0::bigint,
  'no storage policy grants access to the job document bucket'
);

INSERT INTO storage.objects (bucket_id, name, owner_id)
VALUES ('job-documents', 'synthetic/check.pdf', NULL);

SET LOCAL ROLE anon;
SELECT extensions.is(
  (SELECT count(*) FROM storage.objects WHERE bucket_id = 'job-documents'),
  0::bigint,
  'anon cannot see job document objects'
);
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT extensions.is(
  (SELECT count(*) FROM storage.objects WHERE bucket_id = 'job-documents'),
  0::bigint,
  'authenticated users cannot see job document objects'
);
RESET ROLE;

SELECT * FROM extensions.finish();
ROLLBACK;
