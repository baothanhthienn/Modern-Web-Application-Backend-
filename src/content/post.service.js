import { HttpError } from '../errors.js';
import { nextCursor } from '../http/query.js';

const SORT_SQL = {
  best: '(posts.vote_count + posts.comment_count * 2 + posts.reaction_count * 2) DESC, posts.created_at DESC',
  hot: '((posts.vote_count + posts.comment_count * 2 + posts.reaction_count * 2)::float / POWER(EXTRACT(EPOCH FROM (NOW() - posts.created_at)) / 3600 + 2, 1.35)) DESC, posts.created_at DESC',
  new: 'posts.created_at DESC, posts.id DESC',
  top: 'posts.vote_count DESC, posts.created_at DESC',
  rising: 'CASE WHEN posts.created_at > NOW() - INTERVAL \'48 hours\' THEN posts.vote_count + posts.comment_count * 2 + posts.reaction_count * 2 ELSE 0 END DESC, posts.created_at DESC',
};

export function serializePost(row) {
  return {
    id: Number(row.id),
    community: row.community,
    communityColor: row.community_color,
    author: row.author,
    createdAt: new Date(row.created_at).toISOString(),
    flair: row.flair,
    flairColor: row.flair_color,
    title: row.title,
    image: row.image_url,
    text: row.body,
    link: row.link_url,
    linkDomain: row.link_domain,
    votes: Number(row.vote_count),
    comments: Number(row.comment_count),
    reactions: Number(row.reaction_count),
    userVote: Number(row.user_vote || 0),
    saved: Boolean(row.saved),
  };
}

const POST_SELECT = `
  SELECT posts.id, communities.name AS community, communities.color AS community_color,
         users.username AS author, posts.created_at, posts.flair, posts.flair_color,
         posts.title, posts.image_url, posts.body, posts.link_url, posts.link_domain,
         posts.vote_count, posts.comment_count, posts.reaction_count,
         COALESCE(post_votes.vote, 0) AS user_vote,
         (saved_posts.post_id IS NOT NULL) AS saved
  FROM posts
  INNER JOIN communities ON communities.id = posts.community_id
  INNER JOIN users ON users.id = posts.author_id
  LEFT JOIN post_votes ON post_votes.post_id = posts.id AND post_votes.user_id = $1
  LEFT JOIN saved_posts ON saved_posts.post_id = posts.id AND saved_posts.user_id = $1
`;

export class PostService {
  constructor(db) {
    this.db = db;
  }

  async list({ viewerId, sort, limit, offset }) {
    const result = await this.db.query(
      `${POST_SELECT}
       WHERE posts.visibility = 'public'
       ORDER BY ${SORT_SQL[sort]}
       LIMIT $2 OFFSET $3`,
      [viewerId, limit + 1, offset],
    );
    return {
      posts: result.rows.slice(0, limit).map(serializePost),
      nextCursor: nextCursor(offset, limit, result.rows),
    };
  }

  async get(postId, viewerId) {
    const result = await this.db.query(
      `${POST_SELECT}
       WHERE posts.id = $2 AND posts.visibility = 'public'
       LIMIT 1`,
      [viewerId, postId],
    );
    if (!result.rows[0]) throw new HttpError(404, 'Post not found.');
    return serializePost(result.rows[0]);
  }

