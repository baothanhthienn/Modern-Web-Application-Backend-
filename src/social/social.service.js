import { HttpError } from '../errors.js';
import { nextCursor } from '../http/query.js';

export class SocialService {
  constructor(db) {
    this.db = db;
    this.onMutualFollow = null;
  }

  async targetUser(username) {
    const result = await this.db.query(
      'SELECT id, username FROM users WHERE LOWER(username) = LOWER($1) LIMIT 1',
      [username],
    );
    if (!result.rows[0]) throw new HttpError(404, 'Profile not found.');
    return { id: Number(result.rows[0].id), username: result.rows[0].username };
  }

  async follow(followerId, username) {
    const target = await this.targetUser(username);
    if (target.id === Number(followerId)) throw new HttpError(400, 'You cannot follow yourself.');
    await this.db.query(
      'INSERT INTO user_follows (follower_id, followed_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [followerId, target.id],
    );
    const mutual = await this.db.query(
      'SELECT 1 FROM user_follows WHERE follower_id = $1 AND followed_id = $2',
      [target.id, followerId],
    );
    if (mutual.rows[0] && this.onMutualFollow) {
      await this.onMutualFollow(Number(followerId), target.id);
    }
    return { username: target.username, isFollowing: true };
  }

  async unfollow(followerId, username) {
    const target = await this.targetUser(username);
    await this.db.query(
      'DELETE FROM user_follows WHERE follower_id = $1 AND followed_id = $2',
      [followerId, target.id],
    );
    return { username: target.username, isFollowing: false };
  }

  async requireMutualFollow(userId, username) {
    const target = await this.targetUser(username);
    const result = await this.db.query(
      `SELECT 1
       FROM user_follows first
       INNER JOIN user_follows second
         ON second.follower_id = first.followed_id
        AND second.followed_id = first.follower_id
       WHERE first.follower_id = $1 AND first.followed_id = $2`,
      [userId, target.id],
    );
    if (!result.rows[0]) {
      throw new HttpError(403, 'You can chat only after both users follow each other.');
    }
    return target;
  }

  async notifications(userId, limit, offset) {
    const result = await this.db.query(
      `SELECT notifications.id, notifications.type, notifications.message,
              notifications.post_id, notifications.read_at, notifications.created_at,
              users.username AS actor
       FROM notifications
       LEFT JOIN users ON users.id = notifications.actor_id
       WHERE notifications.user_id = $1
       ORDER BY notifications.created_at DESC, notifications.id DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit + 1, offset],
    );
    return {
      notifications: result.rows.slice(0, limit).map((row) => ({
        id: Number(row.id),
        type: row.type,
        message: row.message,
        postId: row.post_id === null ? null : Number(row.post_id),
        actor: row.actor,
        read: Boolean(row.read_at),
        createdAt: new Date(row.created_at).toISOString(),
      })),
      nextCursor: nextCursor(offset, limit, result.rows),
    };
  }

  async updateUsername(userId, username) {
    if (typeof username !== 'string' || !/^[A-Za-z0-9_]{3,20}$/.test(username.trim())) {
      throw new HttpError(400, 'Username must be 3-20 letters, numbers, or underscores.');
    }
    try {
      const result = await this.db.query(
        'UPDATE users SET username = $1 WHERE id = $2 RETURNING username',
        [username.trim(), userId],
      );
      return { username: result.rows[0].username };
    } catch (error) {
      if (error.code === '23505') throw new HttpError(409, 'That username is already registered.');
      throw error;
    }
  }
}
