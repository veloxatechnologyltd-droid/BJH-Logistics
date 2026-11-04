-- A job report can be emailed to the client (client walkthrough, 2026-11-03).
-- The notification keeps which jobs and dates the report covers, so the
-- dispatcher can build the PDF when it sends the email.
ALTER TABLE app.notification
  ADD COLUMN job_report_query jsonb
    CHECK (job_report_query IS NULL OR jsonb_typeof(job_report_query) = 'object');
