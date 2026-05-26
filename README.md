# Modern Web Application Backend API

This repository contains the Express authentication API for the frontend
application. It replaces PHP authentication endpoints with a JSON API intended
for Railway deployment and a PostgreSQL database.

This document is the integration contract for frontend work.

## What The API Does

The API provides:

- User registration.
- Login with either username or email.
- Cookie-based authenticated session restoration after a page reload.
- Logout and server-side session invalidation.
- Public user profiles and public activity reads.
- Authenticated access to the current user's saved-items tab.
- Home feed retrieval with `best`, `hot`, `new`, `top`, and `rising` sorting.
- Persisted low-level post writing, voting, and saving.
- Username and post-title search.
- Community joining and member-only realtime community chat.
- Mutual-follow realtime direct chat.
- Notifications and signed-in username editing.
- A database health check for deployment verification.

Passwords are hashed on the server with bcrypt. Authentication uses an
`HttpOnly` session cookie, so frontend code never reads or stores the raw
session token. The database stores only a SHA-256 hash of that token.

## Frontend Integration Summary

Set the frontend's public API configuration to the deployed backend:

```text
VITE_API_BASE_URL=https://<railway-api-domain>/api
```

For local development:

```text
VITE_API_BASE_URL=http://localhost:3000/api
```

All frontend authentication requests must include credentials:

```js
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api';

const response = await fetch(`${API_BASE_URL}/auth/session`, {
  credentials: 'include',
});
```

## Local Frontend Against Deployed API

Use this workflow when the backend runs on Railway and the Vite frontend
stays on `http://localhost:5173`.

### Recommended: Vite Dev Proxy

Proxy API and Socket.IO through the Vite dev server so the browser treats
requests as same-origin. This avoids cross-site cookie restrictions.

`vite.config.js`:

```js
export default defineConfig({
  server: {
    proxy: {
      '/api': {
        target: 'https://<railway-api-domain>',
        changeOrigin: true,
        secure: true,
      },
      '/socket.io': {
        target: 'https://<railway-api-domain>',
        changeOrigin: true,
        ws: true,
        secure: true,
      },
    },
  },
});
```

Frontend `.env.local`:

```text
VITE_API_BASE_URL=/api
```

Keep `credentials: 'include'` on fetch calls and `withCredentials: true` on
Socket.IO. Connect Socket.IO to the Vite origin (for example `io()` with no
remote URL), not directly to the Railway host.

Railway still needs `FRONTEND_ORIGIN=http://localhost:5173` for proxied
WebSocket handshakes. Do not copy `COOKIE_SAME_SITE=lax` from `.env.example`
into Railway; hosted deploys should use `none` and `Secure` (the default when
Railway variables are present).

### Alternative: Call Railway Directly

Point the frontend at the deployed API:

```text
VITE_API_BASE_URL=https://<railway-api-domain>/api
```

Railway variables:

```text
FRONTEND_ORIGIN=https://<production-frontend>,http://localhost:5173
COOKIE_SECURE=true
COOKIE_SAME_SITE=none
```

Do not set `COOKIE_SAME_SITE=lax` or `COOKIE_SECURE=false` on Railway. Those
values prevent the browser from sending the session cookie from localhost to
the deployed API.

Verify in DevTools:

1. `POST .../api/auth/login` returns `200` and `Set-Cookie: reddit_session=...`.
2. The next `GET .../api/auth/session` includes `Cookie: reddit_session=...`.
3. `401` on `/api/auth/session` before login, or after logout, is normal.

Use clean Express routes only. Do not call any former `.php` routes.

```text
POST /api/auth/register
POST /api/auth/login
GET  /api/auth/session
POST /api/auth/logout
GET  /api/profiles/:username
GET  /api/profiles/:username/activity?type=overview&limit=20&cursor=<cursor>
GET  /api/me/saved?limit=20&cursor=<cursor>
GET  /api/posts?sort=best&limit=20&cursor=<cursor>
POST /api/posts
GET  /api/posts/:postId
PATCH /api/posts/:postId
DELETE /api/posts/:postId
PUT  /api/posts/:postId/vote
PUT  /api/posts/:postId/saved
DELETE /api/posts/:postId/saved
GET  /api/search?q=<text>&limit=10
GET  /api/communities
POST /api/communities/:name/join
DELETE /api/communities/:name/join
POST /api/profiles/:username/follow
DELETE /api/profiles/:username/follow
GET  /api/chats/communities/:name/messages
GET  /api/chats/users/:username/messages
GET  /api/chats/conversations?limit=30&cursor=<cursor>
POST /api/chats/conversations/:username/read
POST /api/chats/communities/:name/read
PUT  /api/chats/users/:username/messages/:messageId/reaction
DELETE /api/chats/users/:username/messages/:messageId/reaction
PUT  /api/chats/communities/:name/messages/:messageId/reaction
DELETE /api/chats/communities/:name/messages/:messageId/reaction
GET  /api/notifications
PATCH /api/me/username
GET  /api/health
```

