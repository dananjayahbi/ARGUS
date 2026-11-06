-- Up Migration
CREATE TABLE issue_reconsider_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id UUID NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  author_role VARCHAR(20) NOT NULL CHECK (author_role IN ('developer', 'qa')),
  note TEXT NOT NULL,
  attachment_urls TEXT[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE issue_supplementary_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id UUID NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  asset_url TEXT NOT NULL,
  asset_type VARCHAR(50) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Down Migration
DROP TABLE IF EXISTS issue_supplementary_assets;
DROP TABLE IF EXISTS issue_reconsider_notes;
