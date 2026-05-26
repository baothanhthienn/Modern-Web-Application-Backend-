import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { ChatService } from '../src/chat/chat.service.js';
import { createConfig } from '../src/config.js';
import { HttpError } from '../src/errors.js';
import { ProfileService } from '../src/profile/profile.service.js';
import { SocialService } from '../src/social/social.service.js';

const user = {
  id: 1,
  username: 'sample_user',
  email: 'sample@example.com',
  joinDate: '2026-05-25T00:00:00.000Z',
};

const publicProfile = {
  username: 'sample_user',
  displayName: null,
  bio: null,
  avatarUrl: null,
  bannerColor: null,
  postKarma: 0,
  commentKarma: 0,
  followers: 0,
  cakeDay: '2026-05-25T00:00:00.000Z',
  communities: [],
};

describe('deployment configuration', () => {
  it('defaults Railway sessions to cross-site secure cookies without relying on NODE_ENV', () => {
    const config = createConfig({
      RAILWAY_ENVIRONMENT_NAME: 'production',
      FRONTEND_ORIGIN: 'https://frontend.example',
    });

    assert.equal(config.isHosted, true);
    assert.equal(config.cookieSecure, true);
    assert.equal(config.cookieSameSite, 'none');
  });

  it('retains lax non-secure cookie defaults for local development', () => {
    const config = createConfig({ FRONTEND_ORIGIN: 'http://localhost:5173' });

    assert.equal(config.isHosted, false);
    assert.equal(config.cookieSecure, false);
    assert.equal(config.cookieSameSite, 'lax');
  });
});

