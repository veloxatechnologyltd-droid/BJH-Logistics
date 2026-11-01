-- The check added with the source column rejected an emailed request that
-- records no source. The API running before this column existed records none, so
-- until the new API is deployed every emailed or website request would have
-- failed. Check the source only when one is recorded; the new API always
-- records one, so it is still held to agreeing with whether an email is behind
-- the request.
ALTER TABLE app.quote_request
  DROP CONSTRAINT quote_request_source_matches_email,
  ADD CONSTRAINT quote_request_source_matches_email
    CHECK (source IS NULL OR (source IN ('email', 'website')) = (inbound_email_id IS NOT NULL));
