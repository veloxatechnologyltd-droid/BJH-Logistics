-- Details a job needs for the client job report (client sample, 2026-11-04):
-- a description of the goods, a free-text status remark and the date the job is
-- expected to finish. Free text, optional, kept by staff; the shipping documents
-- stay the source of truth.

ALTER TABLE app.job
  ADD COLUMN goods_description text
    CHECK (goods_description IS NULL OR length(goods_description) BETWEEN 1 AND 500),
  ADD COLUMN remarks text
    CHECK (remarks IS NULL OR length(remarks) BETWEEN 1 AND 300),
  ADD COLUMN expected_completion_date date;
