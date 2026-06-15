# Modern Web Application Backend

A production-ready REST API and real-time WebSocket backend for a Reddit-style social platform. Built with Node.js, Express, PostgreSQL, and Socket.IO — featuring authentication, communities, posts, social graph, direct messaging, community chat, and a recommendation event pipeline.

## Table of Contents

- [Features](#features)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Installation](#installation)
  - [Environment Variables](#environment-variables)
  - [Database Setup](#database-setup)
  - [Running the Server](#running-the-server)
- [API Reference](#api-reference)
  - [Health](#health)
  - [Authentication](#authentication)
  - [Posts](#posts)
  - [Search](#search)
  - [Communities](#communities)
  - [Profiles](#profiles)
  - [Social](#social)
  - [Chat (REST)](#chat-rest)
  - [Recommendations](#recommendations)
- [Real-Time Events (Socket.IO)](#real-time-events-socketio)
  - [Authentication](#socket-authentication)
  - [Client → Server Events](#client--server-events)
  - [Server → Client Events](#server--client-events)
- [Database Schema](#database-schema)
- [Security](#security)
- [Deployment](#deployment)
- [Testing](#testing)
- [License](#license)

---

## Features

- **Authentication** — Cookie-based sessions with bcrypt password hashing and SHA-256 token storage
- **Posts** — Create, read, update, delete posts with upvote/downvote voting, save/unsave, and cursor-based pagination
- **Communities** — Browse, join, and leave topic-based communities
- **Search** — Full-text post search
- **Social Graph** — Follow/unfollow users, mutual-follow detection, real-time notifications
- **User Profiles** — Public profiles with karma, followers, community memberships, activity feed, and customisable avatars with crop data
- **Direct Messaging** — Private messages between mutual followers with read receipts, emoji reactions, and typing indicators
- **Community Chat** — Real-time group chat per community with membership enforcement, read receipts, reactions, and typing indicators
- **Notifications** — Real-time push of follow and mutual-follow events over WebSocket
- **Recommendation Pipeline** — Record view, upvote, and search events; retrieve per-user history for front-end personalisation
- **Rate Limiting** — Per-window request caps on read-heavy endpoints
- **Graceful Shutdown** — SIGINT/SIGTERM handlers close the Socket.IO server, HTTP server, and database pool cleanly

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js ≥ 20 (ES Modules) |
| Web framework | Express 5 |
| Database | PostgreSQL (via `pg` connection pool) |
| Real-time | Socket.IO 4 |
| Password hashing | bcryptjs |
| Security headers | Helmet |
| CORS | cors |
| Rate limiting | express-rate-limit |
| Cookie parsing | cookie-parser |
| Config | dotenv |
| Testing | Node.js built-in test runner + supertest |

---

## Project Structure

```
├── migrations/          # Ordered SQL migration files
│   ├── 001_auth_schema.sql
│   ├── 002_profile_schema.sql
│   ├── 003_social_content_chat_schema.sql
│   ├── 004_allow_negative_post_scores.sql
│   ├── 005_inbox_message_state_reactions.sql
│   ├── 006_mutual_follow_notifications.sql
│   ├── 007_recommendation_events.sql
│   └── 008_profile_avatar_crop.sql
├── scripts/
│   └── migrate.js       # Runs all pending migrations in order
├── src/
│   ├── app.js           # Express app factory (dependency injection)
│   ├── server.js        # HTTP server + Socket.IO bootstrap + graceful shutdown
│   ├── config.js        # Environment variable parsing and validation
│   ├── db.js            # PostgreSQL pool wrapper with transaction helper
│   ├── errors.js        # HttpError class
│   ├── health.service.js
│   ├── auth/            # Registration, login, session, logout
│   ├── chat/            # Direct & community messaging (REST + Socket.IO)
│   ├── community/       # Community CRUD and membership
│   ├── content/         # Posts, voting, saving, search
│   ├── http/            # Shared helpers: pagination, request auth
│   ├── profile/         # Public profiles, activity feed, avatar, saved posts
│   ├── recommendations/ # Behaviour event recording and history
│   └── social/          # Follow graph, notifications, username update
└── test/
    ├── app.test.js      # REST API integration tests
    └── socket.test.js   # Socket.IO integration tests
```

Each feature module follows the same three-file pattern:

```
<feature>/
  <feature>.routes.js     # Express Router — input parsing, calls service
  <feature>.service.js    # Business logic and SQL queries
  <feature>.validation.js # Input validation helpers (where applicable)
```

---

## Getting Started

### Prerequisites

- **Node.js** ≥ 20.0.0
- **PostgreSQL** ≥ 14 (local or hosted, e.g. Railway, Supabase, Neon)

### Installation

```bash
git clone <repository-url>
cd modern-web-application-backend
npm install
```

### Environment Variables

Copy the example file and fill in your values:

```bash
cp .env.example .env
```

| Variable | Description | Default |
|---|---|---|
| `NODE_ENV` | `development` or `production` | `development` |
| `PORT` | Port the HTTP server listens on | `3000` |
| `DATABASE_URL` | PostgreSQL connection string | — |
| `DATABASE_SSL` | Enable SSL for the DB connection | `false` (auto `true` in production) |
| `DATABASE_SSL_REJECT_UNAUTHORIZED` | Reject unauthorised SSL certificates | `true` |
| `FRONTEND_ORIGIN` | Comma-separated list of allowed CORS origins | — |
| `SESSION_COOKIE_NAME` | Name of the session cookie | `reddit_session` |
| `SESSION_TTL_SECONDS` | Session lifetime in seconds | `2592000` (30 days) |
| `COOKIE_SECURE` | Set the `Secure` cookie flag | `false` (auto `true` when hosted) |
| `COOKIE_SAME_SITE` | Cookie `SameSite` attribute (`lax`, `strict`, `none`) | `lax` (auto `none` when hosted) |
| `PROFILE_READ_RATE_LIMIT` | Max requests per window on read endpoints | `120` |
| `PROFILE_READ_RATE_WINDOW_SECONDS` | Rate-limit window duration in seconds | `60` |

> **Railway users:** `RAILWAY_*` variables are injected automatically. Only `FRONTEND_ORIGIN` and `DATABASE_URL` need to be set manually.

### Database Setup

Run all migrations to create the schema and seed the default communities:

```bash
npm run db:migrate
```

Migrations are idempotent (`CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, `ALTER TABLE … ADD COLUMN IF NOT EXISTS`) and safe to re-run.

### Running the Server

```bash
# Development — restarts on file changes
npm run dev

# Production
npm start
```

The server prints its port and the allowed CORS origins on startup:

```
API listening on port 3000.
Allowed origins: http://localhost:5173
```

---

## API Reference

All endpoints are prefixed with `/api`. Responses always include a `success` boolean. Error responses include an `error` string. Paginated responses include a `nextCursor` value (pass as the `cursor` query parameter for the next page).

### Health

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/api/health` | None | Database connectivity check |

**Response**
```json
{
  "success": true,
  "database": "connected",
  "databaseName": "mydb",
  "serverVersion": "PostgreSQL 16.2 ..."
}
```

---

### Authentication

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/api/auth/register` | None | Create a new account |
| `POST` | `/api/auth/login` | None | Log in with username/email and password |
| `GET` | `/api/auth/session` | Cookie | Validate the current session |
| `POST` | `/api/auth/logout` | Cookie | Destroy the session |

Sessions are issued as `httpOnly` cookies. The cookie name is configurable via `SESSION_COOKIE_NAME`.

**Register / Login body**
```json
{ "username": "alice", "email": "alice@example.com", "password": "s3cret" }
```
```json
{ "identifier": "alice", "password": "s3cret" }
```

**User object** (returned on register, login, session)
```json
{
  "id": 1,
  "username": "alice",
  "email": "alice@example.com",
  "joinDate": "2025-05-25T12:00:00.000Z"
}
```

---

### Posts

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/api/posts` | Optional | List posts (sortable, paginated) |
| `POST` | `/api/posts` | Required | Create a post |
| `GET` | `/api/posts/:postId` | Optional | Get a single post |
| `PATCH` | `/api/posts/:postId` | Required | Update a post (author only) |
| `DELETE` | `/api/posts/:postId` | Required | Delete a post (author only) |
| `PUT` | `/api/posts/:postId/vote` | Required | Upvote or downvote a post |
| `PUT` | `/api/posts/:postId/saved` | Required | Save a post |
| `DELETE` | `/api/posts/:postId/saved` | Required | Unsave a post |

**Query parameters for `GET /api/posts`**

| Param | Values | Default | Description |
|---|---|---|---|
| `sort` | `new`, `top`, `hot` | `new` | Feed sort order |
| `limit` | integer | `25` | Number of posts per page |
| `cursor` | string | — | Pagination cursor from previous response |

**Vote body**
```json
{ "vote": 1 }
```
Use `1` for upvote, `-1` for downvote, or `0` to remove a vote.

---

### Search

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/api/search?q=<query>` | None | Search posts by title (2–100 characters) |

---

### Communities

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/api/communities` | Optional | List all communities |
| `POST` | `/api/communities/:name/join` | Required | Join a community |
| `DELETE` | `/api/communities/:name/join` | Required | Leave a community |

The default communities seeded by the migrations are: `technology`, `programming`, `worldnews`, `science`, `artificial`, `personalfinance`, `MachineLearning`, `datascience`.

---

### Profiles

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/api/profiles/:username` | Optional | Get a user's public profile |
| `GET` | `/api/profiles/:username/activity` | None | Get a user's post activity feed |
| `GET` | `/api/me/saved` | Required | Get the current user's saved posts |
| `GET` | `/api/me/avatar` | Required | Get the current user's avatar data |
| `PATCH` | `/api/me/avatar` | Required | Update avatar URL and crop data |

**Avatar body**
```json
{
  "avatarUrl": "https://cdn.example.com/avatars/alice.jpg",
  "originalUrl": "https://cdn.example.com/avatars/alice-original.jpg",
  "crop": { "x": 0, "y": 0, "width": 200, "height": 200 }
}
```

---

### Social

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/api/profiles/:username/follow` | Required | Follow a user |
| `DELETE` | `/api/profiles/:username/follow` | Required | Unfollow a user |
| `GET` | `/api/notifications` | Required | Get the current user's notifications |
| `PATCH` | `/api/me/username` | Required | Change username |

When two users mutually follow each other, a `mutual_follow` notification is sent to both and direct messaging is unlocked.

---

### Chat (REST)

These endpoints provide message history and read-state management. Real-time messaging is handled by Socket.IO (see below).

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/api/chats/conversations` | Required | List direct message conversations |
| `POST` | `/api/chats/conversations/:username/read` | Required | Mark a DM conversation as read |
| `GET` | `/api/chats/users/:username/messages` | Required | Get DM history with a user |
| `PUT` | `/api/chats/users/:username/messages/:messageId/reaction` | Required | Add a reaction to a DM |
| `DELETE` | `/api/chats/users/:username/messages/:messageId/reaction` | Required | Remove a reaction from a DM |
| `GET` | `/api/chats/communities/:name/messages` | Required | Get community chat history |
| `POST` | `/api/chats/communities/:name/read` | Required | Mark community chat as read |
| `PUT` | `/api/chats/communities/:name/messages/:messageId/reaction` | Required | Add a reaction to a community message |
| `DELETE` | `/api/chats/communities/:name/messages/:messageId/reaction` | Required | Remove a reaction from a community message |

**Supported reactions:** `like`, `love`, `laugh`, `surprised`, `sad`

**Reaction body**
```json
{ "reaction": "like" }
```

---

### Recommendations

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/api/recommendations/events` | Required | Record a user behaviour event |
| `GET` | `/api/recommendations/history` | Required | Retrieve the user's event history |

**Event body**

```json
// view or upvote event
{
  "type": "view",
  "postId": 42,
  "community": "technology",
  "flair": "Discussion",
  "title": "Post title here",
  "timestamp": 1716892800000
}

// search event
{
  "type": "search",
  "keyword": "machine learning",
  "timestamp": 1716892800000
}
```

**History response**
```json
{
  "success": true,
  "viewedPosts": [...],
  "upvotedPosts": [...],
  "searchedKeywords": [...]
}
```

---

## Real-Time Events (Socket.IO)

The Socket.IO server shares the same HTTP server and port as the REST API.

### Socket Authentication

The Socket.IO middleware reads the session cookie from the handshake headers and validates it against the database. Connections without a valid session are rejected immediately.

```js
// Client-side example
import { io } from 'socket.io-client';

const socket = io('http://localhost:3000', {
  withCredentials: true, // sends the session cookie
});
```

---

### Client → Server Events

All client events accept an optional acknowledgement callback: `(response) => {}`. On success, `response.success` is `true`; on failure, `response.error` contains the message.

#### Direct Messages

| Event | Payload | Description |
|---|---|---|
| `direct:join` | `{ username }` | Join the DM room with a mutual follower |
| `direct:leave` | `{ username }` | Leave the DM room |
| `direct:message:send` | `{ username, body }` | Send a direct message |
| `direct:typing` | `{ username, isTyping }` | Broadcast typing indicator |
| `direct:read` | `{ username }` | Mark the conversation as read |
| `direct:reaction:set` | `{ username, messageId, reaction }` | Add or update a message reaction |
| `direct:reaction:remove` | `{ username, messageId }` | Remove a message reaction |

> Direct messaging requires both users to follow each other (mutual follow).

#### Community Chat

| Event | Payload | Description |
|---|---|---|
| `community:join` | `{ community }` | Join a community chat room (requires membership) |
| `community:leave` | `{ community }` | Leave a community chat room |
| `community:message:send` | `{ community, body }` | Send a message to a community |
| `community:typing` | `{ community, isTyping }` | Broadcast typing indicator |
| `community:read` | `{ community }` | Mark community chat as read |
| `community:reaction:set` | `{ community, messageId, reaction }` | Add or update a reaction |
| `community:reaction:remove` | `{ community, messageId }` | Remove a reaction |

---

### Server → Client Events

| Event | Payload | Description |
|---|---|---|
| `direct:message` | `{ with, message }` | A new direct message was received |
| `direct:typing` | `{ with, username, isTyping }` | The other user started/stopped typing |
| `direct:read` | `{ with, by, ... }` | The other user read the conversation |
| `direct:reaction` | `{ with, messageId, reactions, actor, actorReaction }` | A reaction was added or removed |
| `direct:conversation` | `{ conversation }` | Updated conversation metadata (e.g. after mutual follow) |
| `community:message` | `{ message, ... }` | A new community message was received |
| `community:typing` | `{ community, username, isTyping }` | A member started/stopped typing |
| `community:read` | `{ community, username, ... }` | A member read the community chat |
| `community:reaction` | `{ community, messageId, reactions, actor, actorReaction }` | A reaction was added or removed |
| `notification:new` | `{ notification }` | A new notification (follow, mutual follow) |

---

## Database Schema

The schema is built incrementally by the migrations in `migrations/`. The final schema includes the following tables:

| Table | Description |
|---|---|
| `users` | Core user accounts (username, email, password_hash) |
| `auth_sessions` | Active session tokens (stored as SHA-256 hashes) |
| `user_profiles` | Extended profile data (display_name, bio, avatar, banner_color, avatar crop) |
| `communities` | Community definitions (name, color, avatar_url) |
| `community_memberships` | Many-to-many: users ↔ communities |
| `posts` | Content posts with title, body, image/link, flair, vote/comment counts |
| `post_votes` | Per-user upvote/downvote records |
| `saved_posts` | Posts bookmarked by users |
| `user_follows` | Follow graph edges (follower_id → followed_id) |
| `notifications` | Follow and mutual-follow notification records |
| `direct_messages` | DM records between pairs of users |
| `direct_message_reactions` | Per-user emoji reactions on direct messages |
| `community_messages` | Chat messages within a community |
| `community_message_reads` | Per-user read receipts for community messages |
| `community_message_reactions` | Per-user emoji reactions on community messages |
| `recommendation_events` | Behaviour events (view, upvote, search) for personalisation |

---

## Security

- **Passwords** hashed with bcrypt (10 rounds)
- **Session tokens** generated with `crypto.randomBytes(32)` and stored only as SHA-256 hashes — the plaintext token is never persisted
- **Cookies** set with `httpOnly: true`, `Secure` in hosted environments, and configurable `SameSite`
- **Security headers** via Helmet (CSP, HSTS, X-Frame-Options, etc.)
- **CORS** restricted to the origins listed in `FRONTEND_ORIGIN`
- **Rate limiting** on all read-heavy endpoints via express-rate-limit
- **SQL injection** prevented through parameterised queries everywhere
- **Request body size** capped at 16 KB
- **Input validation** applied at the route layer before any service call

---

## Deployment

### Railway

This project is Railway-ready. Set the following variables in your Railway service:

```
DATABASE_URL=<auto-provided by Railway PostgreSQL>
FRONTEND_ORIGIN=https://your-frontend.up.railway.app
NODE_ENV=production
```

Railway environment variables (`RAILWAY_*`) are detected automatically. `COOKIE_SECURE` and `DATABASE_SSL` are enabled automatically in production/Railway.

Run the migration step as a Railway pre-deploy command or a one-off job:

```bash
npm run db:migrate
```

### General Production Checklist

- [ ] Set `NODE_ENV=production`
- [ ] Set `DATABASE_URL` and `DATABASE_SSL=true`
- [ ] Set `FRONTEND_ORIGIN` to your exact frontend origin
- [ ] Set `COOKIE_SECURE=true` and `COOKIE_SAME_SITE=none` (for cross-origin cookies)
- [ ] Run `npm run db:migrate` before the first start
- [ ] Run `npm start` (not `npm run dev`)

---

## Testing

The test suite uses Node.js's built-in test runner with `supertest` for HTTP assertions and `socket.io-client` for WebSocket assertions. Tests spin up the full in-process application against a real database.

```bash
# Set DATABASE_URL to a test database first
npm test
```

Test files:

| File | Coverage |
|---|---|
| `test/app.test.js` | REST API endpoints — auth, posts, communities, profiles, social, chat, recommendations |
| `test/socket.test.js` | Socket.IO events — DM and community chat flows, reactions, typing indicators |

---

## License

MIT — see [LICENSE](./LICENSE) for details.
