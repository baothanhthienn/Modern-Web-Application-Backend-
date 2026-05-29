import { HttpError } from '../errors.js';

const ACTIVITY_TYPES = new Set(['overview', 'posts', 'comments']);

function parseLimit(value) {
  if (value === undefined) return 20;

  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    throw new HttpError(400, 'Limit must be an integer from 1 to 50.');
  }

  const limit = Number.parseInt(value, 10);
  if (limit < 1 || limit > 50) {
    throw new HttpError(400, 'Limit must be an integer from 1 to 50.');
  }

  return limit;
}

function parseCursor(value) {
  if (value === undefined) return null;
  if (typeof value !== 'string' || value.length === 0) {
    throw new HttpError(400, 'Cursor must be a non-empty string.');
  }
  return value;
}

export function parseActivityQuery(query) {
  const type = query.type ?? 'overview';

  if (type === 'saved') {
    throw new HttpError(400, 'Saved activity is private.');
  }
  if (typeof type !== 'string' || !ACTIVITY_TYPES.has(type)) {
    throw new HttpError(400, 'Activity type must be overview, posts, or comments.');
  }

  return {
    type,
    limit: parseLimit(query.limit),
    cursor: parseCursor(query.cursor),
  };
}

export function parseSavedQuery(query) {
  return {
    limit: parseLimit(query.limit),
    cursor: parseCursor(query.cursor),
  };
}

export function validateAvatarUpdate(body) {
  const { avatarUrl = null, originalUrl = null, crop = null } = body ?? {};

  if (avatarUrl !== null) {
    if (typeof avatarUrl !== 'string' || !/^https:\/\//.test(avatarUrl)) {
      throw new HttpError(400, 'avatarUrl must be an HTTPS URL or null.');
    }
    if (originalUrl === null || typeof originalUrl !== 'string' || !/^https:\/\//.test(originalUrl)) {
      throw new HttpError(400, 'originalUrl must be an HTTPS URL when avatarUrl is set.');
    }
  }

  if (originalUrl !== null && (typeof originalUrl !== 'string' || !/^https:\/\//.test(originalUrl))) {
    throw new HttpError(400, 'originalUrl must be an HTTPS URL or null.');
  }

  if (crop !== null) {
    if (typeof crop !== 'object' || Array.isArray(crop)) {
      throw new HttpError(400, 'crop must be an object.');
    }
    for (const key of ['left', 'top', 'width', 'height']) {
      if (!Number.isFinite(crop[key]) || crop[key] < 0) {
        throw new HttpError(400, `crop.${key} must be a non-negative number.`);
      }
    }
    if (crop.width === 0 || crop.height === 0) {
      throw new HttpError(400, 'crop.width and crop.height must be greater than zero.');
    }
  }

  return { avatarUrl, originalUrl, crop };
}

