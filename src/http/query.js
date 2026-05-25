import { HttpError } from '../errors.js';

export function parseLimit(value, fallback = 20, maximum = 50) {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    throw new HttpError(400, `Limit must be an integer from 1 to ${maximum}.`);
  }

  const result = Number.parseInt(value, 10);
  if (result < 1 || result > maximum) {
    throw new HttpError(400, `Limit must be an integer from 1 to ${maximum}.`);
  }
  return result;
}

export function cursorOffset(value) {
  if (value === undefined || value === null) return 0;

  try {
    const decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (!Number.isSafeInteger(decoded.offset) || decoded.offset < 0) throw new Error();
    return decoded.offset;
  } catch {
    throw new HttpError(400, 'Cursor is invalid.');
  }
}

export function nextCursor(offset, limit, rows) {
  if (rows.length <= limit) return null;
  return Buffer.from(JSON.stringify({ offset: offset + limit })).toString('base64url');
}
