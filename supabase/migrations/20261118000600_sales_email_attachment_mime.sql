-- Sales email attachments are stored under sales-email/ in the private
-- job-documents bucket as application/octet-stream (the sender's file type is
-- not trusted), which the bucket did not allow, so any incoming email with an
-- attachment stopped the mailbox sync. Allow that one generic type. Other
-- uploads are validated by the API and keep their own types.
UPDATE storage.buckets
SET allowed_mime_types = array_append(allowed_mime_types, 'application/octet-stream')
WHERE id = 'job-documents'
  AND NOT ('application/octet-stream' = ANY (allowed_mime_types));