function setup(authOverrides = {}, profileOverrides = {}, serviceOverrides = {}) {
  const calls = [];
  const profileCalls = [];
  const domainCalls = [];
  const authService = {
    async register(details) {
      calls.push(['register', details]);
      return { user, token: 'registered-token' };
    },
    async login(details) {
      calls.push(['login', details]);
      return { user, token: 'login-token' };
    },
    async session(token) {
      calls.push(['session', token]);
      if (!token) throw new HttpError(401, 'Session expired or invalid.');
      return { user };
    },
    async logout(token) {
      calls.push(['logout', token]);
    },
    ...authOverrides,
  };
  const profileService = {
    async findPublicProfile(username) {
      profileCalls.push(['profile', username]);
      if (username === 'missing') throw new HttpError(404, 'Profile not found.');
      return { userId: 1, profile: publicProfile };
    },
    async activity(username, options) {
      profileCalls.push(['activity', username, options]);
      if (username === 'missing') throw new HttpError(404, 'Profile not found.');
      return { items: [], nextCursor: null };
    },
    async saved(userId, options) {
      profileCalls.push(['saved', userId, options]);
      return { items: [], nextCursor: null };
    },
    async isFollowing(viewerId, targetId) {
      profileCalls.push(['following', viewerId, targetId]);
      return false;
    },
    ...profileOverrides,
  };
  const postService = {
    async list(options) {
      domainCalls.push(['posts', options]);
      return { posts: [], nextCursor: null };
    },
    async create(userId, details) {
      domainCalls.push(['create-post', userId, details]);
      return { id: 9, title: details.title, community: details.community };
    },
    async search(query, limit) {
      domainCalls.push(['search', query, limit]);
      return { users: [], posts: [] };
    },
    ...serviceOverrides.postService,
  };
  const communityService = {
    async list(userId) {
      domainCalls.push(['communities', userId]);
      return [];
    },
    async join(name, userId) {
      domainCalls.push(['join', name, userId]);
      return { name, joined: true };
    },
    ...serviceOverrides.communityService,
  };
  const socialService = {
    async follow(userId, username) {
      domainCalls.push(['follow', userId, username]);
      return { username, isFollowing: true };
    },
    async notifications(userId, limit, offset) {
      domainCalls.push(['notifications', userId, limit, offset]);
      return { notifications: [], nextCursor: null };
    },
    async updateUsername(userId, username) {
      domainCalls.push(['username', userId, username]);
      return { username };
    },
    ...serviceOverrides.socialService,
  };
  const chatService = {
    async conversations(userId, limit, offset) {
      domainCalls.push(['conversations', userId, limit, offset]);
      return { conversations: [], nextCursor: null };
    },
    async markDirectRead(userId, username) {
      domainCalls.push(['direct-read', userId, username]);
      return { with: username, messageIds: [12], readAt: '2026-05-26T00:00:00.000Z' };
    },
    async communityHistory(userId, name, limit, offset) {
      domainCalls.push(['community-messages', userId, name, limit, offset]);
      return { community: name, messages: [], nextCursor: null };
    },
    async directHistory(userId, username, limit, offset) {
      domainCalls.push(['direct-messages', userId, username, limit, offset]);
      return { with: username, messages: [], nextCursor: null };
    },
    async markCommunityRead(userId, name) {
      domainCalls.push(['community-read', userId, name]);
      return { community: name, messageIds: [7], readAt: '2026-05-26T00:00:00.000Z' };
    },
    async setDirectReaction(userId, username, messageId, reaction) {
      domainCalls.push(['direct-reaction', userId, username, messageId, reaction]);
      return { messageId: Number(messageId), reactions: [{ reaction, count: 1 }], viewerReaction: reaction };
    },
    async setCommunityReaction(userId, name, messageId, reaction) {
      domainCalls.push(['community-reaction', userId, name, messageId, reaction]);
      return { messageId: Number(messageId), reactions: [{ reaction, count: 1 }], viewerReaction: reaction };
    },
    ...serviceOverrides.chatService,
  };
  const config = createConfig({
    NODE_ENV: 'test',
    FRONTEND_ORIGIN: 'http://localhost:5173',
    SESSION_COOKIE_NAME: 'reddit_session',
    SESSION_TTL_SECONDS: '2592000',
    COOKIE_SECURE: 'false',
    COOKIE_SAME_SITE: 'lax',
  });
  const app = createApp({
    config,
    authService,
    profileService,
    postService,
    communityService,
    socialService,
    chatService,
    logger: { error() {} },
    healthService: {
      async check() {
        return { success: true, database: 'connected', databaseName: 'railway', serverVersion: 'PostgreSQL' };
      },
    },
  });

  return { app, calls, profileCalls, domainCalls };
}

describe('authentication API', () => {
  it('registers a valid account and sets an HttpOnly session cookie', async () => {
    const { app, calls } = setup();
    const response = await request(app).post('/api/auth/register').send({
      username: 'sample_user',
      email: 'SAMPLE@example.com',
      password: 'Password1',
    });

    assert.equal(response.status, 201);
    assert.deepEqual(response.body, { success: true, user });
    assert.match(response.headers['set-cookie'][0], /reddit_session=registered-token/);
    assert.match(response.headers['set-cookie'][0], /HttpOnly/);
    assert.deepEqual(calls[0], ['register', {
      username: 'sample_user',
      email: 'sample@example.com',
      password: 'Password1',
    }]);
  });

  it('rejects invalid registration data without invoking the service', async () => {
    const { app, calls } = setup();
    const response = await request(app).post('/api/auth/register').send({
      username: 'x',
      email: 'not-an-email',
      password: 'short',
    });

    assert.equal(response.status, 400);
    assert.equal(response.body.success, false);
    assert.equal(calls.length, 0);
  });

  it('logs in and restores a cookie session', async () => {
    const { app, calls } = setup();
    const agent = request.agent(app);
    const login = await agent.post('/api/auth/login').send({
      identifier: 'sample_user',
      password: 'Password1',
    });
    const session = await agent.get('/api/auth/session');

    assert.equal(login.status, 200);
    assert.equal(session.status, 200);
    assert.deepEqual(session.body.user, user);
    assert.deepEqual(calls[1], ['session', 'login-token']);
  });

  it('returns the invalid-login response contract', async () => {
    const { app } = setup({
      async login() {
        throw new HttpError(401, 'Invalid username, email, or password.');
      },
    });
    const response = await request(app).post('/api/auth/login').send({
      identifier: 'sample_user',
      password: 'wrongPassword1',
    });

    assert.equal(response.status, 401);
    assert.deepEqual(response.body, {
      success: false,
      error: 'Invalid username, email, or password.',
    });
  });

  it('logs out and expires the session cookie', async () => {
    const { app, calls } = setup();
    const response = await request(app)
      .post('/api/auth/logout')
      .set('Cookie', 'reddit_session=login-token');

    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { success: true });
    assert.deepEqual(calls[0], ['logout', 'login-token']);
    assert.match(response.headers['set-cookie'][0], /reddit_session=/);
    assert.match(response.headers['set-cookie'][0], /Expires=/);
  });
});