  async create(authorId, input) {
    return this.db.transaction(async (client) => {
      const communityResult = await client.query(
        'SELECT id FROM communities WHERE LOWER(name) = LOWER($1) LIMIT 1',
        [input.community],
      );
      if (!communityResult.rows[0]) throw new HttpError(404, 'Community not found.');

      const inserted = await client.query(
        `INSERT INTO posts (community_id, author_id, title, body, image_url)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [communityResult.rows[0].id, authorId, input.title, input.text, input.image],
      );
      const postId = inserted.rows[0].id;
      await client.query(
        `INSERT INTO notifications (user_id, type, actor_id, post_id, message)
         VALUES ($1, 'post_created', $1, $2, 'Your post has been published.')`,
        [authorId, postId],
      );
      return this.getWithQueryable(client, postId, authorId);
    });
  }

  async update(authorId, postId, input) {
    return this.db.transaction(async (client) => {
      let communityId = null;
      if (input.community !== undefined) {
        const communityResult = await client.query(
          'SELECT id FROM communities WHERE LOWER(name) = LOWER($1) LIMIT 1',
          [input.community],
        );
        if (!communityResult.rows[0]) throw new HttpError(404, 'Community not found.');
        communityId = communityResult.rows[0].id;
      }

      const updated = await client.query(
        `UPDATE posts
         SET community_id = COALESCE($3, community_id),
             title = COALESCE($4, title),
             body = CASE WHEN $5 THEN $6 ELSE body END,
             image_url = CASE WHEN $7 THEN $8 ELSE image_url END
         WHERE id = $1 AND author_id = $2 AND visibility = 'public'
         RETURNING id`,
        [
          postId,
          authorId,
          communityId,
          input.title ?? null,
          input.text !== undefined,
          input.text ?? null,
          input.image !== undefined,
          input.image ?? null,
        ],
      );
      if (!updated.rows[0]) throw new HttpError(404, 'Post not found.');
      return this.getWithQueryable(client, postId, authorId);
    });
  }

  async delete(authorId, postId) {
    const result = await this.db.query(
      `UPDATE posts SET visibility = 'deleted'
       WHERE id = $1 AND author_id = $2 AND visibility = 'public'
       RETURNING id`,
      [postId, authorId],
    );
    if (!result.rows[0]) throw new HttpError(404, 'Post not found.');
  }

  async getWithQueryable(queryable, postId, viewerId) {
    const result = await queryable.query(
      `${POST_SELECT}
       WHERE posts.id = $2 AND posts.visibility = 'public'
       LIMIT 1`,
      [viewerId, postId],
    );
    return serializePost(result.rows[0]);
  }

  async vote(userId, postId, vote) {
    await this.db.transaction(async (client) => {
      const previous = await client.query(
        'SELECT vote FROM post_votes WHERE post_id = $1 AND user_id = $2',
        [postId, userId],
      );
      const priorVote = Number(previous.rows[0]?.vote || 0);

      if (vote === 0) {
        await client.query('DELETE FROM post_votes WHERE post_id = $1 AND user_id = $2', [postId, userId]);
      } else {
        await client.query(
          `INSERT INTO post_votes (post_id, user_id, vote)
           VALUES ($1, $2, $3)
           ON CONFLICT (post_id, user_id)
           DO UPDATE SET vote = EXCLUDED.vote, updated_at = NOW()`,
          [postId, userId, vote],
        );
      }
      const updated = await client.query(
        `UPDATE posts SET vote_count = vote_count + $2 - $3
         WHERE id = $1 AND visibility = 'public'
         RETURNING id`,
        [postId, vote, priorVote],
      );
      if (!updated.rows[0]) throw new HttpError(404, 'Post not found.');
    });
    return this.get(postId, userId);
  }

  async setSaved(userId, postId, saved) {
    const exists = await this.db.query(
      'SELECT id FROM posts WHERE id = $1 AND visibility = \'public\'',
      [postId],
    );
    if (!exists.rows[0]) throw new HttpError(404, 'Post not found.');

    if (saved) {
      await this.db.query(
        'INSERT INTO saved_posts (post_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [postId, userId],
      );
    } else {
      await this.db.query('DELETE FROM saved_posts WHERE post_id = $1 AND user_id = $2', [postId, userId]);
    }
    return this.get(postId, userId);
  }

  async search(query, limit) {
    const pattern = `%${query}%`;
    const [users, posts] = await Promise.all([
      this.db.query(
        `SELECT username FROM users WHERE username ILIKE $1 ORDER BY username LIMIT $2`,
        [pattern, limit],
      ),
      this.db.query(
        `${POST_SELECT}
         WHERE posts.visibility = 'public' AND posts.title ILIKE $2
         ORDER BY posts.created_at DESC LIMIT $3`,
        [null, pattern, limit],
      ),
    ]);
    return {
      users: users.rows.map((row) => ({ username: row.username })),
      posts: posts.rows.map(serializePost),
    };
  }
}