## Response Conventions

Every API response is JSON. A successful response contains:

```json
{ "success": true }
```

or, for endpoints returning the authenticated user:

```json
{
  "success": true,
  "user": {
    "id": 1,
    "username": "sample_user",
    "email": "sample@example.com",
    "joinDate": "2026-05-25T00:00:00.000Z"
  }
}
```

An unsuccessful response contains:

```json
{
  "success": false,
  "error": "A user-facing error message."
}
```

During local backend development only, unexpected `500` responses may also
include a `details` string. The frontend should not depend on `details` or
show it to users.

### User Object

| Field | Type | Description |
| --- | --- | --- |
| `id` | number | Database user identifier. |
| `username` | string | Registered display/login username. |
| `email` | string | Registered email address, stored lowercase. |
| `joinDate` | string | ISO 8601 timestamp for account creation. |

## Authentication And Cookies

Registration and login set the configured session cookie, named
`reddit_session` by default. The cookie is:

- `HttpOnly`, so JavaScript cannot access it.
- Sent for `/` requests.
- Valid for 30 days by default.
- `Secure` and `SameSite=None` in a cross-site production frontend/API setup.

The frontend should store user display state only if needed for immediate UI
rendering. It must treat `GET /api/auth/session` as the authoritative way to
confirm authentication after reload.

For a separately hosted frontend and API:

- Backend must set `FRONTEND_ORIGIN` to the exact frontend origin.
- Backend must use `COOKIE_SECURE=true` and `COOKIE_SAME_SITE=none`.
- Frontend requests must use `credentials: 'include'`.

### Diagnosing `401` In Deployment

A browser console message saying a resource returned `401` is not enough to
identify a backend fault. Inspect the failed request URL and JSON body:

| Request | When `401` Is Expected |
| --- | --- |
| `GET /api/auth/session` | A guest opens the application or a saved session expired. The frontend should clear auth state without showing a fatal error. |
| `GET /api/me/saved` | A user is not logged in but attempts to view Saved. |
| `GET /api/notifications` | A user is not logged in but attempts to load notifications. |
| Socket.IO connection | The chat socket was created without a current login session cookie. Do not connect chat for guest users. |

If `POST /api/auth/login` returns `200` but the immediately following
`GET /api/auth/session`, notifications request, or chat socket fails with
`401`, the browser did not store or send the session cookie. For a frontend
and Railway API on different sites, verify:

```text
FRONTEND_ORIGIN=https://<exact-frontend-domain>
COOKIE_SECURE=true
COOKIE_SAME_SITE=none
```

Railway runtime variables are now detected automatically so deployed session
cookies default to `Secure` and `SameSite=None` even when `NODE_ENV` was not
set. Explicit `COOKIE_*` variables still override those defaults. The
frontend must continue using `credentials: 'include'` for API requests and
`withCredentials: true` for Socket.IO.

## API Endpoints

### Register

Creates a user account, immediately creates a session, and sets the session
cookie.

```http
POST /api/auth/register
Content-Type: application/json
```

Request body:

```json
{
  "username": "sample_user",
  "email": "sample@example.com",
  "password": "Password1"
}
```

Validation rules:

| Field | Rules |
| --- | --- |
| `username` | 3 to 20 letters, numbers, or underscores. |
| `email` | Valid email format, maximum 191 characters; normalized to lowercase. |
| `password` | At least 8 characters, including uppercase, lowercase, and a number. |

Success, `201 Created`:

```json
{
  "success": true,
  "user": {
    "id": 1,
    "username": "sample_user",
    "email": "sample@example.com",
    "joinDate": "2026-05-25T00:00:00.000Z"
  }
}
```

Validation failures, `400 Bad Request`:

```json
{ "success": false, "error": "Enter a valid email address." }
```