describe('application middleware', () => {
  it('returns database health JSON', async () => {
    const { app } = setup();
    const response = await request(app).get('/api/health');

    assert.equal(response.status, 200);
    assert.equal(response.body.database, 'connected');
    assert.equal(response.body.databaseName, 'railway');
  });

  it('returns JSON for invalid bodies and unexpected errors', async () => {
    const { app } = setup({
      async login() {
        throw new Error('database unavailable');
      },
    });
    const invalidJson = await request(app)
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .send('{');
    const unexpected = await request(app).post('/api/auth/login').send({
      identifier: 'sample_user',
      password: 'Password1',
    });

    assert.equal(invalidJson.status, 400);
    assert.equal(invalidJson.body.success, false);
    assert.equal(unexpected.status, 500);
    assert.equal(unexpected.body.error, 'Authentication service failed.');
  });

  it('permits credentials only for the configured browser origin', async () => {
    const { app } = setup();
    const allowed = await request(app).get('/api/health').set('Origin', 'http://localhost:5173');
    const disallowed = await request(app).get('/api/health').set('Origin', 'https://other.example');

    assert.equal(allowed.headers['access-control-allow-origin'], 'http://localhost:5173');
    assert.equal(allowed.headers['access-control-allow-credentials'], 'true');
    assert.equal(disallowed.headers['access-control-allow-origin'], undefined);
  });
});

