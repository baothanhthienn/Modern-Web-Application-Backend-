import { Router } from 'express';
import { HttpError } from '../errors.js';
import { parseActivityQuery, parseSavedQuery } from './profile.validation.js';

function asyncRoute(handler) {
  return (request, response, next) => {
    Promise.resolve(handler(request, response, next)).catch(next);
  };
}

async function optionalViewer(authService, token) {
  if (!token) return null;

  try {
    const session = await authService.session(token);
    return session.user;
  } catch (error) {
    if (error instanceof HttpError && error.status === 401) {
      return null;
    }
    throw error;
  }
}

async function requiredViewer(authService, token) {
  try {
    const session = await authService.session(token);
    return session.user;
  } catch (error) {
    if (error instanceof HttpError && error.status === 401) {
      throw new HttpError(401, 'You must be logged in to view saved posts.');
    }
    throw error;
  }
}

export function createProfileRouter({ profileService, authService, config }) {
  const router = Router();

  router.get('/:username/activity', asyncRoute(async (request, response) => {
    const options = parseActivityQuery(request.query);
    const result = await profileService.activity(request.params.username, options);
    response.json({ success: true, ...result });
  }));

  router.get('/:username', asyncRoute(async (request, response) => {
    const result = await profileService.findPublicProfile(request.params.username);
    const viewerUser = await optionalViewer(
      authService,
      request.cookies[config.sessionCookieName],
    );
    const isAuthenticated = Boolean(viewerUser);
    const isSelf = isAuthenticated && Number(viewerUser.id) === result.userId;
    const isFollowing = isAuthenticated && !isSelf
      ? await profileService.isFollowing(viewerUser.id, result.userId)
      : false;

    response.json({
      success: true,
      profile: result.profile,
      viewer: {
        isAuthenticated,
        isSelf,
        isFollowing,
        canMessage: isAuthenticated && !isSelf,
      },
    });
  }));

  return router;
}

export function createMeRouter({ profileService, authService, config }) {
  const router = Router();

  router.get('/saved', asyncRoute(async (request, response) => {
    const options = parseSavedQuery(request.query);
    const viewer = await requiredViewer(authService, request.cookies[config.sessionCookieName]);
    const result = await profileService.saved(viewer.id, options);
    response.json({ success: true, ...result });
  }));

  return router;
}
