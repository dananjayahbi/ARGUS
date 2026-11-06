-- Up Migration
-- PostgreSQL 12 does not provide gen_random_uuid() without pgcrypto.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  key VARCHAR(10) NOT NULL UNIQUE,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE issues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  issue_number BIGSERIAL NOT NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  priority SMALLINT NOT NULL CHECK (priority BETWEEN 0 AND 100),
  status VARCHAR(20) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'pending', 'working', 'reconsider', 'completed')),
  report_type VARCHAR(20) NOT NULL DEFAULT 'screenshot'
    CHECK (report_type IN ('screenshot', 'full_page', 'text_only')),
  raw_image_url TEXT,
  annotated_image_url TEXT,
  canvas_state JSONB,
  audio_note_url TEXT,
  environment_info JSONB,
  console_logs JSONB,
  ephemeral_token VARCHAR(255),
  token_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON COLUMN issues.issue_number IS
  'Globally allocated BIGSERIAL value; unique per project via idx_project_issue_number. Gaps are allowed.';

-- Down Migration
DROP TABLE IF EXISTS issues;
DROP TABLE IF EXISTS projects;
