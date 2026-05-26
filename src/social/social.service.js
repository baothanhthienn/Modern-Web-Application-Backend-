import { HttpError } from '../errors.js';
import { nextCursor } from '../http/query.js';

function serializeNotification(row) {
  return {
    id: Number(row.id),
    type: row.type,
    message: row.message,
    postId: row.post_id === null ? null : Number(row.post_id),
    actor: row.actor,
    targetUsername: row.type === 'mutual_follow' ? row.target_username : null,
    read: Boolean(row.read_at),
    createdAt: new Date(row.created_at).toISOString(),
  };
}

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
    const follow = await this.db.query(
      `INSERT INTO user_follows (follower_id, followed_id)
       VALUES ($1, $2) ON CONFLICT DO NOTHING
       RETURNING follower_id`,
      [followerId, target.id],
    );
    const mutual = await this.db.query(
      'SELECT 1 FROM user_follows WHERE follower_id = $1 AND followed_id = $2',
      [target.id, followerId],
    );
    if (follow.rows[0] && mutual.rows[0]) {
      const notifications = await this.createMutualFollowNotifications(Number(followerId), target.id);
      if (this.onMutualFollow) {
        await this.onMutualFollow(Number(followerId), target.id, notifications);
      }
    }
    return { username: target.username, isFollowing: true };
  }

  async unfollow(followerId, username) {
    const target = await this.targetUser(username);
    await this.db.query(
      'DELETE FROM user_follows WHERE follower_id = $1 AND followed_id = $2',
      [followerId, target.id],
    );
    await this.db.query(
      `DELETE FROM notifications
       WHERE type = 'mutual_follow'
         AND ((user_id = $1 AND related_user_id = $2)
           OR (user_id = $2 AND related_user_id = $1))`,
      [followerId, target.id],
    );
    return { username: target.username, isFollowing: false };
  }

  async createMutualFollowNotifications(firstUserId, secondUserId) {
    const users = await this.db.query(
      'SELECT id, username FROM users WHERE id IN ($1, $2)',
      [firstUserId, secondUserId],
    );
    const usernameById = new Map(users.rows.map((user) => [Number(user.id), user.username]));
    const firstUsername = usernameById.get(Number(firstUserId));
    const secondUsername = usernameById.get(Number(secondUserId));

    const result = await this.db.query(
      `INSERT INTO notifications (user_id, type, actor_id, related_user_id, message)
       VALUES
         ($1, 'mutual_follow', $2, $2, $3),
         ($2, 'mutual_follow', $1, $1, $4)
       ON CONFLICT (user_id, related_user_id, type)
         WHERE type = 'mutual_follow'
       DO NOTHING
       RETURNING id, user_id, type, actor_id, related_user_id, message,
                 post_id, read_at, created_at`,
      [
        firstUserId,
        secondUserId,
        `You and u/${secondUsername} now follow each other. You can start chatting.`,
        `You and u/${firstUsername} now follow each other. You can start chatting.`,
      ],
    );
    return result.rows.map((row) => {
      const targetUsername = usernameById.get(Number(row.related_user_id));
      return {
        userId: Number(row.user_id),
        notification: serializeNotification({
          ...row,
          actor: targetUsername,
          target_username: targetUsername,
        }),
      };
    });
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
              users.username AS actor, target.username AS target_username
       FROM notifications
       LEFT JOIN users ON users.id = notifications.actor_id
       LEFT JOIN users target ON target.id = notifications.related_user_id
       WHERE notifications.user_id = $1
       ORDER BY notifications.created_at DESC, notifications.id DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit + 1, offset],
    );
    return {
      notifications: result.rows.slice(0, limit).map(serializeNotification),
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
