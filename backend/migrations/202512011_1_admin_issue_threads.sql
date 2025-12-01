-- Admin issue threads + status tracking for replies
ALTER TABLE issue_reports
    ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'open',
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS issue_reports_status_updated_idx
    ON issue_reports (status, updated_at DESC);

CREATE TABLE IF NOT EXISTS issue_report_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    issue_id UUID NOT NULL REFERENCES issue_reports(id) ON DELETE CASCADE,
    sender_id UUID,
    sender_type TEXT NOT NULL CHECK (sender_type IN ('user', 'admin')),
    body TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS issue_report_messages_issue_created_idx
    ON issue_report_messages (issue_id, created_at);

-- Rollback:
--   DROP TABLE IF EXISTS issue_report_messages;
--   ALTER TABLE issue_reports DROP COLUMN IF EXISTS updated_at;
--   ALTER TABLE issue_reports DROP COLUMN IF EXISTS status;
