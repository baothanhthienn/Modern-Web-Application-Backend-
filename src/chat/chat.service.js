import { HttpError } from '../errors.js';
import { nextCursor } from '../http/query.js';

export const CHAT_REACTIONS = ['like', 'love', 'laugh', 'surprised', 'sad'];

function validateMessage(body) {
  if (typeof body !== 'string' || body.trim().length === 0 || body.trim().length > 2000) {
    throw new HttpError(400, 'Message must be 1-2000 characters.');
  }
  return body.trim();
}

function validateReaction(reaction) {
  if (!CHAT_REACTIONS.includes(reaction)) {
    throw new HttpError(400, `Reaction must be one of: ${CHAT_REACTIONS.join(', ')}.`);
  }
  return reaction;
}

function publicAvatarUrl(value) {
  return typeof value === 'string' && value.startsWith('https://') ? value : null;
}

function reactionSummary(row) {
  const source = row.reactions ?? [];
  return source.map((item) => ({
    reaction: item.reaction,
    count: Number(item.count),
  }));
}

function serializeMessage(row, kind) {
  return {
    id: Number(row.id),
    sender: row.sender,
    body: row.body,
    createdAt: new Date(row.created_at).toISOString(),
    seen: kind === 'direct' ? Boolean(row.read_at) : Number(row.seen_by_count || 0) > 0,
    seenAt: kind === 'direct' && row.read_at ? new Date(row.read_at).toISOString() : null,
    seenByCount: kind === 'community' ? Number(row.seen_by_count || 0) : undefined,
    reactions: reactionSummary(row),
    viewerReaction: row.viewer_reaction ?? null,
  };
}

const DIRECT_MESSAGE_SELECT = `
  SELECT direct_messages.id, direct_messages.sender_id, direct_messages.recipient_id,
         direct_messages.body, direct_messages.created_at, direct_messages.read_at,
         senders.username AS sender,
         viewer_reaction.reaction AS viewer_reaction,
         COALESCE(reaction_summary.reactions, '[]'::json) AS reactions
  FROM direct_messages
  INNER JOIN users senders ON senders.id = direct_messages.sender_id
  LEFT JOIN direct_message_reactions viewer_reaction
    ON viewer_reaction.message_id = direct_messages.id AND viewer_reaction.user_id = $1
  LEFT JOIN LATERAL (
    SELECT JSON_AGG(JSON_BUILD_OBJECT('reaction', grouped.reaction, 'count', grouped.count)
                    ORDER BY grouped.reaction) AS reactions
    FROM (
      SELECT reaction, COUNT(*)::int AS count
      FROM direct_message_reactions
      WHERE message_id = direct_messages.id
      GROUP BY reaction
    ) grouped
  ) reaction_summary ON TRUE
`;

const COMMUNITY_MESSAGE_SELECT = `
  SELECT community_messages.id, community_messages.sender_id,
         community_messages.body, community_messages.created_at,
         senders.username AS sender,
         viewer_reaction.reaction AS viewer_reaction,
         (SELECT COUNT(*) FROM community_message_reads
          WHERE community_message_reads.message_id = community_messages.id
            AND community_message_reads.user_id <> community_messages.sender_id)::int AS seen_by_count,
         COALESCE(reaction_summary.reactions, '[]'::json) AS reactions
  FROM community_messages
  INNER JOIN users senders ON senders.id = community_messages.sender_id
  LEFT JOIN community_message_reactions viewer_reaction
    ON viewer_reaction.message_id = community_messages.id AND viewer_reaction.user_id = $1
  LEFT JOIN LATERAL (
    SELECT JSON_AGG(JSON_BUILD_OBJECT('reaction', grouped.reaction, 'count', grouped.count)
                    ORDER BY grouped.reaction) AS reactions
    FROM (
      SELECT reaction, COUNT(*)::int AS count
      FROM community_message_reactions
      WHERE message_id = community_messages.id
      GROUP BY reaction
    ) grouped
  ) reaction_summary ON TRUE
`;

export class ChatService {
  constructor(db, communityService, socialService) {
    this.db = db;
    this.communityService = communityService;
    this.socialService = socialService;
  }