describe('public profile API', () => {
  it('returns a public-only profile with an anonymous viewer state', async () => {
    const { app } = setup();
    const response = await request(app).get('/api/profiles/sample_user');

    assert.equal(response.status, 200);
    assert.deepEqual(response.body, {
      success: true,
      profile: publicProfile,
      viewer: {
        isAuthenticated: false,
        isSelf: false,
        isFollowing: false,
        canMessage: false,
      },
    });
    assert.equal(JSON.stringify(response.body).includes('email'), false);
  });

  it('reports signed-in self viewer context without serializing auth email', async () => {
    const { app } = setup();
    const response = await request(app)
      .get('/api/profiles/sample_user')
      .set('Cookie', 'reddit_session=login-token');

    assert.equal(response.status, 200);
    assert.deepEqual(response.body.viewer, {
      isAuthenticated: true,
      isSelf: true,
      isFollowing: false,
      canMessage: false,
    });
    assert.equal(JSON.stringify(response.body).includes('sample@example.com'), false);
  });

  it('reports messaging eligibility for an authenticated non-owner viewer', async () => {
    const { app } = setup({
      async session() {
        return { user: { ...user, id: 2, username: 'other_viewer' } };
      },
    }, {
      async isFollowing() {
        return false;
      },
    });
    const response = await request(app)
      .get('/api/profiles/sample_user')
      .set('Cookie', 'reddit_session=other-viewer-token');

    assert.equal(response.status, 200);
    assert.deepEqual(response.body.viewer, {
      isAuthenticated: true,
      isSelf: false,
      isFollowing: false,
      canMessage: true,
    });
  });

  it('does not fail a public profile request for an invalid session cookie', async () => {
    const { app } = setup({
      async session() {
        throw new HttpError(401, 'Session expired or invalid.');
      },
    });
    const response = await request(app)
      .get('/api/profiles/sample_user')
      .set('Cookie', 'reddit_session=expired-token');

    assert.equal(response.status, 200);
    assert.equal(response.body.viewer.isAuthenticated, false);
    assert.equal(response.body.viewer.isSelf, false);
  });

  it('returns JSON 404 for an unknown public profile', async () => {
    const { app } = setup();
    const response = await request(app).get('/api/profiles/missing');

    assert.equal(response.status, 404);
    assert.deepEqual(response.body, { success: false, error: 'Profile not found.' });
  });

  it('returns empty public activity and passes validated paging options', async () => {
    const { app, profileCalls } = setup();
    const response = await request(app)
      .get('/api/profiles/sample_user/activity?type=comments&limit=12&cursor=opaque-next');

    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { success: true, items: [], nextCursor: null });
    assert.deepEqual(profileCalls[0], ['activity', 'sample_user', {
      type: 'comments',
      limit: 12,
      cursor: 'opaque-next',
    }]);
  });

  it('rejects saved activity on the public profile endpoint', async () => {
    const { app, profileCalls } = setup();
    const response = await request(app).get('/api/profiles/sample_user/activity?type=saved');

    assert.equal(response.status, 400);
    assert.deepEqual(response.body, { success: false, error: 'Saved activity is private.' });
    assert.equal(profileCalls.length, 0);
  });
});

describe('saved items API', () => {
  it('requires a valid authenticated session', async () => {
    const { app } = setup();
    const response = await request(app).get('/api/me/saved');

    assert.equal(response.status, 401);
    assert.deepEqual(response.body, {
      success: false,
      error: 'You must be logged in to view saved posts.',
    });
  });

  it('returns the shared activity shape to an authenticated viewer', async () => {
    const { app, profileCalls } = setup();
    const response = await request(app)
      .get('/api/me/saved?limit=20')
      .set('Cookie', 'reddit_session=login-token');

    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { success: true, items: [], nextCursor: null });
    assert.deepEqual(profileCalls[0], ['saved', 1, { limit: 20, cursor: null }]);
  });
});

describe('profile data serialization', () => {
  it('looks up canonical users case-insensitively and emits public fields only', async () => {
    const queries = [];
    const service = new ProfileService({
      async query(text, parameters) {
        queries.push([text, parameters]);
        if (text.includes('community_memberships')) {
          return { rows: [] };
        }
        return {
          rows: [{
            id: '1',
            username: 'Tech_Guru',
            email: 'private@example.com',
            created_at: String(Date.parse('2021-10-19T00:00:00.000Z')),
            display_name: 'Tech Guru',
            bio: 'Public bio',
            avatar_url: 'http://insecure.example/avatar.png',
            banner_color: 'not-a-color',
          }],
        };
      },
    });

    const result = await service.findPublicProfile('tech_guru');

    assert.equal(queries[0][0].includes('LOWER(users.username) = LOWER($1)'), true);
    assert.deepEqual(queries[0][1], ['tech_guru']);
    assert.deepEqual(result.profile, {
      username: 'Tech_Guru',
      displayName: 'Tech Guru',
      bio: 'Public bio',
      avatarUrl: null,
      bannerColor: null,
      postKarma: 0,
      commentKarma: 0,
      followers: 0,
      cakeDay: '2021-10-19T00:00:00.000Z',
      communities: [],
    });
    assert.equal('email' in result.profile, false);
  });
});