```json
{ "success": false, "error": "Username must be 3-20 letters, numbers, or underscores." }
```

```json
{ "success": false, "error": "Password must be 8+ characters with uppercase, lowercase, and a number." }
```

Duplicate account, `409 Conflict`:

```json
{ "success": false, "error": "That username or email is already registered." }
```

Frontend example:

```js
export async function register({ username, email, password }) {
  const response = await fetch(`${API_BASE_URL}/auth/register`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, email, password }),
  });

  return response.json();
}
```

### Login

Authenticates an existing user by username or email, creates a new session,
and sets the session cookie.

```http
POST /api/auth/login
Content-Type: application/json
```

Request body:

```json
{
  "identifier": "sample_user",
  "password": "Password1"
}
```

`identifier` may contain the username or email. Email login is normalized to
lowercase by the API.

Success, `200 OK`:

```json
{
  "success": true,
  "user": {
    "id": 1,
    "username": "sample_user",
    "email": "sample@example.com",
    "joinDate": "2026-05-25T00:00:00.000Z"
  }
}
```

Missing or invalid credentials, `401 Unauthorized`:

```json
{ "success": false, "error": "Invalid username, email, or password." }
```

Frontend example:

```js
export async function login({ identifier, password }) {
  const response = await fetch(`${API_BASE_URL}/auth/login`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password }),
  });

  return response.json();
}
```

### Restore Current Session

Checks the browser's session cookie and returns the authenticated user. Call
this during application startup to restore login state.

```http
GET /api/auth/session
```

Success, `200 OK`:

```json
{
  "success": true,
  "user": {
    "id": 1,
    "username": "sample_user",
    "email": "sample@example.com",
    "joinDate": "2026-05-25T00:00:00.000Z"
  }
}
```

No cookie, expired session, or invalid session, `401 Unauthorized`:

```json
{ "success": false, "error": "Session expired or invalid." }
```

Frontend example:

```js
export async function restoreAuthSession() {
  const response = await fetch(`${API_BASE_URL}/auth/session`, {
    credentials: 'include',
  });

  return response.json();
}
```

### Logout

Invalidates the current session in PostgreSQL and clears the browser cookie.
Logout is safe to call even when no session cookie is present.

```http
POST /api/auth/logout
```

Success, `200 OK`:

```json
{ "success": true }
```

Frontend example:

```js
export async function logout() {
  const response = await fetch(`${API_BASE_URL}/auth/logout`, {
    method: 'POST',
    credentials: 'include',
  });

  return response.json();
}
```

### Health Check

Confirms that the Express API can query PostgreSQL. This route is intended for
deployment checks and service monitoring, not frontend authentication state.

```http
GET /api/health
```

Success, `200 OK`:

```json
{
  "success": true,
  "database": "connected",
  "databaseName": "railway",
  "serverVersion": "PostgreSQL ..."
}
```

## Public Profile API

Profile routes support the public `/profile/:username` page. They never return
registration email, session data, or private account information. The
frontend should still include credentials so the response can identify whether
the current viewer owns the displayed profile.

### Get Public Profile

```http
GET /api/profiles/sample_user
```

Success, `200 OK`:

```json
{
  "success": true,
  "profile": {
    "username": "sample_user",
    "displayName": null,
    "bio": null,
    "avatarUrl": null,
    "bannerColor": null,
    "postKarma": 0,
    "commentKarma": 0,
    "followers": 0,
    "cakeDay": "2026-05-25T00:00:00.000Z",
    "communities": []
  },
  "viewer": {
    "isAuthenticated": false,
    "isSelf": false,
    "isFollowing": false,
    "canMessage": false
  }
}
```

`username` is resolved case-insensitively and returned in its registered
canonical form. The optional public profile fields are sourced from
`user_profiles`:

| Field | Type | Rules |
| --- | --- | --- |
| `displayName` | string or `null` | Maximum 50 characters. |
| `bio` | string or `null` | Maximum 200 characters. |
| `avatarUrl` | string or `null` | Stored only as an HTTPS URL. |
| `bannerColor` | string or `null` | Hex color in `#RRGGBB` form. |

`postKarma` is currently calculated from the signed-in user's public post
scores. `followers` is counted from follows, and `communities` contains up to
five joined communities. There is not yet a comment-writing API, so
`commentKarma` currently returns `0`.

