-- House B/L numbering (Evans, 2026-11-05): a house bill of lading is given the
-- next number in a yearly series, BJH/BL/<year>/<0001>, the same shape as
-- waybills, as soon as it is prepared, so the preview already shows it. A draft
-- that is voided keeps its number (a gap in the series is expected). Only the
-- API calls this.

CREATE TABLE app.house_bl_number_sequence (
  sequence_year integer PRIMARY KEY CHECK (sequence_year BETWEEN 2000 AND 2999),
  last_value integer NOT NULL DEFAULT 0 CHECK (last_value >= 0)
);

ALTER TABLE app.house_bl_number_sequence ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE app.house_bl_number_sequence FROM PUBLIC, anon, authenticated;

CREATE FUNCTION app.allocate_house_bl_number(
  p_year integer,
  p_prefix text DEFAULT 'BJH/BL'
)
RETURNS text
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  next_value integer;
BEGIN
  INSERT INTO app.house_bl_number_sequence (sequence_year, last_value)
  VALUES (p_year, 1)
  ON CONFLICT (sequence_year)
  DO UPDATE SET last_value = app.house_bl_number_sequence.last_value + 1
  RETURNING last_value INTO next_value;

  RETURN format(
    '%s/%s/%s',
    p_prefix,
    p_year,
    CASE WHEN next_value < 10000 THEN lpad(next_value::text, 4, '0') ELSE next_value::text END
  );
END;
$$;

REVOKE ALL ON FUNCTION app.allocate_house_bl_number(integer, text)
  FROM PUBLIC, anon, authenticated;