describe('home page and post API', () => {
  it('passes feed sorting and paging to the persisted post service', async () => {
    const { app, domainCalls } = setup();
    const response = await request(app).get('/api/posts?sort=hot&limit=20');

    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { success: true, posts: [], nextCursor: null });
    assert.deepEqual(domainCalls[0], ['posts', {
      viewerId: null,
      sort: 'hot',
      limit: 20,
      offset: 0,
    }]);
  });

  it('creates the low-level title, picture, and description post shape for a signed-in user', async () => {
    const { app, domainCalls } = setup();
    const response = await request(app)
      .post('/api/posts')
      .set('Cookie', 'reddit_session=login-token')
      .send({
        community: 'technology',
        title: 'Quantum computing update',
        image: 'https://images.example.test/post.jpg',
        description: 'Description for the frontend post editor.',
      });

    assert.equal(response.status, 201);
    assert.equal(response.body.success, true);
    assert.deepEqual(domainCalls[0], ['create-post', 1, {
      community: 'technology',
      title: 'Quantum computing update',
      image: 'https://images.example.test/post.jpg',
      text: 'Description for the frontend post editor.',
    }]);
  });

  it('searches usernames and post titles', async () => {
    const { app, domainCalls } = setup();
    const response = await request(app).get('/api/search?q=tech&limit=10');

    assert.equal(response.status, 200);
    assert.equal(response.body.query, 'tech');
    assert.deepEqual(domainCalls[0], ['search', 'tech', 10]);
  });
});

describe('community, social, notification, and chat API', () => {
  it('joins a community for an authenticated user', async () => {
    const { app, domainCalls } = setup();
    const response = await request(app)
      .post('/api/communities/artificial/join')
      .set('Cookie', 'reddit_session=login-token');

    assert.equal(response.status, 200);
    assert.deepEqual(response.body.community, { name: 'artificial', joined: true });
    assert.deepEqual(domainCalls[0], ['join', 'artificial', 1]);
  });

  it('creates a follow needed for mutual direct chat and lists notifications', async () => {
    const { app, domainCalls } = setup();
    const follow = await request(app)
      .post('/api/profiles/other_user/follow')
      .set('Cookie', 'reddit_session=login-token');
    const notifications = await request(app)
      .get('/api/notifications?limit=20')
      .set('Cookie', 'reddit_session=login-token');

    assert.equal(follow.status, 200);
    assert.equal(notifications.status, 200);
    assert.deepEqual(domainCalls[0], ['follow', 1, 'other_user']);
    assert.deepEqual(domainCalls[1], ['notifications', 1, 20, 0]);
  });

  it('updates a signed-in username through its dedicated endpoint', async () => {
    const { app, domainCalls } = setup();
    const response = await request(app)
      .patch('/api/me/username')
      .set('Cookie', 'reddit_session=login-token')
      .send({ username: 'new_username' });

    assert.equal(response.status, 200);
    assert.deepEqual(domainCalls[0], ['username', 1, 'new_username']);
  });

  it('exposes authenticated REST history endpoints used before socket subscriptions', async () => {
    const { app, domainCalls } = setup();
    const community = await request(app)
      .get('/api/chats/communities/artificial/messages')
      .set('Cookie', 'reddit_session=login-token');
    const direct = await request(app)
      .get('/api/chats/users/other_user/messages')
      .set('Cookie', 'reddit_session=login-token');

    assert.equal(community.status, 200);
    assert.equal(direct.status, 200);
    assert.deepEqual(domainCalls[0], ['community-messages', 1, 'artificial', 20, 0]);
    assert.deepEqual(domainCalls[1], ['direct-messages', 1, 'other_user', 20, 0]);
  });

  it('returns the authenticated mutual-follow inbox conversation list', async () => {
    const { app, domainCalls } = setup();
    const response = await request(app)
      .get('/api/chats/conversations?limit=30')
      .set('Cookie', 'reddit_session=login-token');

    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { success: true, conversations: [], nextCursor: null });
    assert.deepEqual(domainCalls[0], ['conversations', 1, 30, 0]);
  });

  it('returns the inbox-specific error when conversations are requested while signed out', async () => {
    const { app } = setup();
    const response = await request(app).get('/api/chats/conversations');

    assert.equal(response.status, 401);
    assert.deepEqual(response.body, {
      success: false,
      error: 'You must be logged in to view messages.',
    });
  });

  it('marks direct and community messages as read', async () => {
    const { app, domainCalls } = setup();
    const direct = await request(app)
      .post('/api/chats/conversations/other_user/read')
      .set('Cookie', 'reddit_session=login-token');
    const community = await request(app)
      .post('/api/chats/communities/artificial/read')
      .set('Cookie', 'reddit_session=login-token');

    assert.equal(direct.status, 200);
    assert.equal(community.status, 200);
    assert.deepEqual(domainCalls, [
      ['direct-read', 1, 'other_user'],
      ['community-read', 1, 'artificial'],
    ]);
  });

  it('sets reactions on direct and community chat messages', async () => {
    const { app, domainCalls } = setup();
    const direct = await request(app)
      .put('/api/chats/users/other_user/messages/12/reaction')
      .set('Cookie', 'reddit_session=login-token')
      .send({ reaction: 'love' });
    const community = await request(app)
      .put('/api/chats/communities/artificial/messages/7/reaction')
      .set('Cookie', 'reddit_session=login-token')
      .send({ reaction: 'laugh' });

    assert.equal(direct.status, 200);
    assert.equal(community.status, 200);
    assert.deepEqual(domainCalls, [
      ['direct-reaction', 1, 'other_user', '12', 'love'],
      ['community-reaction', 1, 'artificial', '7', 'laugh'],
    ]);
  });
});

