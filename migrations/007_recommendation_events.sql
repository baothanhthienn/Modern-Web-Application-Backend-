CREATE TABLE IF NOT EXISTS recommendation_events (
  id               BIGSERIAL PRIMARY KEY,
  user_id          BIGINT       NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type             VARCHAR(10)  NOT NULL,
  post_id          BIGINT,
  community        VARCHAR(100),
  flair            VARCHAR(100),
  title            TEXT,
  keyword          VARCHAR(200),
  client_timestamp BIGINT,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_recommendation_events_type CHECK (type IN ('view', 'upvote', 'search'))
);

-- Primary read path: fetch all events for a user by type, newest first
CREATE INDEX IF NOT EXISTS idx_recommendation_events_user_type_created
  ON recommendation_events (user_id, type, created_at DESC);

-- Unique constraint for view/upvote dedup; also used by ON CONFLICT upsert
CREATE UNIQUE INDEX IF NOT EXISTS uniq_recommendation_events_view_upvote
  ON recommendation_events (user_id, post_id, type)
  WHERE type IN ('view', 'upvote');

-- Unique constraint for search keyword dedup; also used by ON CONFLICT upsert
CREATE UNIQUE INDEX IF NOT EXISTS uniq_recommendation_events_search
  ON recommendation_events (user_id, keyword)
  WHERE type = 'search';
