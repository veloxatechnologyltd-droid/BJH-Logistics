-- Social media pages of a found business (Facebook, Instagram, LinkedIn, X, YouTube,
-- TikTok), as the search tool reports them from the business's website. A JSON
-- object of platform -> list of page links; the API checks every link belongs to its
-- platform before storing it. Staff only, like the rest of app.prospect.

ALTER TABLE app.prospect
  ADD COLUMN social_links jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD CONSTRAINT prospect_social_links_shape CHECK (
    jsonb_typeof(social_links) = 'object' AND pg_column_size(social_links) <= 4000
  );
