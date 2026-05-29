ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS avatar_original_url TEXT,
  ADD COLUMN IF NOT EXISTS avatar_crop JSONB;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'chk_user_profiles_avatar_original_url'
      AND table_name = 'user_profiles'
  ) THEN
    ALTER TABLE user_profiles
      ADD CONSTRAINT chk_user_profiles_avatar_original_url
        CHECK (avatar_original_url IS NULL OR avatar_original_url ~ '^https://');
  END IF;
END
$$;
