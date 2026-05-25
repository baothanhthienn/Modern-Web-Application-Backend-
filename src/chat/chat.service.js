import { HttpError } from '../errors.js';
import { nextCursor } from '../http/query.js';

function validateMessage(body) {
  if (typeof body !== 'string' || body.trim().length === 0 || body.trim().length > 2000) {
    throw new HttpError(400, 'Message must be 1-2000 characters.');
  }
  return body.trim();
}

function serializeMessage(row) {
  return {
    id: Number(row.id),
    sender: row.sender,
    body: row.body,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

export class ChatService {
  constructor(db, communityService, socialService) {
    this.db = db;
    this.communityService = communityService;
    this.socialService = socialService;
  }

  async communityHistory(userId, name, limit, offset) {
    const community = await this.communityService.requireMembership(name, userId);
    const result = await this.db.query(
      `SELECT community_messages.id, users.username AS sender,
              community_messages.body, community_messages.created_at
       FROM community_messages
       INNER JOIN users ON users.id = community_messages.sender_id
       WHERE community_messages.community_id = $1
       ORDER BY community_messages.created_at DESC, community_messages.id DESC
       LIMIT $2 OFFSET $3`,
      [community.id, limit + 1, offset],
    );
    return {
      community: community.name,
      messages: result.rows.slice(0, limit).map(serializeMessage).reverse(),
      nextCursor: nextCursor(offset, limit, result.rows),
    };
  }

  async sendCommunityMessage(user, name, body) {
    const community = await this.communityService.requireMembership(name, user.id);
    const result = await this.db.query(
      `INSERT INTO community_messages (community_id, sender_id, body)
       VALUES ($1, $2, $3)
       RETURNING id, body, created_at`,
      [community.id, user.id, validateMessage(body)],
    );
    return {
      community: community.name,
      message: serializeMessage({ ...result.rows[0], sender: user.username }),
    };
  }

  async directHistory(userId, username, limit, offset) {
    const target = await this.socialService.requireMutualFollow(userId, username);
    const result = await this.db.query(
      `SELECT direct_messages.id, users.username AS sender,
              direct_messages.body, direct_messages.created_at
       FROM direct_messages
       INNER JOIN users ON users.id = direct_messages.sender_id
       WHERE (direct_messages.sender_id = $1 AND direct_messages.recipient_id = $2)
          OR (direct_messages.sender_id = $2 AND direct_messages.recipient_id = $1)
       ORDER BY direct_messages.created_at DESC, direct_messages.id DESC
       LIMIT $3 OFFSET $4`,
      [userId, target.id, limit + 1, offset],
    );
    return {
      with: target.username,
      messages: result.rows.slice(0, limit).map(serializeMessage).reverse(),
      nextCursor: nextCursor(offset, limit, result.rows),
    };
  }

  async sendDirectMessage(user, username, body) {
    const target = await this.socialService.requireMutualFollow(user.id, username);
    const result = await this.db.query(
      `INSERT INTO direct_messages (sender_id, recipient_id, body)
       VALUES ($1, $2, $3)
       RETURNING id, body, created_at`,
      [user.id, target.id, validateMessage(body)],
    );
    return {
      recipientId: target.id,
      with: target.username,
      message: serializeMessage({ ...result.rows[0], sender: user.username }),
    };
  }
}

export function directRoom(firstUserId, secondUserId) {
  return `direct:${[Number(firstUserId), Number(secondUserId)].sort((first, second) => first - second).join(':')}`;
}

