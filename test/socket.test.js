import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { afterEach, describe, it } from 'node:test';
import { io as connectSocket } from 'socket.io-client';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { attachSocketServer } from '../src/chat/socket.js';
import { createConfig } from '../src/config.js';
import { HttpError } from '../src/errors.js';

const active = [];

afterEach(async () => {
  while (active.length) {
    await active.pop()();
  }
});

function messageBody(body) {
  if (typeof body !== 'string' || body.trim().length === 0 || body.trim().length > 2000) {
    throw new HttpError(400, 'Message must be 1-2000 characters.');
  }
  return body.trim();
}

async function serverFixture() {
  const users = {
    'token-alice': { id: 1, username: 'alice' },
    'token-bob': { id: 2, username: 'bob' },
    'token-mallory': { id: 3, username: 'mallory' },
  };
  const communityMessages = [];
  const directMessages = [];
  const communityMembers = new Set([1, 2]);
  let id = 0;
  const config = createConfig({
    NODE_ENV: 'test',
    FRONTEND_ORIGIN: 'http://localhost:5173',
    SESSION_COOKIE_NAME: 'reddit_session',
  });
  const authService = {
    async session(token) {
      if (!users[token]) throw new HttpError(401, 'Session expired or invalid.');
      return { user: users[token] };
    },
  };
  const communityService = {
    async requireMembership(name, userId) {
      if (name !== 'artificial' || !communityMembers.has(Number(userId))) {
        throw new HttpError(403, 'Join this community before using its chat.');
      }
      return { id: 10, name: 'artificial' };
    },
  };
  const socialService = {
    async requireMutualFollow(userId, username) {
      const pairs = { alice: 1, bob: 2 };
      const targetId = pairs[username];
      if (!targetId || ![1, 2].includes(Number(userId)) || targetId === Number(userId)) {
        throw new HttpError(403, 'You can chat only after both users follow each other.');
      }
      return { id: targetId, username };
    },
  };
  const chatService = {
    communityService,
    socialService,
    async sendCommunityMessage(user, community, body) {
      await communityService.requireMembership(community, user.id);
      const message = {
        id: ++id,
        sender: user.username,
        body: messageBody(body),
        createdAt: '2026-05-25T00:00:00.000Z',
      };
      communityMessages.push(message);
      return { community, message };
    },
    async communityHistory(userId, name) {
      await communityService.requireMembership(name, userId);
      return { community: name, messages: communityMessages, nextCursor: null };
    },
    async sendDirectMessage(user, username, body) {
      const target = await socialService.requireMutualFollow(user.id, username);
      const message = {
        id: ++id,
        sender: user.username,
        body: messageBody(body),
        createdAt: '2026-05-25T00:00:00.000Z',
      };
      directMessages.push(message);
      return { recipientId: target.id, with: target.username, message };
    },
    async directHistory(userId, username) {
      await socialService.requireMutualFollow(userId, username);
      return { with: username, messages: directMessages, nextCursor: null };
    },
  };
  const app = createApp({
    config,
    authService,
    chatService,
    logger: { error() {} },
    healthService: { async check() { return { success: true }; } },
  });
  const httpServer = createServer(app);
  const io = attachSocketServer(httpServer, { config, authService, chatService });
  await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${httpServer.address().port}`;

  active.push(async () => {
    await new Promise((resolve) => io.close(resolve));
    if (httpServer.listening) await new Promise((resolve) => httpServer.close(resolve));
  });
  return {
    origin,
    revokeCommunityAccess(userId) {
      communityMembers.delete(Number(userId));
    },
  };
}

async function socketClient(origin, token) {
  const socket = connectSocket(origin, {
    transports: ['websocket'],
    extraHeaders: token ? { Cookie: `reddit_session=${token}` } : undefined,
  });
  active.push(async () => socket.close());
  await new Promise((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
  });
  return socket;
}

function emitWithAck(socket, event, payload) {
  return new Promise((resolve) => socket.emit(event, payload, resolve));
}

function once(socket, event) {
  return new Promise((resolve) => socket.once(event, resolve));
}

function delay(milliseconds = 30) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

describe('Socket.IO chat contract', () => {
  it('delivers one persisted community message to two joined members and REST history', async () => {
    const { origin } = await serverFixture();
    const alice = await socketClient(origin, 'token-alice');
    const bob = await socketClient(origin, 'token-bob');
    assert.equal((await emitWithAck(alice, 'community:join', { community: 'artificial' })).success, true);
    assert.equal((await emitWithAck(bob, 'community:join', { community: 'artificial' })).success, true);

    const aliceEvents = [];
    const bobEvents = [];
    let resolveAlice;
    let resolveBob;
    const aliceEvent = new Promise((resolve) => { resolveAlice = resolve; });
    const bobEvent = new Promise((resolve) => { resolveBob = resolve; });
    alice.on('community:message', (event) => {
      aliceEvents.push(event);
      resolveAlice(event);
    });
    bob.on('community:message', (event) => {
      bobEvents.push(event);
      resolveBob(event);
    });
    const sent = await emitWithAck(alice, 'community:message:send', {
      community: 'artificial',
      body: 'Hello community',
    });
    const [receivedByAlice, receivedByBob] = await Promise.all([aliceEvent, bobEvent]);

    assert.equal(sent.success, true);
    assert.deepEqual(receivedByAlice, receivedByBob);
    assert.equal(receivedByAlice.message.body, 'Hello community');
    await delay();
    assert.equal(aliceEvents.length, 1);
    assert.equal(bobEvents.length, 1);
    const history = await request(origin)
      .get('/api/chats/communities/artificial/messages')
      .set('Cookie', 'reddit_session=token-bob');
    assert.equal(history.status, 200);
    assert.deepEqual(history.body.messages, [sent.message]);
  });

  it('delivers direct messages to two mutually-following users with recipient-specific conversation names', async () => {
    const { origin } = await serverFixture();
    const alice = await socketClient(origin, 'token-alice');
    const bob = await socketClient(origin, 'token-bob');
    assert.equal((await emitWithAck(alice, 'direct:join', { username: 'bob' })).success, true);
    assert.equal((await emitWithAck(bob, 'direct:join', { username: 'alice' })).success, true);

    const aliceEvents = [];
    const bobEvents = [];
    let resolveAlice;
    let resolveBob;
    const aliceEvent = new Promise((resolve) => { resolveAlice = resolve; });
    const bobEvent = new Promise((resolve) => { resolveBob = resolve; });
    alice.on('direct:message', (event) => {
      aliceEvents.push(event);
      resolveAlice(event);
    });
    bob.on('direct:message', (event) => {
      bobEvents.push(event);
      resolveBob(event);
    });
    const sent = await emitWithAck(alice, 'direct:message:send', {
      username: 'bob',
      body: 'Hello Bob',
    });
    const [receivedByAlice, receivedByBob] = await Promise.all([aliceEvent, bobEvent]);

    assert.equal(sent.success, true);
    assert.equal(receivedByAlice.with, 'bob');
    assert.equal(receivedByBob.with, 'alice');
    assert.deepEqual(receivedByAlice.message, receivedByBob.message);
    await delay();
    assert.equal(aliceEvents.length, 1);
    assert.equal(bobEvents.length, 1);
    const history = await request(origin)
      .get('/api/chats/users/alice/messages')
      .set('Cookie', 'reddit_session=token-bob');
    assert.equal(history.status, 200);
    assert.deepEqual(history.body.messages, [sent.message]);

    assert.equal((await emitWithAck(bob, 'direct:leave', { username: 'alice' })).success, true);
    const beforeSecondMessageCount = bobEvents.length;
    assert.equal((await emitWithAck(alice, 'direct:message:send', {
      username: 'bob',
      body: 'Only subscribed clients receive this.',
    })).success, true);
    await delay();
    assert.equal(bobEvents.length, beforeSecondMessageCount);

    assert.equal((await emitWithAck(alice, 'direct:leave', { username: 'bob' })).success, true);
    assert.equal((await emitWithAck(alice, 'direct:message:send', {
      username: 'bob',
      body: 'Sender already left.',
    })).success, false);
  });

  it('requires room joins, blocks revoked community recipients, and supports leaving', async () => {
    const { origin, revokeCommunityAccess } = await serverFixture();
    const alice = await socketClient(origin, 'token-alice');
    const bob = await socketClient(origin, 'token-bob');
    const beforeJoin = await emitWithAck(alice, 'community:message:send', {
      community: 'artificial',
      body: 'Not joined',
    });
    assert.deepEqual(beforeJoin, {
      success: false,
      error: 'Join this conversation before sending messages.',
    });

    await emitWithAck(alice, 'community:join', { community: 'artificial' });
    await emitWithAck(bob, 'community:join', { community: 'artificial' });
    revokeCommunityAccess(2);
    let deliveredAfterLeave = false;
    bob.once('community:message', () => { deliveredAfterLeave = true; });
    const sent = await emitWithAck(alice, 'community:message:send', {
      community: 'artificial',
      body: 'Only active room members see this.',
    });
    await delay();
    assert.equal(sent.success, true);
    assert.equal(deliveredAfterLeave, false);
    assert.equal((await emitWithAck(bob, 'community:leave', { community: 'artificial' })).success, true);
  });

  it('requires the client to rejoin a room after reconnecting', async () => {
    const { origin } = await serverFixture();
    const alice = await socketClient(origin, 'token-alice');
    let bob = await socketClient(origin, 'token-bob');
    await emitWithAck(alice, 'community:join', { community: 'artificial' });
    await emitWithAck(bob, 'community:join', { community: 'artificial' });
    bob.close();
    bob = await socketClient(origin, 'token-bob');

    let beforeRejoin = false;
    bob.once('community:message', () => { beforeRejoin = true; });
    await emitWithAck(alice, 'community:message:send', {
      community: 'artificial',
      body: 'Before rejoin',
    });
    await delay();
    assert.equal(beforeRejoin, false);

    await emitWithAck(bob, 'community:join', { community: 'artificial' });
    const afterRejoin = once(bob, 'community:message');
    await emitWithAck(alice, 'community:message:send', {
      community: 'artificial',
      body: 'After rejoin',
    });
    assert.equal((await afterRejoin).message.body, 'After rejoin');
  });

  it('rejects invalid authentication, authorization, and message bodies', async () => {
    const { origin } = await serverFixture();
    const unauthorized = connectSocket(origin, { transports: ['websocket'] });
    active.push(async () => unauthorized.close());
    const handshakeError = await new Promise((resolve) => unauthorized.once('connect_error', resolve));
    assert.equal(handshakeError.message, 'Authentication required.');

    const mallory = await socketClient(origin, 'token-mallory');
    const failedJoin = await emitWithAck(mallory, 'community:join', { community: 'artificial' });
    const failedDirectJoin = await emitWithAck(mallory, 'direct:join', { username: 'alice' });
    assert.equal(failedJoin.success, false);
    assert.equal(failedDirectJoin.success, false);

    const alice = await socketClient(origin, 'token-alice');
    await emitWithAck(alice, 'community:join', { community: 'artificial' });
    assert.equal((await emitWithAck(alice, 'community:message:send', {
      community: 'artificial',
      body: ' ',
    })).success, false);
    assert.equal((await emitWithAck(alice, 'community:message:send', {
      community: 'artificial',
      body: 'x'.repeat(2001),
    })).success, false);
  });
});