  async communityHistory(userId, name, limit, offset) {
    const community = await this.communityService.requireMembership(name, userId);
    const result = await this.db.query(
      `${COMMUNITY_MESSAGE_SELECT}
       WHERE community_messages.community_id = $2
       ORDER BY community_messages.created_at DESC, community_messages.id DESC
       LIMIT $3 OFFSET $4`,
      [userId, community.id, limit + 1, offset],
    );
    return {
      community: community.name,
      messages: result.rows.slice(0, limit).map((row) => serializeMessage(row, 'community')).reverse(),
      nextCursor: nextCursor(offset, limit, result.rows),
    };
  }

  async sendCommunityMessage(user, name, body) {
    const community = await this.communityService.requireMembership(name, user.id);
    const result = await this.db.query(
      `INSERT INTO community_messages (community_id, sender_id, body)
       VALUES ($1, $2, $3)
       RETURNING id, sender_id, body, created_at`,
      [community.id, user.id, validateMessage(body)],
    );
    return {
      community: community.name,
      message: serializeMessage({
        ...result.rows[0],
        sender: user.username,
        reactions: [],
        viewer_reaction: null,
        seen_by_count: 0,
      }, 'community'),
    };
  }

  async directHistory(userId, username, limit, offset) {
    const target = await this.socialService.requireMutualFollow(userId, username);
    const result = await this.db.query(
      `${DIRECT_MESSAGE_SELECT}
       WHERE (direct_messages.sender_id = $1 AND direct_messages.recipient_id = $2)
          OR (direct_messages.sender_id = $2 AND direct_messages.recipient_id = $1)
       ORDER BY direct_messages.created_at DESC, direct_messages.id DESC
       LIMIT $3 OFFSET $4`,
      [userId, target.id, limit + 1, offset],
    );
    return {
      with: target.username,
      messages: result.rows.slice(0, limit).map((row) => serializeMessage(row, 'direct')).reverse(),
      nextCursor: nextCursor(offset, limit, result.rows),
    };
  }

  async sendDirectMessage(user, username, body) {
    const target = await this.socialService.requireMutualFollow(user.id, username);
    const result = await this.db.query(
      `INSERT INTO direct_messages (sender_id, recipient_id, body)
       VALUES ($1, $2, $3)
       RETURNING id, sender_id, recipient_id, body, created_at, read_at`,
      [user.id, target.id, validateMessage(body)],
    );
    return {
      recipientId: target.id,
      with: target.username,
      message: serializeMessage({
        ...result.rows[0],
        sender: user.username,
        reactions: [],
        viewer_reaction: null,
      }, 'direct'),
    };
  }

  async conversations(userId, limit, offset) {
    const result = await this.db.query(
      `WITH mutual AS (
         SELECT followed.id, followed.username, user_profiles.display_name, user_profiles.avatar_url
         FROM user_follows outbound
         INNER JOIN user_follows inbound
           ON inbound.follower_id = outbound.followed_id
          AND inbound.followed_id = outbound.follower_id
         INNER JOIN users followed ON followed.id = outbound.followed_id
         LEFT JOIN user_profiles ON user_profiles.user_id = followed.id
         WHERE outbound.follower_id = $1
       )
       SELECT mutual.id, mutual.username, mutual.display_name, mutual.avatar_url,
              latest.id AS last_message_id, latest.body AS last_message_body,
              latest.created_at AS last_message_created_at, sender.username AS last_message_sender,
              COALESCE(unread.unread_count, 0)::int AS unread_count
       FROM mutual
       LEFT JOIN LATERAL (
         SELECT id, sender_id, body, created_at
         FROM direct_messages
         WHERE (sender_id = $1 AND recipient_id = mutual.id)
            OR (sender_id = mutual.id AND recipient_id = $1)
         ORDER BY created_at DESC, id DESC
         LIMIT 1
       ) latest ON TRUE
       LEFT JOIN users sender ON sender.id = latest.sender_id
       LEFT JOIN LATERAL (
         SELECT COUNT(*) AS unread_count
         FROM direct_messages
         WHERE sender_id = mutual.id AND recipient_id = $1 AND read_at IS NULL
       ) unread ON TRUE
       ORDER BY latest.created_at DESC NULLS LAST, LOWER(mutual.username)
       LIMIT $2 OFFSET $3`,
      [userId, limit + 1, offset],
    );
    return {
      conversations: result.rows.slice(0, limit).map((row) => this.serializeConversation(row)),
      nextCursor: nextCursor(offset, limit, result.rows),
    };
  }

