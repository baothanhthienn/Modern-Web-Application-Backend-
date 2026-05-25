import { HttpError } from '../errors.js';

export async function optionalRequestUser(request, authService, config) {
  const token = request.cookies[config.sessionCookieName];
  if (!token) return null;

  try {
    return (await authService.session(token)).user;
  } catch (error) {
    if (error instanceof HttpError && error.status === 401) return null;
    throw error;
  }
}

export async function requiredRequestUser(
  request,
  authService,
  config,
  message = 'You must be logged in.',
) {
  const user = await optionalRequestUser(request, authService, config);
  if (!user) throw new HttpError(401, message);
  return user;
}

