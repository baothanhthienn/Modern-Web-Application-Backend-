import { Router } from 'express';
import { validateLogin, validateRegistration } from './auth.validation.js';

function asyncRoute(handler) {
  return (request, response, next) => {
    Promise.resolve(handler(request, response, next)).catch(next);
  };
}

function cookieOptions(config) {
  return {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: config.cookieSameSite,
    maxAge: config.sessionTtlMs,
    path: '/',
  };
}

function clearCookieOptions(config) {
  const { maxAge, ...options } = cookieOptions(config);
  return options;
}

export function createAuthRouter({ authService, config }) {
  const router = Router();

  router.post('/register', asyncRoute(async (request, response) => {
    const validation = validateRegistration(request.body);
    if (validation.error) {
      return response.status(400).json({ success: false, error: validation.error });
    }

    const result = await authService.register(validation.value);
    response.cookie(config.sessionCookieName, result.token, cookieOptions(config));
    return response.status(201).json({ success: true, user: result.user });
  }));

  router.post('/login', asyncRoute(async (request, response) => {
    const validation = validateLogin(request.body);
    if (validation.error) {
      return response.status(401).json({ success: false, error: validation.error });
    }

    const result = await authService.login(validation.value);
    response.cookie(config.sessionCookieName, result.token, cookieOptions(config));
    return response.json({ success: true, user: result.user });
  }));

  router.get('/session', asyncRoute(async (request, response) => {
    const result = await authService.session(request.cookies[config.sessionCookieName]);
    return response.json({ success: true, user: result.user });
  }));

  router.post('/logout', asyncRoute(async (request, response) => {
    await authService.logout(request.cookies[config.sessionCookieName]);
    response.clearCookie(config.sessionCookieName, clearCookieOptions(config));
    return response.json({ success: true });
  }));

  return router;
}
