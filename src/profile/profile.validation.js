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

