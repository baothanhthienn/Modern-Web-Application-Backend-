import { createHash, randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { HttpError } from '../errors.js';

const INVALID_AUTH_MESSAGE = 'Invalid username, email, or password.';
const INVALID_SESSION_MESSAGE = 'Session expired or invalid.';

function serializeUser(user) {
  return {
    id: Number(user.id),
    username: user.username,
    email: user.email,
    joinDate: new Date(Number(user.created_at)).toISOString(),
  };
}

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

export class AuthService {
  constructor(db, config) {
    this.db = db;
    this.sessionTtlMs = config.sessionTtlMs;
  }

  async issueSession(queryable, userId) {
    const token = randomBytes(32).toString('hex');
    const createdAt = Date.now();
    const expiresAt = createdAt + this.sessionTtlMs;

    await queryable.query(
      `INSERT INTO auth_sessions (user_id, token_hash, created_at, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [userId, hashToken(token), createdAt, expiresAt],
    );

    return token;
  }

  async register({ username, email, password }) {
    const passwordHash = await bcrypt.hash(password, 10);

    try {
      return await this.db.transaction(async (client) => {
        const result = await client.query(
          `INSERT INTO users (username, email, password_hash, created_at)
           VALUES ($1, $2, $3, $4)
           RETURNING id, username, email, created_at`,
          [username, email, passwordHash, Date.now()],
        );
        const user = result.rows[0];
        const token = await this.issueSession(client, user.id);
        return { user: serializeUser(user), token };
      });
    } catch (error) {
      if (error.code === '23505') {
        throw new HttpError(409, 'That username or email is already registered.');
      }
      throw error;
    }
  }

  async login({ identifier, password }) {
    const result = await this.db.query(
      `SELECT id, username, email, password_hash, created_at
       FROM users
       WHERE username = $1 OR email = LOWER($1)
       LIMIT 1`,
      [identifier],
    );
    const user = result.rows[0];

    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      throw new HttpError(401, INVALID_AUTH_MESSAGE);
    }

    const token = await this.issueSession(this.db, user.id);
    return { user: serializeUser(user), token };
  }

  async session(token) {
    if (!token) {
      throw new HttpError(401, INVALID_SESSION_MESSAGE);
    }

    const result = await this.db.query(
      `SELECT users.id, users.username, users.email, users.created_at
       FROM auth_sessions
       INNER JOIN users ON users.id = auth_sessions.user_id
       WHERE auth_sessions.token_hash = $1 AND auth_sessions.expires_at > $2
       LIMIT 1`,
      [hashToken(token), Date.now()],
    );

    if (!result.rows[0]) {
      await this.db.query('DELETE FROM auth_sessions WHERE token_hash = $1', [hashToken(token)]);
      throw new HttpError(401, INVALID_SESSION_MESSAGE);
    }

    return { user: serializeUser(result.rows[0]) };
  }

  async logout(token) {
    if (token) {
      await this.db.query('DELETE FROM auth_sessions WHERE token_hash = $1', [hashToken(token)]);
    }
  }
}