When a valid session cookie is included, `viewer.isAuthenticated` is `true`,
`viewer.isSelf` identifies the signed-in user's own profile,
`viewer.isFollowing` reflects the current user's follow record, and
`viewer.canMessage` is `true` only when viewing another user. A direct chat
still requires both users to follow each other.

Unknown username, `404 Not Found`:

```json
{ "success": false, "error": "Profile not found." }
```

Frontend example:

```js
export async function getPublicProfile(username) {
  const response = await fetch(`${API_BASE_URL}/profiles/${encodeURIComponent(username)}`, {
    credentials: 'include',
  });

  return response.json();
}
```

### Get Public Activity

```http
GET /api/profiles/sample_user/activity?type=overview&limit=20
```

Accepted query parameters:

| Parameter | Accepted Values | Default |
| --- | --- | --- |
| `type` | `overview`, `posts`, `comments` | `overview` |
| `limit` | Integer from `1` to `50` | `20` |
| `cursor` | Non-empty opaque string from a preceding response | none |

`posts` and `overview` return the user's persisted public posts. There is not
yet a comment-writing API, so `comments` currently returns an empty list.

An empty response has this shape:

```json
{
  "success": true,
  "items": [],
  "nextCursor": null
}
```

The result shape is ready for future `post` and `comment` items without
changing frontend pagination. A request for `type=saved` is never public:

```json
{ "success": false, "error": "Saved activity is private." }
```

This response uses `400 Bad Request`. Unknown profile usernames return the
same `404` profile-not-found response as the profile endpoint.

### Get Own Saved Items

```http
GET /api/me/saved?limit=20&cursor=<cursor>
```

This endpoint requires a valid signed-in session and uses the same pagination
shape as public activity. It returns posts persisted through the save endpoint.
When there are no saved posts, the response is:

```json
{
  "success": true,
  "items": [],
  "nextCursor": null
}
```

No valid session, `401 Unauthorized`:

```json
{ "success": false, "error": "You must be logged in to view saved posts." }
```

Frontend example:

```js
export async function getSavedItems({ limit = 20, cursor } = {}) {
  const params = new URLSearchParams({ limit: String(limit) });
  if (cursor) params.set('cursor', cursor);

  const response = await fetch(`${API_BASE_URL}/me/saved?${params}`, {
    credentials: 'include',
  });

  return response.json();
}
```

## Home Feed And Posts API

### Feed

The home page loads persisted public posts through:

```http
GET /api/posts?sort=best&limit=20&cursor=<opaque-cursor>
```

`sort` accepts `best`, `hot`, `new`, `top`, and `rising`. The default is
`best`. `limit` defaults to `20` and is restricted to `1` through `50`.

Successful response, `200 OK`:

```json
{
  "success": true,
  "posts": [
    {
      "id": 1,
      "community": "technology",
      "communityColor": "#A855F7",
      "author": "tech_guru",
      "createdAt": "2026-05-25T03:15:00.000Z",
      "flair": null,
      "flairColor": null,
      "title": "New breakthrough in quantum computing announced today",
      "image": "https://images.example/post.jpg",
      "text": "Description supplied by the author.",
      "link": null,
      "linkDomain": null,
      "votes": 0,
      "comments": 0,
      "reactions": 0,
      "userVote": 0,
      "saved": false
    }
  ],
  "nextCursor": null
}
```

The backend returns `createdAt`, not text such as `"5 hours ago"`; the
frontend formats relative display time. `userVote` and `saved` are populated
for a valid included session cookie and use default values for anonymous
visitors. `votes` is a net score and may be negative.

### Create Post

The initial post writer supports a title, one HTTPS image URL, and text
description. A community is required so the post can be displayed in the
feed. The user must be logged in.

```http
POST /api/posts
Content-Type: application/json
```

```json
{
  "community": "technology",
  "title": "New breakthrough in quantum computing announced today",
  "image": "https://images.example/post.jpg",
  "description": "A closer look at what this change means."
}
```

Success, `201 Created`:

```json
{
  "success": true,
  "post": {
    "id": 1,
    "community": "technology",
    "author": "tech_guru",
    "title": "New breakthrough in quantum computing announced today",
    "image": "https://images.example/post.jpg",
    "text": "A closer look at what this change means.",
    "votes": 0,
    "comments": 0,
    "reactions": 0,
    "userVote": 0,
    "saved": false
  }
}
```

Creating a post also inserts a `post_created` notification for the author.
Only HTTPS image URLs are accepted. Link posts, comments, and reactions are
reserved for later endpoints.

