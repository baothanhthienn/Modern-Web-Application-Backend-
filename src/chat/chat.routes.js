import { Router } from 'express';
import { cursorOffset, parseLimit } from '../http/query.js';
import { requiredRequestUser } from '../http/request-auth.js';

function asyncRoute(handler) {
  return (request, response, next) => Promise.resolve(handler(request, response, next)).catch(next);
}

export function createChatRouter({ chatService, authService, config }) {
  const router = Router();

  router.get('/communities/:name/messages', asyncRoute(async (request, response) => {
    const user = await requiredRequestUser(request, authService, config);
    const result = await chatService.communityHistory(
      user.id,
      request.params.name,
      parseLimit(request.query.limit),
      cursorOffset(request.query.cursor),
    );
    response.json({ success: true, ...result });
  }));

  router.get('/users/:username/messages', asyncRoute(async (request, response) => {
    const user = await requiredRequestUser(request, authService, config);
    const result = await chatService.directHistory(
      user.id,
      request.params.username,
      parseLimit(request.query.limit),
      cursorOffset(request.query.cursor),
    );
    response.json({ success: true, ...result });
  }));

  return router;
}

