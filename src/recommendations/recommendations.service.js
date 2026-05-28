import { HttpError } from '../errors.js';

const VIEW_UPVOTE_TYPES = new Set(['view', 'upvote']);
const VALID_TYPES = new Set(['view', 'upvote', 'search']);

export class RecommendationService {
  constructor(db) {
    this.db = db;
  }

  async recordEvent(userId, body) {
    const { type, postId, community, flair, title, keyword, timestamp } = body ?? {};

    if (!VALID_TYPES.has(type)) {
      throw new HttpError(400, "Event type must be 'view', 'upvote', or 'search'.");
    }

    if (VIEW_UPVOTE_TYPES.has(type)) {
      if (!Number.isInteger(postId)) {
        throw new HttpError(400, 'postId is required and must be an integer for view/upvote events.');
      }
      if (typeof community !== 'string' || !community.trim()) {
        throw new HttpError(400, 'community is required for view/upvote events.');
      }
      if (typeof title !== 'string' || !title.trim()) {
        throw new HttpError(400, 'title is required for view/upvote events.');
      }

      await this.db.query(
        `INSERT INTO recommendation_events (user_id, type, post_id, community, flair, title, client_timestamp)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (user_id, post_id, type) WHERE type IN ('view', 'upvote')
         DO UPDATE SET created_at = NOW(), client_timestamp = EXCLUDED.client_timestamp`,
        [userId, type, postId, community.trim(), flair ?? null, title.trim(), timestamp ?? null],
      );
    } else {
      if (typeof keyword !== 'string' || !keyword.trim()) {
        throw new HttpError(400, 'keyword is required for search events.');
      }

      await this.db.query(
        `INSERT INTO recommendation_events (user_id, type, keyword, client_timestamp)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id, keyword) WHERE type = 'search'
         DO UPDATE SET created_at = NOW(), client_timestamp = EXCLUDED.client_timestamp`,
        [userId, type, keyword.trim(), timestamp ?? null],
      );
    }
  }

  async getHistory(userId) {
    const [viewed, upvoted, searched] = await Promise.all([
      this.db.query(
        `SELECT post_id AS id, community, flair, title,
                FLOOR(EXTRACT(EPOCH FROM created_at) * 1000) AS timestamp
         FROM recommendation_events
         WHERE user_id = $1 AND type = 'view'
         ORDER BY created_at DESC
         LIMIT 50`,
        [userId],
      ),
      this.db.query(
        `SELECT post_id AS id, community, flair, title,
                FLOOR(EXTRACT(EPOCH FROM created_at) * 1000) AS timestamp
         FROM recommendation_events
         WHERE user_id = $1 AND type = 'upvote'
         ORDER BY created_at DESC
         LIMIT 50`,
        [userId],
      ),
      this.db.query(
        `SELECT keyword, FLOOR(EXTRACT(EPOCH FROM created_at) * 1000) AS timestamp
         FROM recommendation_events
         WHERE user_id = $1 AND type = 'search'
         ORDER BY created_at DESC
         LIMIT 20`,
        [userId],
      ),
    ]);

    return {
      viewedPosts: viewed.rows.map((row) => ({
        id: Number(row.id),
        community: row.community,
        flair: row.flair,
        title: row.title,
        timestamp: Number(row.timestamp),
      })),
      upvotedPosts: upvoted.rows.map((row) => ({
        id: Number(row.id),
        community: row.community,
        flair: row.flair,
        title: row.title,
        timestamp: Number(row.timestamp),
      })),
      searchedKeywords: searched.rows.map((row) => ({
        keyword: row.keyword,
        timestamp: Number(row.timestamp),
      })),
    };
  }
}