  async conversation(userId, targetId) {
    const result = await this.db.query(
      `SELECT target.id, target.username, user_profiles.display_name, user_profiles.avatar_url,
              latest.id AS last_message_id, latest.body AS last_message_body,
              latest.created_at AS last_message_created_at, sender.username AS last_message_sender,
              COALESCE(unread.unread_count, 0)::int AS unread_count
       FROM users target
       LEFT JOIN user_profiles ON user_profiles.user_id = target.id
       LEFT JOIN LATERAL (
         SELECT id, sender_id, body, created_at
         FROM direct_messages
         WHERE (sender_id = $1 AND recipient_id = target.id)
            OR (sender_id = target.id AND recipient_id = $1)
         ORDER BY created_at DESC, id DESC LIMIT 1
       ) latest ON TRUE
       LEFT JOIN users sender ON sender.id = latest.sender_id
       LEFT JOIN LATERAL (
         SELECT COUNT(*) AS unread_count FROM direct_messages
         WHERE sender_id = target.id AND recipient_id = $1 AND read_at IS NULL
       ) unread ON TRUE
       WHERE target.id = $2`,
      [userId, targetId],
    );
    return this.serializeConversation(result.rows[0]);
  }

  serializeConversation(row) {
    return {
      username: row.username,
      displayName: row.display_name,
      avatarUrl: publicAvatarUrl(row.avatar_url),
      lastMessage: row.last_message_id === null ? null : {
        id: Number(row.last_message_id),
        sender: row.last_message_sender,
        body: row.last_message_body,
        createdAt: new Date(row.last_message_created_at).toISOString(),
      },
      unreadCount: Number(row.unread_count || 0),
    };
  }

  async markDirectRead(userId, username) {
    const target = await this.socialService.requireMutualFollow(userId, username);
    const readAt = new Date().toISOString();
    const result = await this.db.query(
      `UPDATE direct_messages
       SET read_at = $3
       WHERE sender_id = $1 AND recipient_id = $2 AND read_at IS NULL
       RETURNING id`,
      [target.id, userId, readAt],
    );
    return { with: target.username, messageIds: result.rows.map((row) => Number(row.id)), readAt };
  }

  async markCommunityRead(userId, name) {
    const community = await this.communityService.requireMembership(name, userId);
    const readAt = new Date().toISOString();
    const result = await this.db.query(
      `INSERT INTO community_message_reads (message_id, user_id, read_at)
       SELECT id, $2, $3 FROM community_messages
       WHERE community_id = $1 AND sender_id <> $2
       ON CONFLICT (message_id, user_id) DO UPDATE SET read_at = EXCLUDED.read_at
       RETURNING message_id`,
      [community.id, userId, readAt],
    );
    return { community: community.name, messageIds: result.rows.map((row) => Number(row.message_id)), readAt };
  }

  async setDirectReaction(userId, username, messageId, reaction) {
    const target = await this.socialService.requireMutualFollow(userId, username);
    const message = await this.db.query(
      `SELECT id FROM direct_messages
       WHERE id = $1 AND ((sender_id = $2 AND recipient_id = $3)
          OR (sender_id = $3 AND recipient_id = $2))`,
      [messageId, userId, target.id],
    );
    if (!message.rows[0]) throw new HttpError(404, 'Message not found.');
    await this.db.query(
      `INSERT INTO direct_message_reactions (message_id, user_id, reaction)
       VALUES ($1, $2, $3)
       ON CONFLICT (message_id, user_id)
       DO UPDATE SET reaction = EXCLUDED.reaction, created_at = NOW()`,
      [messageId, userId, validateReaction(reaction)],
    );
    return this.directReactionState(userId, messageId);
  }

