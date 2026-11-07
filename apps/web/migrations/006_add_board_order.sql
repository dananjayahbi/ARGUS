-- Up Migration
ALTER TABLE issues
  ADD COLUMN board_order DOUBLE PRECISION;

UPDATE issues
   SET board_order = issue_number;

ALTER TABLE issues
  ALTER COLUMN board_order SET NOT NULL,
  ALTER COLUMN board_order SET DEFAULT 0;

CREATE INDEX idx_issues_project_status_order
  ON issues (project_id, status, board_order);

-- Down Migration
DROP INDEX IF EXISTS idx_issues_project_status_order;

ALTER TABLE issues
  DROP COLUMN IF EXISTS board_order;
