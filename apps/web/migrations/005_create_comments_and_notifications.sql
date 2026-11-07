-- Up Migration
CREATE TABLE issue_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id UUID NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  author_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  author_role VARCHAR(20) NOT NULL CHECK (author_role IN ('developer', 'qa')),
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE issue_comment_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  comment_id UUID NOT NULL REFERENCES issue_comments(id) ON DELETE CASCADE,
  asset_url TEXT NOT NULL,
  asset_type VARCHAR(100) NOT NULL,
  file_name VARCHAR(255),
  size_bytes BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  issue_id UUID NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  comment_id UUID REFERENCES issue_comments(id) ON DELETE CASCADE,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_role VARCHAR(20) NOT NULL CHECK (actor_role IN ('developer', 'qa')),
  kind VARCHAR(20) NOT NULL DEFAULT 'comment'
    CHECK (kind IN ('comment')),
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_issue_comments_issue
  ON issue_comments (issue_id, created_at);

CREATE INDEX idx_comment_attachments_comment
  ON issue_comment_attachments (comment_id);

CREATE INDEX idx_notifications_user_created
  ON notifications (user_id, created_at DESC);

CREATE INDEX idx_notifications_unread
  ON notifications (user_id)
  WHERE read_at IS NULL;

-- Down Migration
DROP TABLE IF EXISTS notifications;
DROP TABLE IF EXISTS issue_comment_attachments;
DROP TABLE IF EXISTS issue_comments;
