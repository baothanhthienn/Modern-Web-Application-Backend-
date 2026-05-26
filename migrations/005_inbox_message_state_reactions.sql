ALTER TABLE direct_messages
  ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_direct_messages_unread
  ON direct_messages (recipient_id, created_at DESC, id DESC)
  WHERE read_at IS NULL;

CREATE TABLE IF NOT EXISTS community_message_reads (
  message_id BIGINT NOT NULL REFERENCES community_messages(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (message_id, user_id)
);

CREATE TABLE IF NOT EXISTS direct_message_reactions (
  message_id BIGINT NOT NULL REFERENCES direct_messages(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reaction VARCHAR(16) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (message_id, user_id),
  CONSTRAINT chk_direct_message_reaction
    CHECK (reaction IN ('like', 'love', 'laugh', 'surprised', 'sad'))
);

CREATE TABLE IF NOT EXISTS community_message_reactions (
  message_id BIGINT NOT NULL REFERENCES community_messages(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reaction VARCHAR(16) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (message_id, user_id),
  CONSTRAINT chk_community_message_reaction
    CHECK (reaction IN ('like', 'love', 'laugh', 'surprised', 'sad'))
);

