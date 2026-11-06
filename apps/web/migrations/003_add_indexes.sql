-- Up Migration
-- issue_number is a global BIGSERIAL, so this unique index is what enforces
-- project-scoped uniqueness. Numbers may have gaps; that is intentional.
CREATE UNIQUE INDEX idx_project_issue_number ON issues (project_id, issue_number);
CREATE INDEX idx_issues_status ON issues (status);
CREATE INDEX idx_issues_project_status ON issues (project_id, status);
CREATE INDEX idx_reconsider_issue ON issue_reconsider_notes (issue_id);

-- Down Migration
DROP INDEX IF EXISTS idx_reconsider_issue;
DROP INDEX IF EXISTS idx_issues_project_status;
DROP INDEX IF EXISTS idx_issues_status;
DROP INDEX IF EXISTS idx_project_issue_number;
