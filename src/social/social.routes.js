import { Router } from 'express';
import { cursorOffset, parseLimit } from '../http/query.js';
import { requiredRequestUser } from '../http/request-auth.js';

function asyncRoute(handler) {
  return (request, response, next) => Promise.resolve(handler(request, response, next)).catch(next);
}

export function createSocialRouter({ socialService, authService, config }) {
  const router = Router();

  router.post('/profiles/:username/follow', asyncRoute(async (request, response) => {
    const user = await requiredRequestUser(request, authService, config);
    response.json({ success: true, viewer: await socialService.follow(user.id, request.params.username) });
  }));

  router.delete('/profiles/:username/follow', asyncRoute(async (request, response) => {
    const user = await requiredRequestUser(request, authService, config);
    response.json({ success: true, viewer: await socialService.unfollow(user.id, request.params.username) });
  }));

  router.get('/notifications', asyncRoute(async (request, response) => {
    const user = await requiredRequestUser(request, authService, config);
    const result = await socialService.notifications(
      user.id,
      parseLimit(request.query.limit),
      cursorOffset(request.query.cursor),
    );
    response.json({ success: true, ...result });
  }));

  router.patch('/me/username', asyncRoute(async (request, response) => {
    const user = await requiredRequestUser(request, authService, config);
    response.json({ success: true, user: await socialService.updateUsername(user.id, request.body.username) });
  }));

  return router;
}

