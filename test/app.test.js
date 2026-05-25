import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createConfig } from '../src/config.js';
import { HttpError } from '../src/errors.js';

const user = {
  id: 1,
  username: 'sample_user',
  email: 'sample@example.com',
  joinDate: '2026-05-25T00:00:00.000Z',
};

function setup(overrides = {}) {
  const calls = [];
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
    ...overrides,
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
    logger: { error() {} },
    healthService: {
      async check() {
        return { success: true, database: 'connected', databaseName: 'railway', serverVersion: 'PostgreSQL' };
      },
    },
  });

  return { app, calls };
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
