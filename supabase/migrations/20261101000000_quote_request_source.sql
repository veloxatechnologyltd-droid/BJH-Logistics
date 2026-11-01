-- Where a quote request came in: the customer portal, entered by staff, an
-- email, or the public website's quote form. Each way in sets it when the
-- request is created.
--
-- Requests made before this was recorded keep a null source, except emailed
-- ones: the stored email still says whether it came through the website form
-- (its message ID starts with "website:") or was a real email.
ALTER TABLE app.quote_request
  ADD COLUMN source text
    CHECK (source IS NULL OR source IN ('portal', 'staff', 'email', 'website'));

UPDATE app.quote_request AS request
SET source = CASE WHEN email.message_id LIKE 'website:%' THEN 'website' ELSE 'email' END
FROM app.inbound_email AS email
WHERE email.email_id = request.inbound_email_id;

-- A request has an email behind it exactly when it came by email or the website.
ALTER TABLE app.quote_request
  ADD CONSTRAINT quote_request_source_matches_email
    CHECK (COALESCE(source IN ('email', 'website'), false) = (inbound_email_id IS NOT NULL));
