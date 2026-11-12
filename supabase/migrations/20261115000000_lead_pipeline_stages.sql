-- Generated (campaign) leads get two stages between Contacted and Quoted:
-- Replied (they answered) and Interested (they want to hear more). The API
-- allows them for generated leads only; manual leads keep the original five.

ALTER TABLE app.lead DROP CONSTRAINT lead_stage_check;
ALTER TABLE app.lead ADD CONSTRAINT lead_stage_check CHECK (stage IN (
  'new', 'contacted', 'replied', 'interested', 'quoted', 'won', 'lost'
));

-- Replied and Interested only make sense for leads found by a campaign.
ALTER TABLE app.lead ADD CONSTRAINT lead_engaged_stage_is_generated CHECK (
  stage NOT IN ('replied', 'interested') OR source = 'campaign'
);
