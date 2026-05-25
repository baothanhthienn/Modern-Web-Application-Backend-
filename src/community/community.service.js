import { HttpError } from '../errors.js';

function serializeCommunity(row) {
  return {
    name: row.name,
    color: row.color,
    avatarUrl: row.avatar_url,
    memberCount: Number(row.member_count),
    joined: Boolean(row.joined),
  };
}

export class CommunityService {
  constructor(db) {
    this.db = db;
  }

  async list(viewerId) {
    const result = await this.db.query(
      `SELECT communities.name, communities.color, communities.avatar_url,
              COUNT(members.user_id)::int AS member_count,
              BOOL_OR(members.user_id = $1) AS joined
       FROM communities
       LEFT JOIN community_memberships AS members ON members.community_id = communities.id
       GROUP BY communities.id
       ORDER BY LOWER(communities.name)`,
      [viewerId],
    );
    return result.rows.map(serializeCommunity);
  }

  async find(name, viewerId) {
    const result = await this.db.query(
      `SELECT communities.id, communities.name, communities.color, communities.avatar_url,
              COUNT(members.user_id)::int AS member_count,
              BOOL_OR(members.user_id = $2) AS joined
       FROM communities
       LEFT JOIN community_memberships AS members ON members.community_id = communities.id
       WHERE LOWER(communities.name) = LOWER($1)
       GROUP BY communities.id
       LIMIT 1`,
      [name, viewerId],
    );
    if (!result.rows[0]) throw new HttpError(404, 'Community not found.');
    return { id: Number(result.rows[0].id), community: serializeCommunity(result.rows[0]) };
  }

  async join(name, userId) {
    const result = await this.db.query(
      `INSERT INTO community_memberships (community_id, user_id)
       SELECT id, $2 FROM communities WHERE LOWER(name) = LOWER($1)
       ON CONFLICT DO NOTHING
       RETURNING community_id`,
      [name, userId],
    );
    if (!result.rows[0]) {
      const existing = await this.db.query(
        `SELECT 1 FROM communities
         INNER JOIN community_memberships ON community_memberships.community_id = communities.id
         WHERE LOWER(communities.name) = LOWER($1) AND community_memberships.user_id = $2`,
        [name, userId],
      );
      if (!existing.rows[0]) throw new HttpError(404, 'Community not found.');
    }
    return (await this.find(name, userId)).community;
  }

  async leave(name, userId) {
    const result = await this.db.query(
      `DELETE FROM community_memberships USING communities
       WHERE community_memberships.community_id = communities.id
         AND LOWER(communities.name) = LOWER($1)
         AND community_memberships.user_id = $2
       RETURNING community_memberships.community_id`,
      [name, userId],
    );
    if (!result.rows[0]) {
      await this.find(name, userId);
    }
    return (await this.find(name, userId)).community;
  }

  async requireMembership(name, userId) {
    const result = await this.db.query(
      `SELECT communities.id, communities.name
       FROM communities
       INNER JOIN community_memberships ON community_memberships.community_id = communities.id
       WHERE LOWER(communities.name) = LOWER($1) AND community_memberships.user_id = $2
       LIMIT 1`,
      [name, userId],
    );
    if (!result.rows[0]) {
      throw new HttpError(403, 'Join this community before using its chat.');
    }
    return { id: Number(result.rows[0].id), name: result.rows[0].name };
  }
}

