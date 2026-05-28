import { Router } from 'express';
import { requiredRequestUser, optionalRequestUser } from '../http/request-auth.js';
import { cursorOffset, parseLimit } from '../http/query.js';
import { parseFeedSort, validatePost, validatePostUpdate, validateVote } from './post.validation.js';

function asyncRoute(handler) {
  return (request, response, next) => Promise.resolve(handler(request, response, next)).catch(next);
}

export function createPostRouter({ postService, authService, config }) {
  const router = Router();

  router.get('/', asyncRoute(async (request, response) => {
    const user = await optionalRequestUser(request, authService, config);
    const result = await postService.list({
      viewerId: user?.id ?? null,
      sort: parseFeedSort(request.query.sort),
      limit: parseLimit(request.query.limit),
      offset: cursorOffset(request.query.cursor),
    });
    response.json({ success: true, ...result });
  }));

  router.post('/', asyncRoute(async (request, response) => {
    const user = await requiredRequestUser(request, authService, config);
    const post = await postService.create(user.id, validatePost(request.body));
    response.status(201).json({ success: true, post });
  }));

  router.get('/:postId', asyncRoute(async (request, response) => {
    const user = await optionalRequestUser(request, authService, config);
    const post = await postService.get(request.params.postId, user?.id ?? null);
    response.json({ success: true, post });
  }));

  router.patch('/:postId', asyncRoute(async (request, response) => {
    const user = await requiredRequestUser(request, authService, config);
    const post = await postService.update(user.id, request.params.postId, validatePostUpdate(request.body));
    response.json({ success: true, post });
  }));

  router.delete('/:postId', asyncRoute(async (request, response) => {
    const user = await requiredRequestUser(request, authService, config);
    await postService.delete(user.id, request.params.postId);
    response.json({ success: true });
  }));

  router.put('/:postId/vote', asyncRoute(async (request, response) => {
    const user = await requiredRequestUser(request, authService, config);
    const post = await postService.vote(user.id, request.params.postId, validateVote(request.body));
    response.json({ success: true, post });
  }));

  router.put('/:postId/saved', asyncRoute(async (request, response) => {
    const user = await requiredRequestUser(request, authService, config);
    const post = await postService.setSaved(user.id, request.params.postId, true);
    response.json({ success: true, post });
  }));

  router.delete('/:postId/saved', asyncRoute(async (request, response) => {
    const user = await requiredRequestUser(request, authService, config);
    const post = await postService.setSaved(user.id, request.params.postId, false);
    response.json({ success: true, post });
  }));

  return router;
}

export function createSearchRouter({ postService }) {
  const router = Router();

  router.get('/', asyncRoute(async (request, response) => {
    const query = typeof request.query.q === 'string' ? request.query.q.trim() : '';
    if (query.length < 2 || query.length > 100) {
      return response.status(400).json({ success: false, error: 'Search query must be 2-100 characters.' });
    }
    const result = await postService.search(query, parseLimit(request.query.limit, 10, 20));
    return response.json({ success: true, query, ...result });
  }));

  return router;
}
