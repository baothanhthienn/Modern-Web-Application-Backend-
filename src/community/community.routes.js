import { Router } from 'express';
import { optionalRequestUser, requiredRequestUser } from '../http/request-auth.js';

function asyncRoute(handler) {
  return (request, response, next) => Promise.resolve(handler(request, response, next)).catch(next);
}

export function createCommunityRouter({ communityService, authService, config }) {
  const router = Router();

  router.get('/', asyncRoute(async (request, response) => {
    const user = await optionalRequestUser(request, authService, config);
    response.json({ success: true, communities: await communityService.list(user?.id ?? null) });
  }));

  router.post('/:name/join', asyncRoute(async (request, response) => {
    const user = await requiredRequestUser(request, authService, config);
    response.json({ success: true, community: await communityService.join(request.params.name, user.id) });
  }));

  router.delete('/:name/join', asyncRoute(async (request, response) => {
    const user = await requiredRequestUser(request, authService, config);
    response.json({ success: true, community: await communityService.leave(request.params.name, user.id) });
  }));

  return router;
}

