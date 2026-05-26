import { HttpError } from '../errors.js';

const FEED_SORTS = new Set(['best', 'hot', 'new', 'top', 'rising']);

function optionalString(value, field, maximum) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || value.trim().length > maximum) {
    throw new HttpError(400, `${field} must be no longer than ${maximum} characters.`);
  }
  return value.trim();
}

export function parseFeedSort(value) {
  const sort = value ?? 'best';
  if (typeof sort !== 'string' || !FEED_SORTS.has(sort.toLowerCase())) {
    throw new HttpError(400, 'Sort must be best, hot, new, top, or rising.');
  }
  return sort.toLowerCase();
}

export function validatePost(body = {}) {
  const community = optionalString(body.community, 'Community', 40);
  const title = optionalString(body.title, 'Title', 300);
  const text = optionalString(body.text ?? body.description, 'Description', 10000);
  const image = optionalString(body.image ?? body.imageUrl, 'Image URL', 2048);

  if (!community || !/^[A-Za-z0-9_]{2,40}$/.test(community)) {
    throw new HttpError(400, 'Choose a valid community.');
  }
  if (!title) throw new HttpError(400, 'Post title is required.');
  if (image && !/^https:\/\//i.test(image)) {
    throw new HttpError(400, 'Image URL must use HTTPS.');
  }

  return { community, title, text, image };
}

export function validatePostUpdate(body = {}) {
  const hasCommunity = Object.hasOwn(body, 'community');
  const hasTitle = Object.hasOwn(body, 'title');
  const hasText = Object.hasOwn(body, 'text') || Object.hasOwn(body, 'description');
  const hasImage = Object.hasOwn(body, 'image') || Object.hasOwn(body, 'imageUrl');

  if (!hasCommunity && !hasTitle && !hasText && !hasImage) {
    throw new HttpError(400, 'Provide a post field to update.');
  }

  const update = {};
  if (hasCommunity) {
    const community = optionalString(body.community, 'Community', 40);
    if (!community || !/^[A-Za-z0-9_]{2,40}$/.test(community)) {
      throw new HttpError(400, 'Choose a valid community.');
    }
    update.community = community;
  }
  if (hasTitle) {
    const title = optionalString(body.title, 'Title', 300);
    if (!title) throw new HttpError(400, 'Post title is required.');
    update.title = title;
  }
  if (hasText) {
    update.text = optionalString(body.text ?? body.description, 'Description', 10000);
  }
  if (hasImage) {
    const image = optionalString(body.image ?? body.imageUrl, 'Image URL', 2048);
    if (image && !/^https:\/\//i.test(image)) {
      throw new HttpError(400, 'Image URL must use HTTPS.');
    }
    update.image = image;
  }
  return update;
}

export function validateVote(body = {}) {
  if (![0, 1, -1].includes(body.vote)) {
    throw new HttpError(400, 'Vote must be -1, 0, or 1.');
  }
  return body.vote;
}
