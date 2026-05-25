CREATE UNIQUE INDEX IF NOT EXISTS uniq_users_username_ci ON users (LOWER(username));
CREATE UNIQUE INDEX IF NOT EXISTS uniq_users_email_ci ON users (LOWER(email));

CREATE TABLE IF NOT EXISTS communities (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(40) NOT NULL,
  color CHAR(7) NOT NULL DEFAULT '#6B7280',
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_communities_name CHECK (name ~ '^[A-Za-z0-9_]{2,40}$'),
  CONSTRAINT chk_communities_color CHECK (color ~ '^#[0-9A-Fa-f]{6}$'),
  CONSTRAINT chk_communities_avatar_url CHECK (avatar_url IS NULL OR avatar_url ~ '^https://')
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_communities_name_ci ON communities (LOWER(name));

CREATE TABLE IF NOT EXISTS community_memberships (
  community_id BIGINT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (community_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_community_memberships_user ON community_memberships (user_id);

CREATE TABLE IF NOT EXISTS posts (
  id BIGSERIAL PRIMARY KEY,
  community_id BIGINT NOT NULL REFERENCES communities(id) ON DELETE RESTRICT,
  author_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(300) NOT NULL,
  body TEXT,
  image_url TEXT,
  link_url TEXT,
  link_domain VARCHAR(255),
  flair VARCHAR(40),
  flair_color CHAR(7),
  vote_count INTEGER NOT NULL DEFAULT 0 CHECK (vote_count >= 0),
  comment_count INTEGER NOT NULL DEFAULT 0 CHECK (comment_count >= 0),
  reaction_count INTEGER NOT NULL DEFAULT 0 CHECK (reaction_count >= 0),
  visibility VARCHAR(16) NOT NULL DEFAULT 'public',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_posts_title CHECK (LENGTH(BTRIM(title)) > 0),
  CONSTRAINT chk_posts_body CHECK (body IS NULL OR LENGTH(body) <= 10000),
  CONSTRAINT chk_posts_image_url CHECK (image_url IS NULL OR image_url ~ '^https://'),
  CONSTRAINT chk_posts_link_url CHECK (link_url IS NULL OR link_url ~ '^https?://'),
  CONSTRAINT chk_posts_flair_color CHECK (flair_color IS NULL OR flair_color ~ '^#[0-9A-Fa-f]{6}$'),
  CONSTRAINT chk_posts_visibility CHECK (visibility IN ('public', 'removed', 'deleted', 'private'))
);

CREATE INDEX IF NOT EXISTS idx_posts_public_created ON posts (created_at DESC, id DESC)
  WHERE visibility = 'public';
CREATE INDEX IF NOT EXISTS idx_posts_public_community ON posts (community_id, created_at DESC)
  WHERE visibility = 'public';
CREATE INDEX IF NOT EXISTS idx_posts_public_author ON posts (author_id, created_at DESC)
  WHERE visibility = 'public';

CREATE TABLE IF NOT EXISTS post_votes (
  post_id BIGINT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vote SMALLINT NOT NULL CHECK (vote IN (-1, 1)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (post_id, user_id)
);

CREATE TABLE IF NOT EXISTS saved_posts (
  post_id BIGINT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  saved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (post_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_saved_posts_user ON saved_posts (user_id, saved_at DESC);

CREATE TABLE IF NOT EXISTS user_follows (
  follower_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  followed_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (follower_id, followed_id),
  CONSTRAINT chk_user_follows_not_self CHECK (follower_id <> followed_id)
);

CREATE TABLE IF NOT EXISTS direct_messages (
  id BIGSERIAL PRIMARY KEY,
  sender_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body VARCHAR(2000) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_direct_messages_not_self CHECK (sender_id <> recipient_id),
  CONSTRAINT chk_direct_messages_body CHECK (LENGTH(BTRIM(body)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_direct_messages_pair
  ON direct_messages (LEAST(sender_id, recipient_id), GREATEST(sender_id, recipient_id), created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS community_messages (
  id BIGSERIAL PRIMARY KEY,
  community_id BIGINT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  sender_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body VARCHAR(2000) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_community_messages_body CHECK (LENGTH(BTRIM(body)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_community_messages_room
  ON community_messages (community_id, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS notifications (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type VARCHAR(40) NOT NULL,
  actor_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
  post_id BIGINT REFERENCES posts(id) ON DELETE CASCADE,
  message VARCHAR(255) NOT NULL,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user
  ON notifications (user_id, created_at DESC, id DESC);

INSERT INTO communities (name, color)
VALUES
  ('technology', '#A855F7'),
  ('programming', '#3B82F6'),
  ('worldnews', '#EF4444'),
  ('science', '#22C55E'),
  ('artificial', '#8B5CF6'),
  ('personalfinance', '#10B981'),
  ('MachineLearning', '#F97316'),
  ('datascience', '#06B6D4')
ON CONFLICT DO NOTHING;

