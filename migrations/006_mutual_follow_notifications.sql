ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS related_user_id BIGINT REFERENCES users(id) ON DELETE CASCADE;

UPDATE notifications
SET related_user_id = actor_id
WHERE type = 'mutual_follow'
  AND related_user_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_notifications_mutual_follow_relationship
  ON notifications (user_id, related_user_id, type)
  WHERE type = 'mutual_follow';

