-- Track read states for issue report messages so user/admin inboxes can badge unread replies
ALTER TABLE issue_report_messages
    ADD COLUMN IF NOT EXISTS read_by_user_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS read_by_admin_at TIMESTAMPTZ;

UPDATE issue_report_messages
SET read_by_user_at = created_at
WHERE sender_type = 'user' AND read_by_user_at IS NULL;

UPDATE issue_report_messages
SET read_by_admin_at = created_at
WHERE sender_type = 'admin' AND read_by_admin_at IS NULL;

CREATE INDEX IF NOT EXISTS issue_report_messages_unread_user_idx
    ON issue_report_messages (issue_id)
    WHERE sender_type = 'admin' AND read_by_user_at IS NULL;

CREATE INDEX IF NOT EXISTS issue_report_messages_unread_admin_idx
    ON issue_report_messages (issue_id)
    WHERE sender_type = 'user' AND read_by_admin_at IS NULL;

-- Rollback:
--   DROP INDEX IF EXISTS issue_report_messages_unread_user_idx;
--   DROP INDEX IF EXISTS issue_report_messages_unread_admin_idx;
--   ALTER TABLE issue_report_messages DROP COLUMN IF EXISTS read_by_user_at;
--   ALTER TABLE issue_report_messages DROP COLUMN IF EXISTS read_by_admin_at;
