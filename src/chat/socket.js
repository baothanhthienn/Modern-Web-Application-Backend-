import { Server } from 'socket.io';
import { directRoom } from './chat.service.js';

function communityRoom(communityId) {
  return `community:${communityId}`;
}

function userRoom(userId) {
  return `user:${Number(userId)}`;
}

function cookieValue(header, name) {
  if (!header) return null;
  for (const item of header.split(';')) {
    const [key, ...value] = item.trim().split('=');
    if (key === name) return decodeURIComponent(value.join('='));
  }
  return null;
}

function failure(error) {
  return { success: false, error: error.message || 'Chat service failed.' };
}

function requireJoined(socket, room) {
  if (!socket.rooms.has(room)) {
    throw new Error('Join this conversation before sending messages.');
  }
}

export function attachSocketServer(httpServer, { config, authService, chatService }) {
  const io = new Server(httpServer, {
    cors: { origin: config.frontendOrigins, credentials: true },
  });

  io.use(async (socket, next) => {
    try {
      const token = cookieValue(socket.handshake.headers.cookie, config.sessionCookieName);
      socket.data.user = (await authService.session(token)).user;
      next();
    } catch {
      next(new Error('Authentication required.'));
    }
  });

  io.on('connection', (socket) => {
    const user = socket.data.user;
    const joinedCommunities = new Map();
    const joinedDirectChats = new Map();
    socket.join(userRoom(user.id));

    async function emitConversation(firstUserId, secondUserId) {
      if (typeof chatService.conversation !== 'function') return;
      const [first, second] = await Promise.all([
        chatService.conversation(firstUserId, secondUserId),
        chatService.conversation(secondUserId, firstUserId),
      ]);
      io.to(userRoom(firstUserId)).emit('direct:conversation', { conversation: first });
      io.to(userRoom(secondUserId)).emit('direct:conversation', { conversation: second });
    }

    async function emitCommunityAuthorized(event, payload, community, room, excludedSocketId = null) {
      const sockets = await io.in(room).fetchSockets();
      for (const targetSocket of sockets) {
        if (targetSocket.id === excludedSocketId) continue;
        try {
          await chatService.communityService.requireMembership(community, targetSocket.data.user.id);
          targetSocket.emit(event, payload);
        } catch {
          targetSocket.leave(room);
        }
      }
    }

    socket.on('community:join', async (payload = {}, acknowledge = () => {}) => {
      try {
        const { community } = payload;
        const allowed = await chatService.communityService.requireMembership(community, user.id);
        const room = communityRoom(allowed.id);
        socket.join(room);
        joinedCommunities.set(allowed.name.toLowerCase(), { room, name: allowed.name });
        acknowledge({ success: true, community: allowed.name });
      } catch (error) {
        acknowledge(failure(error));
      }
    });

    socket.on('community:leave', async (payload = {}, acknowledge = () => {}) => {
      try {
        const { community } = payload;
        const joined = typeof community === 'string'
          ? joinedCommunities.get(community.toLowerCase())
          : null;
        if (!joined) throw new Error('Conversation is not joined.');
        socket.leave(joined.room);
        joinedCommunities.delete(joined.name.toLowerCase());
        acknowledge({ success: true, community: joined.name });
      } catch (error) {
        acknowledge(failure(error));
      }
    });

    socket.on('community:message:send', async (payload = {}, acknowledge = () => {}) => {
      try {
        const { community, body } = payload;
        const allowed = await chatService.communityService.requireMembership(community, user.id);
        const room = communityRoom(allowed.id);
        requireJoined(socket, room);
        const result = await chatService.sendCommunityMessage(user, community, body);
        await emitCommunityAuthorized('community:message', result, community, room);
        acknowledge({ success: true, ...result });
      } catch (error) {
        acknowledge(failure(error));
      }
    });

    socket.on('community:typing', async (payload = {}, acknowledge = () => {}) => {
      try {
        const { community, isTyping } = payload;
        const allowed = await chatService.communityService.requireMembership(community, user.id);
        const room = communityRoom(allowed.id);
        requireJoined(socket, room);
        await emitCommunityAuthorized('community:typing', {
          community: allowed.name,
          username: user.username,
          isTyping: Boolean(isTyping),
        }, community, room, socket.id);
        acknowledge({ success: true });
      } catch (error) {
        acknowledge(failure(error));
      }
    });

    socket.on('community:read', async (payload = {}, acknowledge = () => {}) => {
      try {
        const { community } = payload;
        const allowed = await chatService.communityService.requireMembership(community, user.id);
        const room = communityRoom(allowed.id);
        requireJoined(socket, room);
        const state = await chatService.markCommunityRead(user.id, community);
        await emitCommunityAuthorized(
          'community:read',
          { ...state, username: user.username },
          community,
          room,
          socket.id,
        );
        acknowledge({ success: true, ...state });
      } catch (error) {
        acknowledge(failure(error));
      }
    });

    socket.on('community:reaction:set', async (payload = {}, acknowledge = () => {}) => {
      try {
        const { community, messageId, reaction } = payload;
        const allowed = await chatService.communityService.requireMembership(community, user.id);
        const room = communityRoom(allowed.id);
        requireJoined(socket, room);
        const state = await chatService.setCommunityReaction(user.id, community, messageId, reaction);
        await emitCommunityAuthorized('community:reaction', {
          community: allowed.name,
          messageId: state.messageId,
          reactions: state.reactions,
          actor: user.username,
          actorReaction: state.viewerReaction,
        }, community, room);
        acknowledge({ success: true, community: allowed.name, ...state });
      } catch (error) {
        acknowledge(failure(error));
      }
    });

    socket.on('community:reaction:remove', async (payload = {}, acknowledge = () => {}) => {
      try {
        const { community, messageId } = payload;
        const allowed = await chatService.communityService.requireMembership(community, user.id);
        const room = communityRoom(allowed.id);
        requireJoined(socket, room);
        const state = await chatService.removeCommunityReaction(user.id, community, messageId);
        await emitCommunityAuthorized('community:reaction', {
          community: allowed.name,
          messageId: state.messageId,
          reactions: state.reactions,
          actor: user.username,
          actorReaction: null,
        }, community, room);
        acknowledge({ success: true, community: allowed.name, ...state });
      } catch (error) {
        acknowledge(failure(error));
      }
    });

    socket.on('direct:join', async (payload = {}, acknowledge = () => {}) => {
      try {
        const { username } = payload;
        const target = await chatService.socialService.requireMutualFollow(user.id, username);
        const room = directRoom(user.id, target.id);
        socket.join(room);
        joinedDirectChats.set(target.username.toLowerCase(), { room, username: target.username });
        acknowledge({ success: true, with: target.username });
      } catch (error) {
        acknowledge(failure(error));
      }
    });

    socket.on('direct:leave', async (payload = {}, acknowledge = () => {}) => {
      try {
        const { username } = payload;
        const joined = typeof username === 'string'
          ? joinedDirectChats.get(username.toLowerCase())
          : null;
        if (!joined) throw new Error('Conversation is not joined.');
        socket.leave(joined.room);
        joinedDirectChats.delete(joined.username.toLowerCase());
        acknowledge({ success: true, with: joined.username });
      } catch (error) {
        acknowledge(failure(error));
      }
    });

    socket.on('direct:message:send', async (payload = {}, acknowledge = () => {}) => {
      try {
        const { username, body } = payload;
        const target = await chatService.socialService.requireMutualFollow(user.id, username);
        const room = directRoom(user.id, target.id);
        requireJoined(socket, room);
        const result = await chatService.sendDirectMessage(user, username, body);
        const sockets = await io.in(room).fetchSockets();
        for (const targetSocket of sockets) {
          const withUsername = Number(targetSocket.data.user.id) === Number(user.id)
            ? result.with
            : user.username;
          targetSocket.emit('direct:message', { with: withUsername, message: result.message });
        }
        await emitConversation(user.id, result.recipientId);
        acknowledge({ success: true, with: result.with, message: result.message });
      } catch (error) {
        acknowledge(failure(error));
      }
    });

    socket.on('direct:typing', async (payload = {}, acknowledge = () => {}) => {
      try {
        const { username, isTyping } = payload;
        const target = await chatService.socialService.requireMutualFollow(user.id, username);
        const room = directRoom(user.id, target.id);
        requireJoined(socket, room);
        socket.to(room).emit('direct:typing', {
          with: user.username,
          username: user.username,
          isTyping: Boolean(isTyping),
        });
        acknowledge({ success: true });
      } catch (error) {
        acknowledge(failure(error));
      }
    });

    socket.on('direct:read', async (payload = {}, acknowledge = () => {}) => {
      try {
        const { username } = payload;
        const target = await chatService.socialService.requireMutualFollow(user.id, username);
        const room = directRoom(user.id, target.id);
        requireJoined(socket, room);
        const state = await chatService.markDirectRead(user.id, username);
        socket.to(room).emit('direct:read', { ...state, with: user.username, by: user.username });
        await emitConversation(user.id, target.id);
        acknowledge({ success: true, ...state });
      } catch (error) {
        acknowledge(failure(error));
      }
    });

    socket.on('direct:reaction:set', async (payload = {}, acknowledge = () => {}) => {
      try {
        const { username, messageId, reaction } = payload;
        const target = await chatService.socialService.requireMutualFollow(user.id, username);
        const room = directRoom(user.id, target.id);
        requireJoined(socket, room);
        const state = await chatService.setDirectReaction(user.id, username, messageId, reaction);
        const sockets = await io.in(room).fetchSockets();
        for (const targetSocket of sockets) {
          const withUsername = Number(targetSocket.data.user.id) === Number(user.id)
            ? target.username
            : user.username;
          targetSocket.emit('direct:reaction', {
            with: withUsername,
            messageId: state.messageId,
            reactions: state.reactions,
            actor: user.username,
            actorReaction: state.viewerReaction,
          });
        }
        acknowledge({ success: true, with: target.username, ...state });
      } catch (error) {
        acknowledge(failure(error));
      }
    });

    socket.on('direct:reaction:remove', async (payload = {}, acknowledge = () => {}) => {
      try {
        const { username, messageId } = payload;
        const target = await chatService.socialService.requireMutualFollow(user.id, username);
        const room = directRoom(user.id, target.id);
        requireJoined(socket, room);
        const state = await chatService.removeDirectReaction(user.id, username, messageId);
        const sockets = await io.in(room).fetchSockets();
        for (const targetSocket of sockets) {
          const withUsername = Number(targetSocket.data.user.id) === Number(user.id)
            ? target.username
            : user.username;
          targetSocket.emit('direct:reaction', {
            with: withUsername,
            messageId: state.messageId,
            reactions: state.reactions,
            actor: user.username,
            actorReaction: null,
          });
        }
        acknowledge({ success: true, with: target.username, ...state });
      } catch (error) {
        acknowledge(failure(error));
      }
    });
  });

  if (chatService.socialService) {
    chatService.socialService.onMutualFollow = async (firstUserId, secondUserId, notifications = []) => {
      if (typeof chatService.conversation === 'function') {
        const [first, second] = await Promise.all([
          chatService.conversation(firstUserId, secondUserId),
          chatService.conversation(secondUserId, firstUserId),
        ]);
        io.to(userRoom(firstUserId)).emit('direct:conversation', { conversation: first });
        io.to(userRoom(secondUserId)).emit('direct:conversation', { conversation: second });
      }
      for (const item of notifications) {
        io.to(userRoom(item.userId)).emit('notification:new', {
          notification: item.notification,
        });
      }
    };
  }

  return io;
}
