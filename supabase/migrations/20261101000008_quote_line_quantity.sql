-- Quote lines as the client asked (meeting, 2026-11-01): unit price, quantity
-- and total, with the container size an optional label on the line rather than
-- a required pair of price columns. amount_minor is the unit price; the total
-- is quantity x unit price. Lines priced per size column (earlier quotes) keep
-- working and always have a quantity of 1.

ALTER TABLE app.quote_line
  ADD COLUMN quantity integer NOT NULL DEFAULT 1
    CHECK (quantity BETWEEN 1 AND 100000),
  ADD COLUMN container_size text
    CHECK (container_size IS NULL OR length(container_size) BETWEEN 1 AND 30),
  ADD CONSTRAINT quote_line_sized_quantity
    CHECK (size_amounts_minor IS NULL OR quantity = 1);
