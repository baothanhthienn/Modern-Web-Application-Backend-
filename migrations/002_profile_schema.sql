CREATE TABLE IF NOT EXISTS user_profiles (
  user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  display_name VARCHAR(50),
  bio VARCHAR(200),
  avatar_url TEXT,
  banner_color CHAR(7),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_user_profiles_avatar_url
    CHECK (avatar_url IS NULL OR avatar_url ~ '^https://'),
  CONSTRAINT chk_user_profiles_banner_color
    CHECK (banner_color IS NULL OR banner_color ~ '^#[0-9A-Fa-f]{6}$')
);