### Edit Or Delete Own Post

Only the authenticated author of a public post can edit or delete it. Requests
by another user return `404` so the API does not disclose private ownership
details. The frontend should show edit and delete controls only when the
signed-in session username matches the post `author`; the backend still
performs the authoritative ownership check.

Update one or more editable fields:

```http
PATCH /api/posts/:postId
Content-Type: application/json
```

```json
{
  "title": "Updated title",
  "description": "Updated description.",
  "image": "https://images.example/updated-post.jpg",
  "community": "technology"
}
```

The editable fields are `title`, `description`/`text`, `image`/`imageUrl`,
and `community`. Use `null` for `description` or `image` to remove it. Fields
not supplied are retained. Success, `200 OK`, returns the same complete post
object shape returned by the feed and post-detail endpoint:

```json
{
  "success": true,
  "post": {
    "id": 1,
    "community": "technology",
    "communityColor": "#A855F7",
    "author": "tech_guru",
    "createdAt": "2026-05-25T03:15:00.000Z",
    "flair": null,
    "flairColor": null,
    "title": "Updated title",
    "image": "https://images.example/updated-post.jpg",
    "text": "Updated description.",
    "link": null,
    "linkDomain": null,
    "votes": 0,
    "comments": 0,
    "reactions": 0,
    "userVote": 0,
    "saved": false
  }
}
```

Delete a post:

```http
DELETE /api/posts/:postId
```

Success, `200 OK`:

```json
{ "success": true }
```

Deletion is soft deletion: the post is marked deleted and no longer appears
in public feed, post detail, search, profile activity, or saved-item results.

Mutation errors:

```http
401 Unauthorized
{ "success": false, "error": "Session expired or invalid." }

404 Not Found
{ "success": false, "error": "Post not found." }
```

`404` is returned when the post is absent, already deleted, or belongs to
another user. Validation errors such as a missing update field or a non-HTTPS
image URL return `400` with a user-facing `error` message.

### Post Viewer Actions

```http
GET    /api/posts/:postId
PUT    /api/posts/:postId/vote
PUT    /api/posts/:postId/saved
DELETE /api/posts/:postId/saved
```

Voting and saving require authentication. Vote body:

```json
{ "vote": 1 }
```

Values are `1` for upvote, `-1` for downvote, and `0` to remove the current
vote. Each success returns `{ "success": true, "post": <post-object> }`.

## Search API

The home search matches canonical usernames and public post titles:

```http
GET /api/search?q=tech&limit=10
```

`q` is required and must be 2 to 100 characters. `limit` defaults to `10` and
has a maximum of `20`.

```json
{
  "success": true,
  "query": "tech",
  "users": [{ "username": "tech_guru" }],
  "posts": []
}
```

## Communities API

The backend seeds these communities for the current frontend:

```text
r/technology
r/programming
r/worldnews
r/science
r/artificial
r/personalfinance
r/MachineLearning
r/datascience
```

The four explicitly requested community cards are `artificial`,
`personalfinance`, `MachineLearning`, and `datascience`.

List communities:

```http
GET /api/communities
```

```json
{
  "success": true,
  "communities": [
    {
      "name": "artificial",
      "color": "#8B5CF6",
      "avatarUrl": null,
      "memberCount": 0,
      "joined": false
    }
  ]
}
```

Join or leave, authenticated:

```http
POST   /api/communities/artificial/join
DELETE /api/communities/artificial/join
```

Only a joined user is authorized to load or send messages in that community's
chat.

## Follows And Chat API

### Follow Gating

Direct chat is enabled only once both users follow one another:

```http
POST   /api/profiles/:username/follow
DELETE /api/profiles/:username/follow
```

Success response:

```json
{
  "success": true,
  "viewer": {
    "username": "other_user",
    "isFollowing": true
  }
}
```

### Inbox Conversations

The Inbox page discovers eligible direct conversations using:

```http
GET /api/chats/conversations?limit=30&cursor=<opaque-cursor>
```

This route requires authentication and returns only mutual follows. A
conversation appears immediately when mutual follow authorization exists,
even if no messages have been sent.

