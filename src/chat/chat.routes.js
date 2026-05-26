import { Router } from 'express';
import { cursorOffset, parseLimit } from '../http/query.js';
import { requiredRequestUser } from '../http/request-auth.js';

function asyncRoute(handler) {
  return (request, response, next) => Promise.resolve(handler(request, response, next)).catch(next);
}

export function createChatRouter({ chatService, authService, config }) {
  const router = Router();

  router.get('/conversations', asyncRoute(async (request, response) => {
    const user = await requiredRequestUser(
      request,
      authService,
      config,
      'You must be logged in to view messages.',
    );
    const result = await chatService.conversations(
      user.id,
      parseLimit(request.query.limit, 30),
      cursorOffset(request.query.cursor),
    );
    response.json({ success: true, ...result });
  }));

  router.post('/conversations/:username/read', asyncRoute(async (request, response) => {
    const user = await requiredRequestUser(
      request,
      authService,
      config,
      'You must be logged in to view messages.',
    );
    response.json({ success: true, ...(await chatService.markDirectRead(user.id, request.params.username)) });
  }));

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

  router.post('/communities/:name/read', asyncRoute(async (request, response) => {
    const user = await requiredRequestUser(request, authService, config);
    response.json({ success: true, ...(await chatService.markCommunityRead(user.id, request.params.name)) });
  }));

  router.put('/communities/:name/messages/:messageId/reaction', asyncRoute(async (request, response) => {
    const user = await requiredRequestUser(request, authService, config);
    const state = await chatService.setCommunityReaction(
      user.id,
      request.params.name,
      request.params.messageId,
      request.body.reaction,
    );
    response.json({ success: true, ...state });
  }));

  router.delete('/communities/:name/messages/:messageId/reaction', asyncRoute(async (request, response) => {
    const user = await requiredRequestUser(request, authService, config);
    const state = await chatService.removeCommunityReaction(
      user.id,
      request.params.name,
      request.params.messageId,
    );
    response.json({ success: true, ...state });
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

  router.put('/users/:username/messages/:messageId/reaction', asyncRoute(async (request, response) => {
    const user = await requiredRequestUser(request, authService, config);
    const state = await chatService.setDirectReaction(
      user.id,
      request.params.username,
      request.params.messageId,
      request.body.reaction,
    );
    response.json({ success: true, ...state });
  }));

  router.delete('/users/:username/messages/:messageId/reaction', asyncRoute(async (request, response) => {
    const user = await requiredRequestUser(request, authService, config);
    const state = await chatService.removeDirectReaction(
      user.id,
      request.params.username,
      request.params.messageId,
    );
    response.json({ success: true, ...state });
  }));

  return router;
}
