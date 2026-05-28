import { createServer } from 'node:http';
import { createApp } from './app.js';
import { AuthService } from './auth/auth.service.js';
import { ChatService } from './chat/chat.service.js';
import { attachSocketServer } from './chat/socket.js';
import { CommunityService } from './community/community.service.js';
import { config } from './config.js';
import { createDatabase } from './db.js';
import { SocialService } from './social/social.service.js';

const db = createDatabase(config);
const authService = new AuthService(db, config);
const communityService = new CommunityService(db);
const socialService = new SocialService(db);
const chatService = new ChatService(db, communityService, socialService);
const app = createApp({
  config,
  db,
  authService,
  communityService,
  socialService,
  chatService,
});
const server = createServer(app);
const io = attachSocketServer(server, { config, authService, chatService });

server.listen(config.port, () => {
  console.log(`API listening on port ${config.port}.`);
});

async function shutdown(signal) {
  console.log(`${signal} received; closing server.`);
  io.close();
  server.close(async () => {
    await db.close();
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