```json
{
  "success": true,
  "conversations": [
    {
      "username": "other_user",
      "displayName": "Other User",
      "avatarUrl": null,
      "lastMessage": {
        "id": 12,
        "sender": "other_user",
        "body": "See you there.",
        "createdAt": "2026-05-26T01:20:00.000Z"
      },
      "unreadCount": 1
    },
    {
      "username": "new_mutual",
      "displayName": null,
      "avatarUrl": null,
      "lastMessage": null,
      "unreadCount": 0
    }
  ],
  "nextCursor": null
}
```

Conversations sort by latest message descending; mutual follows with no
messages appear after messaged conversations. When signed out:

```json
{ "success": false, "error": "You must be logged in to view messages." }
```

An open Socket.IO connection receives:

```text
direct:conversation  { "conversation": <conversation-object> }
```

The server emits this after a direct message updates a preview, after a read
operation changes unread state through Socket.IO, and when a follow action
creates mutual authorization.

### Message History

Both message-history endpoints require authentication and return stored
messages in display order:

```http
GET /api/chats/communities/:name/messages?limit=20&cursor=<cursor>
GET /api/chats/users/:username/messages?limit=20&cursor=<cursor>
```

Community history returns `403` unless the requester has joined the community.
Direct history returns `403` unless the two users mutually follow.

```json
{
  "success": true,
  "community": "artificial",
  "messages": [
    {
      "id": 1,
      "sender": "sample_user",
      "body": "Hello everyone.",
      "createdAt": "2026-05-25T03:15:00.000Z"
    }
  ],
  "nextCursor": null
}
```

For direct messages, the response replaces `community` with
`"with": "other_user"`.

Messages returned from chat history and new-message socket events include
message state:

```json
{
  "id": 12,
  "sender": "other_user",
  "body": "See you there.",
  "createdAt": "2026-05-26T01:20:00.000Z",
  "seen": true,
  "seenAt": "2026-05-26T01:21:00.000Z",
  "reactions": [
    { "reaction": "love", "count": 2 }
  ],
  "viewerReaction": "love"
}
```

For community messages, `seenAt` is replaced by `seenByCount`, the number of
other members who have marked that message read.

### Seen And Unread State

When the user opens a visible direct conversation, mark incoming messages as
read through REST:

```http
POST /api/chats/conversations/:username/read
```

For a community room:

```http
POST /api/chats/communities/:name/read
```

Example response:

```json
{
  "success": true,
  "with": "other_user",
  "messageIds": [12, 13],
  "readAt": "2026-05-26T01:21:00.000Z"
}
```

For immediate sender-side seen indicators while both users are online, emit
the equivalent Socket.IO events documented below. Direct-message unread
counts in `/api/chats/conversations` are derived from persisted `read_at`.

### Message Reactions

Each user may choose at most one reaction per message. Setting a different
reaction replaces their current selection; deleting it removes their
selection. The server accepts exactly these five reaction identifiers:

```text
like
love
laugh
surprised
sad
```

The frontend chooses the matching icon presentation. Any other reaction is
rejected with `400`.

REST routes:

```http
PUT    /api/chats/users/:username/messages/:messageId/reaction
DELETE /api/chats/users/:username/messages/:messageId/reaction
PUT    /api/chats/communities/:name/messages/:messageId/reaction
DELETE /api/chats/communities/:name/messages/:messageId/reaction
```

Set request body:

```json
{ "reaction": "love" }
```

Success:

```json
{
  "success": true,
  "messageId": 12,
  "reactions": [{ "reaction": "love", "count": 2 }],
  "viewerReaction": "love"
}
```

### Socket.IO Realtime Messages

Connect Socket.IO to the same backend host with the session cookie included:

```js
import { io } from 'socket.io-client';

const socket = io(API_ORIGIN, { withCredentials: true });
```

The socket handshake requires a valid login cookie.

Community events:

| Direction | Event | Payload |
| --- | --- | --- |
| client -> server | `community:join` | `{ "community": "artificial" }` |
| client -> server | `community:leave` | `{ "community": "artificial" }` |
| client -> server | `community:message:send` | `{ "community": "artificial", "body": "Hello" }` |
| server -> client | `community:message` | `{ "community": "artificial", "message": { ... } }` |
| client -> server | `community:typing` | `{ "community": "artificial", "isTyping": true }` |
| server -> room | `community:typing` | `{ "community": "artificial", "username": "sample_user", "isTyping": true }` |
| client -> server | `community:read` | `{ "community": "artificial" }` |
| server -> room | `community:read` | `{ "community": "artificial", "messageIds": [1], "readAt": "...", "username": "sample_user" }` |
| client -> server | `community:reaction:set` | `{ "community": "artificial", "messageId": 1, "reaction": "love" }` |
| client -> server | `community:reaction:remove` | `{ "community": "artificial", "messageId": 1 }` |
| server -> room | `community:reaction` | `{ "community": "artificial", "messageId": 1, "reactions": [...], "actor": "sample_user", "actorReaction": "love" }` |