describe('chat reaction validation', () => {
  it('rejects reaction values outside the five supported chat reactions', async () => {
    const db = {
      async query(sql) {
        if (sql.includes('SELECT id FROM direct_messages')) return { rows: [{ id: 12 }] };
        throw new Error('Reaction insert must not occur for an invalid value.');
      },
    };
    const service = new ChatService(db, {}, {
      async requireMutualFollow() {
        return { id: 2, username: 'other_user' };
      },
    });

    await assert.rejects(
      service.setDirectReaction(1, 'other_user', 12, 'fire'),
      (error) => error instanceof HttpError && error.status === 400,
    );
  });
});

describe('follow notifications', () => {
  it('notifies the followed user before the follow becomes mutual', async () => {
    const notifications = [];
    const service = new SocialService({
      async query(sql) {
        if (sql.includes('SELECT id, username FROM users WHERE LOWER')) {
          return { rows: [{ id: '2', username: 'bob' }] };
        }
        if (sql.includes('INSERT INTO user_follows')) {
          return { rows: [{ follower_id: '1' }] };
        }
        if (sql.includes('SELECT 1 FROM user_follows')) return { rows: [] };
        if (sql.includes('SELECT username FROM users WHERE id')) {
          return { rows: [{ username: 'alice' }] };
        }
        if (sql.includes("'new_follower'")) {
          return {
            rows: [{
              id: '40',
              user_id: '2',
              type: 'new_follower',
              actor_id: '1',
              related_user_id: '1',
              message: 'u/alice followed you.',
              post_id: null,
              read_at: null,
              created_at: new Date('2026-05-26T10:00:00.000Z'),
            }],
          };
        }
        throw new Error('Unexpected query');
      },
    });
    service.onNotification = async (userId, notification) => notifications.push({ userId, notification });

    await service.follow(1, 'bob');

    assert.deepEqual(notifications, [{
      userId: 2,
      notification: {
        id: 40,
        type: 'new_follower',
        message: 'u/alice followed you.',
        postId: null,
        actor: 'alice',
        targetUsername: 'alice',
        read: false,
        createdAt: '2026-05-26T10:00:00.000Z',
      },
    }]);
  });

  it('adds mutual-chat notifications once when a reciprocal follow is established', async () => {
    let insertedFollow = false;
    let newFollowerWrites = 0;
    let mutualWrites = 0;
    const callbackCalls = [];
    const createdAt = new Date('2026-05-26T10:20:30.000Z');
    const service = new SocialService({
      async query(sql) {
        if (sql.includes('SELECT id, username FROM users WHERE LOWER')) {
          return { rows: [{ id: '2', username: 'bob' }] };
        }
        if (sql.includes('INSERT INTO user_follows')) {
          if (insertedFollow) return { rows: [] };
          insertedFollow = true;
          return { rows: [{ follower_id: '1' }] };
        }
        if (sql.includes('SELECT 1 FROM user_follows')) return { rows: [{ '?column?': 1 }] };
        if (sql.includes('SELECT username FROM users WHERE id')) {
          return { rows: [{ username: 'alice' }] };
        }
        if (sql.includes("'new_follower'")) {
          newFollowerWrites += 1;
          return {
            rows: [{
              id: '41',
              user_id: '2',
              type: 'new_follower',
              actor_id: '1',
              related_user_id: '1',
              message: 'u/alice followed you.',
              post_id: null,
              read_at: null,
              created_at: createdAt,
            }],
          };
        }
        if (sql.includes('SELECT id, username FROM users WHERE id IN')) {
          return { rows: [{ id: '1', username: 'alice' }, { id: '2', username: 'bob' }] };
        }
        if (sql.includes("'mutual_follow'")) {
          mutualWrites += 1;
          return {
            rows: [
              {
                id: '42',
                user_id: '1',
                type: 'mutual_follow',
                actor_id: '2',
                related_user_id: '2',
                message: 'You and u/bob now follow each other. You can start chatting.',
                post_id: null,
                read_at: null,
                created_at: createdAt,
              },
              {
                id: '43',
                user_id: '2',
                type: 'mutual_follow',
                actor_id: '1',
                related_user_id: '1',
                message: 'You and u/alice now follow each other. You can start chatting.',
                post_id: null,
                read_at: null,
                created_at: createdAt,
              },
            ],
          };
        }
        throw new Error('Unexpected query');
      },
    });
    service.onMutualFollow = async (...arguments_) => callbackCalls.push(arguments_);

    await service.follow(1, 'bob');
    await service.follow(1, 'bob');

    assert.equal(newFollowerWrites, 1);
    assert.equal(mutualWrites, 1);
    assert.equal(callbackCalls.length, 1);
    assert.deepEqual(callbackCalls[0][2][0].notification, {
      id: 42,
      type: 'mutual_follow',
      message: 'You and u/bob now follow each other. You can start chatting.',
      postId: null,
      actor: 'bob',
      targetUsername: 'bob',
      read: false,
      createdAt: '2026-05-26T10:20:30.000Z',
    });
  });

  it('returns targetUsername for user-related notification items', async () => {
    const service = new SocialService({
      async query() {
        return {
          rows: [
            {
              id: '41',
              type: 'new_follower',
              message: 'u/bob followed you.',
              post_id: null,
              read_at: null,
              created_at: new Date('2026-05-26T10:19:30.000Z'),
              actor: 'bob',
              target_username: 'bob',
            },
            {
              id: '42',
              type: 'mutual_follow',
              message: 'Chat available.',
              post_id: null,
              read_at: null,
              created_at: new Date('2026-05-26T10:20:30.000Z'),
              actor: 'bob',
              target_username: 'bob',
            },
            {
              id: '43',
              type: 'post_created',
              message: 'Published.',
              post_id: '9',
              read_at: null,
              created_at: new Date('2026-05-26T10:21:30.000Z'),
              actor: 'alice',
              target_username: null,
            },
          ],
        };
      },
    });

    const result = await service.notifications(1, 20, 0);

    assert.equal(result.notifications[0].targetUsername, 'bob');
    assert.equal(result.notifications[1].targetUsername, 'bob');
    assert.equal(result.notifications[2].targetUsername, null);
  });
});
