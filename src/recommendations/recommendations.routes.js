import { Router } from 'express';
import { requiredRequestUser } from '../http/request-auth.js';

function asyncRoute(handler) {
  return (request, response, next) => Promise.resolve(handler(request, response, next)).catch(next);
}

export function createRecommendationRouter({ recommendationService, authService, config }) {
  const router = Router();

  router.post('/events', asyncRoute(async (request, response) => {
    const user = await requiredRequestUser(request, authService, config);
    await recommendationService.recordEvent(user.id, request.body);
    response.json({ success: true });
  }));

  router.get('/history', asyncRoute(async (request, response) => {
    const user = await requiredRequestUser(request, authService, config);
    const history = await recommendationService.getHistory(user.id);
    response.json({ success: true, ...history });
  }));

  return router;
}