Direct message events:

| Direction | Event | Payload |
| --- | --- | --- |
| client -> server | `direct:join` | `{ "username": "other_user" }` |
| client -> server | `direct:leave` | `{ "username": "other_user" }` |
| client -> server | `direct:message:send` | `{ "username": "other_user", "body": "Hello" }` |
| server -> client | `direct:message` | `{ "with": "other_user", "message": { ... } }` |
| client -> server | `direct:typing` | `{ "username": "other_user", "isTyping": true }` |
| server -> room | `direct:typing` | `{ "with": "other_user", "username": "other_user", "isTyping": true }` |
| client -> server | `direct:read` | `{ "username": "other_user" }` |
| server -> room | `direct:read` | `{ "with": "other_user", "messageIds": [12], "readAt": "...", "by": "other_user" }` |
| client -> server | `direct:reaction:set` | `{ "username": "other_user", "messageId": 12, "reaction": "love" }` |
| client -> server | `direct:reaction:remove` | `{ "username": "other_user", "messageId": 12 }` |
| server -> room | `direct:reaction` | `{ "with": "other_user", "messageId": 12, "reactions": [...], "actor": "other_user", "actorReaction": "love" }` |
| server -> client | `direct:conversation` | `{ "conversation": { ... } }` |

Send/join events accept Socket.IO acknowledgements. A successful
acknowledgement begins with `{ "success": true }`; authorization or validation
failures return `{ "success": false, "error": "..." }`.

The frontend must wait for a successful `community:join` or `direct:join`
acknowledgement before enabling message sending. The backend rejects sends
from sockets that have not joined the corresponding room. When switching away
from an open conversation, emit the corresponding `:leave` event so that old
room broadcasts are no longer shown.

Socket.IO rooms do not survive a disconnect. After every reconnect, the
frontend must emit `community:join` or `direct:join` again for the currently
visible conversation before enabling send.

Community membership is rechecked at send and broadcast time. If a user is no
longer a member after previously joining a socket room, that socket no longer
receives community broadcasts. Direct-message send authorization continues to
require mutual follows.

## Notifications API

The backend creates notifications for:

- `post_created`: the signed-in user publishes a post.
- `new_follower`: another user starts following the signed-in user; this does
  not require a reciprocal follow.
- `mutual_follow`: a second follow completes a reciprocal follow relationship,
  enabling direct chat for both users.

Fetch notification page data with:

```http
GET /api/notifications?limit=20&cursor=<cursor>
```

```json
{
  "success": true,
  "notifications": [
    {
      "id": 1,
      "type": "post_created",
      "message": "Your post has been published.",
      "postId": 1,
      "actor": "sample_user",
      "read": false,
      "createdAt": "2026-05-25T03:15:00.000Z"
    },
    {
      "id": 2,
      "type": "new_follower",
      "message": "u/other_user followed you.",
      "postId": null,
      "actor": "other_user",
      "targetUsername": "other_user",
      "read": false,
      "createdAt": "2026-05-26T10:19:30.000Z"
    },
    {
      "id": 3,
      "type": "mutual_follow",
      "message": "You and u/other_user now follow each other. You can start chatting.",
      "postId": null,
      "actor": "other_user",
      "targetUsername": "other_user",
      "read": false,
      "createdAt": "2026-05-26T10:20:30.000Z"
    }
  ],
  "nextCursor": null
}
```

For `new_follower`, only the followed user receives the notification.
`targetUsername` identifies the new follower; the frontend should use it when
linking to that user's profile:

```text
/profile/<targetUsername>
```

For `mutual_follow`, both users receive one notification. The
`targetUsername` value is the canonical route target for:

```text
/inbox?with=<targetUsername>
```

For notification types without a user target, including `post_created`,
`targetUsername` is `null`.

Repeated follow requests while an existing follow is active do not generate
duplicate `new_follower` or `mutual_follow` notifications. If a user
unfollows, notifications belonging to that active relationship are removed;
following again creates fresh applicable notifications.

Connected authenticated clients also receive:

```text
notification:new  { "notification": <notification-object> }
```

for newly created `new_follower` and `mutual_follow` notifications.
`direct:conversation` is emitted only when `mutual_follow` enables chat.

## Current User Details API

Public posted content is available from:

```http
GET /api/profiles/:username/activity?type=posts
```

The signed-in user can change their username, subject to the same registration
format and case-insensitive uniqueness rules:

```http
PATCH /api/me/username
Content-Type: application/json

{ "username": "updated_name" }
```

Success:

```json
{ "success": true, "user": { "username": "updated_name" } }
```

Conflict, `409`:

```json
{ "success": false, "error": "That username is already registered." }
```

## Database Model

| Table | Purpose |
| --- | --- |
| `users`, `auth_sessions` | Existing authentication identity and hashed cookie sessions. |
| `user_profiles` | Optional public display fields. |
| `communities` | Public community metadata and seeded community names. |
| `community_memberships` | Join records; authorization source for community chat. |
| `posts` | Public post title, description, image URL, community, author, counts, visibility, and time. |
| `post_votes`, `saved_posts` | Per-viewer home/profile state. |
| `user_follows` | Follow records; reciprocal rows authorize direct chat. |
| `community_messages` | Member-only persisted community messages. |
| `community_message_reads` | Per-member community seen state. |
| `community_message_reactions` | Per-member reactions restricted to five supported values. |
| `direct_messages` | Persisted messages between mutually-following users, including recipient `read_at`. |
| `direct_message_reactions` | Per-user direct-message reactions restricted to five supported values. |
| `notifications` | Notification page items, including post-created, new-follower, and mutual-follow chat-available events; `related_user_id` identifies the related user when applicable. |

## General Error Responses

Invalid JSON request body, `400 Bad Request`:

```json
{ "success": false, "error": "Request body must be valid JSON." }
```

Unknown endpoint, `404 Not Found`:

```json
{ "success": false, "error": "Endpoint not found." }
```

Unexpected backend/database failure, `500 Internal Server Error`:

```json
{ "success": false, "error": "Authentication service failed." }
```

Frontend behavior should use `error` for user-visible failures and should not
assume unsuccessful requests throw automatically: `fetch()` resolves normally
for HTTP `400`, `401`, `409`, and `500`.

## Suggested Frontend Auth Flow

1. On app startup, call `GET /api/auth/session` with credentials included.
2. If it returns `success: true`, store the returned `user` in reactive UI
   state.
3. If it returns `401`, clear local UI auth state and show the guest state.
4. After registration or login success, immediately store the returned `user`
   in UI state; the session cookie has already been set by the browser.
5. On logout success, clear all locally stored/current user state.
6. Never store passwords or try to read the session cookie from JavaScript.
7. Use the returned `createdAt` timestamps for relative-time formatting.
8. Join community chat rooms or direct chat rooms through Socket.IO only after
   the matching REST authorization state exists.

## Backend Development Setup

Requires Node.js 20 or later.

```bash
npm install
cp .env.example .env
npm run db:migrate
npm run dev
```

Set `DATABASE_URL` only in backend environment variables or the ignored local
`.env` file. Never expose it through a `VITE_*` variable or commit it.

Available commands:

```bash
npm test            # Run endpoint contract tests
npm run db:migrate  # Create PostgreSQL users/session tables
npm start           # Start the HTTP server
```

## Railway Deployment Configuration

Relevant backend environment variables:

| Variable | Example / Purpose |
| --- | --- |
| `NODE_ENV` | `production` |
| `DATABASE_URL` | Private PostgreSQL connection string. Never expose to frontend code. |
| `FRONTEND_ORIGIN` | `https://your-frontend.example` |
| `COOKIE_SECURE` | `true` for HTTPS deployment. This is the Railway default unless overridden. |
| `COOKIE_SAME_SITE` | `none` when frontend and API are on separate sites. This is the Railway default unless overridden. |
| `SESSION_COOKIE_NAME` | Optional; default `reddit_session`. |
| `SESSION_TTL_SECONDS` | Optional; default `2592000` (30 days). |
| `PROFILE_READ_RATE_LIMIT` | Optional; default `120` public/profile reads per window. |
| `PROFILE_READ_RATE_WINDOW_SECONDS` | Optional; default `60`. |
| `PORT` | Supplied by Railway. |

Run `npm run db:migrate` against the Railway PostgreSQL database before the
frontend begins using registration or login.
