import { HttpError } from '../errors.js';
import { cursorOffset, nextCursor } from '../http/query.js';

function publicAvatarUrl(value) {
  if (!value) return null;

  try {
    return new URL(value).protocol === 'https:' ? value : null;
  } catch {
    return null;
  }
}

function publicBannerColor(value) {
  return typeof value === 'string' && /^#[0-9A-Fa-f]{6}$/.test(value) ? value : null;
}

function serializeProfile(row) {
  return {
    username: row.username,
    displayName: row.display_name,
    bio: row.bio,
    avatarUrl: publicAvatarUrl(row.avatar_url),
    bannerColor: publicBannerColor(row.banner_color),
    postKarma: Number(row.post_karma || 0),
    commentKarma: 0,
    followers: Number(row.followers || 0),
    cakeDay: new Date(Number(row.created_at)).toISOString(),
    communities: row.communities || [],
  };
}

function activityPost(row) {
  return {
    id: `post_${row.id}`,
    type: 'post',
    community: { name: row.community, avatarUrl: row.community_avatar_url },
    createdAt: new Date(row.created_at).toISOString(),
    title: row.title,
    body: row.body,
    score: Number(row.vote_count),
    commentCount: Number(row.comment_count),
  };
}

export class ProfileService {
  constructor(db) {
    this.db = db;
  }

  async findPublicProfile(username) {
    const result = await this.db.query(
      `SELECT users.id, users.username, users.created_at,
              user_profiles.display_name, user_profiles.bio,
              user_profiles.avatar_url, user_profiles.banner_color,
              GREATEST(COALESCE((SELECT SUM(posts.vote_count) FROM posts
                WHERE posts.author_id = users.id AND posts.visibility = 'public'), 0), 0) AS post_karma,
              (SELECT COUNT(*) FROM user_follows
                WHERE user_follows.followed_id = users.id)::int AS followers
       FROM users
       LEFT JOIN user_profiles ON user_profiles.user_id = users.id
       WHERE LOWER(users.username) = LOWER($1)
       LIMIT 1`,
      [username],
    );
    const row = result.rows[0];

    if (!row) {
      throw new HttpError(404, 'Profile not found.');
    }

    const communities = await this.db.query(
      `SELECT communities.name, communities.avatar_url,
              (SELECT COUNT(*) FROM community_memberships all_members
               WHERE all_members.community_id = communities.id)::int AS member_count
       FROM community_memberships
       INNER JOIN communities ON communities.id = community_memberships.community_id
       WHERE community_memberships.user_id = $1
       ORDER BY community_memberships.joined_at DESC
       LIMIT 5`,
      [row.id],
    );

    return {
      userId: Number(row.id),
      profile: serializeProfile({
        ...row,
        communities: communities.rows.map((community) => ({
          name: community.name,
          memberCount: Number(community.member_count),
          avatarUrl: publicAvatarUrl(community.avatar_url),
        })),
      }),
    };
  }

  async isFollowing(viewerId, targetId) {
    const result = await this.db.query(
      'SELECT 1 FROM user_follows WHERE follower_id = $1 AND followed_id = $2',
      [viewerId, targetId],
    );
    return Boolean(result.rows[0]);
  }

  async activity(username, { type, limit, cursor }) {
    const user = await this.findPublicProfile(username);
    if (type === 'comments') return { items: [], nextCursor: null };

    const offset = cursorOffset(cursor);
    const result = await this.db.query(
      `SELECT posts.id, posts.title, posts.body, posts.created_at, posts.vote_count,
              posts.comment_count, communities.name AS community,
              communities.avatar_url AS community_avatar_url
       FROM posts
       INNER JOIN communities ON communities.id = posts.community_id
       WHERE posts.author_id = $1 AND posts.visibility = 'public'
       ORDER BY posts.created_at DESC, posts.id DESC
       LIMIT $2 OFFSET $3`,
      [user.userId, limit + 1, offset],
    );
    const hasMore = result.rows.length > limit;
    return {
      items: result.rows.slice(0, limit).map(activityPost),
      nextCursor: nextCursor(offset, limit, result.rows),
    };
  }

  async getAvatarData(userId) {
    const result = await this.db.query(
      `SELECT avatar_url, avatar_original_url, avatar_crop
       FROM user_profiles
       WHERE user_id = $1`,
      [userId],
    );
    const row = result.rows[0];
    return {
      avatarUrl: publicAvatarUrl(row?.avatar_url),
      avatarOriginalUrl: publicAvatarUrl(row?.avatar_original_url),
      avatarCrop: row?.avatar_crop ?? null,
    };
  }

  async updateAvatar(userId, { avatarUrl, originalUrl, crop }) {
    await this.db.query(
      `INSERT INTO user_profiles (user_id, avatar_url, avatar_original_url, avatar_crop, updated_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (user_id) DO UPDATE
         SET avatar_url          = EXCLUDED.avatar_url,
             avatar_original_url = EXCLUDED.avatar_original_url,
             avatar_crop         = EXCLUDED.avatar_crop,
             updated_at          = NOW()`,
      [userId, avatarUrl, originalUrl, crop !== null ? JSON.stringify(crop) : null],
    );
    return this.getAvatarData(userId);
  }

  async saved(userId, { limit, cursor }) {
    const offset = cursorOffset(cursor);
    const result = await this.db.query(
      `SELECT posts.id, posts.title, posts.body, posts.created_at, posts.vote_count,
              posts.comment_count, communities.name AS community,
              communities.avatar_url AS community_avatar_url
       FROM saved_posts
       INNER JOIN posts ON posts.id = saved_posts.post_id
       INNER JOIN communities ON communities.id = posts.community_id
       WHERE saved_posts.user_id = $1 AND posts.visibility = 'public'
       ORDER BY saved_posts.saved_at DESC, posts.id DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit + 1, offset],
    );
    return {
      items: result.rows.slice(0, limit).map(activityPost),
      nextCursor: nextCursor(offset, limit, result.rows),
    };
  }
}