  async removeDirectReaction(userId, username, messageId) {
    const target = await this.socialService.requireMutualFollow(userId, username);
    const message = await this.db.query(
      `SELECT id FROM direct_messages
       WHERE id = $1 AND ((sender_id = $2 AND recipient_id = $3)
          OR (sender_id = $3 AND recipient_id = $2))`,
      [messageId, userId, target.id],
    );
    if (!message.rows[0]) throw new HttpError(404, 'Message not found.');
    await this.db.query(
      'DELETE FROM direct_message_reactions WHERE message_id = $1 AND user_id = $2',
      [messageId, userId],
    );
    return this.directReactionState(userId, messageId);
  }

  async directReactionState(userId, messageId) {
    const result = await this.db.query(
      `SELECT $1::bigint AS id, own.reaction AS viewer_reaction,
              COALESCE(JSON_AGG(JSON_BUILD_OBJECT('reaction', grouped.reaction, 'count', grouped.count)
                       ORDER BY grouped.reaction) FILTER (WHERE grouped.reaction IS NOT NULL), '[]'::json) AS reactions
       FROM (SELECT 1) base
       LEFT JOIN direct_message_reactions own ON own.message_id = $1 AND own.user_id = $2
       LEFT JOIN (SELECT reaction, COUNT(*)::int AS count FROM direct_message_reactions
                  WHERE message_id = $1 GROUP BY reaction) grouped ON TRUE
       GROUP BY own.reaction`,
      [messageId, userId],
    );
    return {
      messageId: Number(messageId),
      reactions: reactionSummary(result.rows[0]),
      viewerReaction: result.rows[0].viewer_reaction ?? null,
    };
  }

  async setCommunityReaction(userId, name, messageId, reaction) {
    const community = await this.communityService.requireMembership(name, userId);
    const message = await this.db.query(
      'SELECT id FROM community_messages WHERE id = $1 AND community_id = $2',
      [messageId, community.id],
    );
    if (!message.rows[0]) throw new HttpError(404, 'Message not found.');
    await this.db.query(
      `INSERT INTO community_message_reactions (message_id, user_id, reaction)
       VALUES ($1, $2, $3)
       ON CONFLICT (message_id, user_id)
       DO UPDATE SET reaction = EXCLUDED.reaction, created_at = NOW()`,
      [messageId, userId, validateReaction(reaction)],
    );
    return this.communityReactionState(userId, messageId);
  }

  async removeCommunityReaction(userId, name, messageId) {
    const community = await this.communityService.requireMembership(name, userId);
    const message = await this.db.query(
      'SELECT id FROM community_messages WHERE id = $1 AND community_id = $2',
      [messageId, community.id],
    );
    if (!message.rows[0]) throw new HttpError(404, 'Message not found.');
    await this.db.query(
      'DELETE FROM community_message_reactions WHERE message_id = $1 AND user_id = $2',
      [messageId, userId],
    );
    return this.communityReactionState(userId, messageId);
  }

  async communityReactionState(userId, messageId) {
    const result = await this.db.query(
      `SELECT $1::bigint AS id, own.reaction AS viewer_reaction,
              COALESCE(JSON_AGG(JSON_BUILD_OBJECT('reaction', grouped.reaction, 'count', grouped.count)
                       ORDER BY grouped.reaction) FILTER (WHERE grouped.reaction IS NOT NULL), '[]'::json) AS reactions
       FROM (SELECT 1) base
       LEFT JOIN community_message_reactions own ON own.message_id = $1 AND own.user_id = $2
       LEFT JOIN (SELECT reaction, COUNT(*)::int AS count FROM community_message_reactions
                  WHERE message_id = $1 GROUP BY reaction) grouped ON TRUE
       GROUP BY own.reaction`,
      [messageId, userId],
    );
    return {
      messageId: Number(messageId),
      reactions: reactionSummary(result.rows[0]),
      viewerReaction: result.rows[0].viewer_reaction ?? null,
    };
  }
}

export function directRoom(firstUserId, secondUserId) {
  return `direct:${[Number(firstUserId), Number(secondUserId)].sort((first, second) => first - second).join(':')}`;
}
