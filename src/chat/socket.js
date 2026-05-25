import { Server } from 'socket.io';
import { directRoom } from './chat.service.js';

function communityRoom(communityId) {
  return `community:${communityId}`;
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
        const sockets = await io.in(room).fetchSockets();
        for (const targetSocket of sockets) {
          try {
            await chatService.communityService.requireMembership(community, targetSocket.data.user.id);
            targetSocket.emit('community:message', result);
          } catch {
            targetSocket.leave(room);
          }
        }
        acknowledge({ success: true, ...result });
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
        acknowledge({ success: true, with: result.with, message: result.message });
      } catch (error) {
        acknowledge(failure(error));
      }
    });
  });

  return io;
}
