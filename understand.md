# Understanding The Modern Web Application Backend

This document explains the backend in simple terms, while staying close to what the code actually does. The application is a small Reddit-style social platform backend: users log in, browse and create posts in communities, follow other users, and chat in realtime.

## 1. The Big Picture

The backend has four main jobs:

1. Receive requests from the frontend through an Express REST API.
2. Read and write application data in PostgreSQL.
3. Keep users signed in with secure cookie-based sessions.
4. Send live chat messages through Socket.IO.

The simplest mental model is:

```text
Frontend browser
  |
  | HTTP JSON requests and an HttpOnly session cookie
  v
Express application
  |
  | Route calls the correct service
  v
Service layer
  |
  | SQL queries
  v
PostgreSQL database
```

Chat adds a second path:

```text
Frontend browser
  |
  | Socket.IO event, authenticated using the same cookie
  v
Socket.IO server
  |
  | Check permission, save message, publish to room
  v
Other connected browsers receive the message immediately
```

This backend does not render web pages. It returns JSON for a separate frontend application to display.

## 2. Technology Used

| Technology | Why it is used |
| --- | --- |
| Node.js 20+ | Runs the backend JavaScript code. |
| Express 5 | Provides REST API routes such as `/api/posts`. |
| PostgreSQL through `pg` | Stores users, sessions, posts, follows, and messages. |
| Socket.IO | Provides live community chat and direct messages. |
| `bcryptjs` | Safely hashes and verifies passwords. |
| `cookie-parser` | Reads the browser's session cookie. |
| `cors` | Allows the configured frontend origin to send cookie-authenticated requests. |
| `helmet` | Adds standard security-related HTTP headers. |
| `express-rate-limit` | Restricts repeated read/API requests. |
| Node test runner and Supertest | Test HTTP behavior. |
| `socket.io-client` | Test realtime socket behavior. |

## 3. Project Folder Map

```text
src/
  app.js                         Express app, middleware, and route mounting
  server.js                      Starts HTTP and Socket.IO servers
  config.js                      Reads environment configuration
  db.js                          PostgreSQL connection and transactions
  errors.js                      Shared HTTP error class
  health.service.js              Database health check
  http/
    query.js                     Pagination helpers
    request-auth.js              Optional/required HTTP authentication
  auth/
    auth.routes.js               Register, login, session, logout endpoints
    auth.service.js              User/session database work
    auth.validation.js           Auth request validation
  content/
    post.routes.js               Feed, posts, votes, saving, search endpoints
    post.service.js              Post SQL and feed calculations
    post.validation.js           Post/vote/sort validation
  community/
    community.routes.js          List, join, leave endpoints
    community.service.js         Community membership SQL and authorization
  profile/
    profile.routes.js            Public profiles/activity and private saved items
    profile.service.js           Profile/activity SQL and serialization
    profile.validation.js        Profile query validation
  social/
    social.routes.js             Follow, notifications, username endpoints
    social.service.js            Follow and notification SQL
  chat/
    chat.routes.js               REST message-history endpoints
    chat.service.js              Store/read messages and permission checks
    socket.js                    Live Socket.IO events and rooms

migrations/                      PostgreSQL table definitions and seed data
scripts/migrate.js               Runs every SQL migration file in order
test/app.test.js                 HTTP route/response contract tests
test/socket.test.js              Realtime chat contract tests
README.md                        Frontend/API integration contract
REALTIME_CHAT_BACKEND_HANDOFF.md Historical realtime investigation notes
```

## 4. How The Server Starts

The application starts in `src/server.js`.

```js
const db = createDatabase(config);
const app = createApp({ config, db });
const server = createServer(app);
const io = attachSocketServer(server, { config, authService, chatService });
server.listen(config.port);
```

Step by step:

1. `config.js` reads environment variables such as database URL and frontend origin.
2. `db.js` creates a PostgreSQL connection pool.
3. `app.js` constructs the Express application and REST routes.
4. Node creates an HTTP server around Express.
5. `chat/socket.js` attaches Socket.IO to that same HTTP server.
6. The server begins listening, normally on port `3000` locally.

Socket.IO must be attached to the real HTTP server. If only Express routes were deployed and the Socket.IO server was not started, normal API requests could work but live chat would not work.

When the process receives `SIGINT` or `SIGTERM`, it closes Socket.IO, stops accepting HTTP connections, closes the database pool, and exits.

## 5. Express Application Setup

`src/app.js` is the center of the REST API. It creates services, installs middleware, attaches routers, and formats errors.

### Middleware

The app installs these middleware functions in order:

| Middleware | Purpose |
| --- | --- |
| `helmet()` | Adds safer HTTP response headers. |
| `cors(...)` | Allows browser requests from configured frontend origins with cookies. |
| `express.json({ limit: '16kb' })` | Parses JSON bodies and prevents very large JSON input. |
| `cookieParser()` | Puts cookie values onto `request.cookies`. |

In production, `app.set('trust proxy', 1)` allows secure behavior behind hosting proxies such as Railway.

### Mounted REST Routers

| URL prefix | Router/module | Purpose |
| --- | --- | --- |
| `/api/health` | `HealthService` | Check PostgreSQL availability. |
| `/api/auth` | `auth.routes.js` | Login and sessions. |
| `/api/posts` | `post.routes.js` | Feed and post actions. |
| `/api/search` | `post.routes.js` | Search users and post titles. |
| `/api/communities` | `community.routes.js` | Community list/membership. |
| `/api/profiles` | `profile.routes.js` | Public profiles/activity. |
| `/api/me` | `profile.routes.js` | Private saved-item access. |
| `/api/chats` | `chat.routes.js` | Saved chat history. |
| `/api` | `social.routes.js` | Following, notifications, username edit. |

### Rate Limiting

The variable name is `profileReadLimiter`, but it is mounted on more than profiles:

- All `/api/posts` requests, including writes.
- `/api/search`.
- All `/api/communities` requests, including join and leave.
- `/api/profiles`.
- `/api/me`.
- `/api/chats`.

It is not mounted on authentication, social routes under `/api`, or health.

By default it permits `120` requests per `60` seconds for each affected limiter usage, and replies with:

```json
{ "success": false, "error": "Too many profile requests. Please try again later." }
```

### General Responses And Errors

Success responses generally contain:

```json
{ "success": true }
```

Failures caused deliberately by application rules use `HttpError`:

```js
throw new HttpError(403, 'Join this community before using its chat.');
```

The Express error handler converts this to:

```json
{ "success": false, "error": "Join this community before using its chat." }
```

Invalid JSON bodies return HTTP `400`. Unknown endpoints return HTTP `404`.

Unexpected errors return HTTP `500` with:

```json
{ "success": false, "error": "Authentication service failed." }
```

That message is used for unexpected failures across the whole API, even when the failure is not related to authentication. In development it also adds `details` with the actual error message.

## 6. Configuration

`src/config.js` reads these environment variables:

| Variable | Default | Meaning |
| --- | --- | --- |
| `NODE_ENV` | `development` | Enables production defaults when set to `production`. |
| `PORT` | `3000` | HTTP/Socket.IO listening port. |
| `DATABASE_URL` | required | PostgreSQL connection string. |
| `DATABASE_SSL` | `true` in production | Whether PostgreSQL uses SSL. |
| `DATABASE_SSL_REJECT_UNAUTHORIZED` | `true` | Whether to reject untrusted database TLS certificates. |
| `FRONTEND_ORIGIN` | empty | Comma-separated browser origins allowed by CORS. |
| `SESSION_COOKIE_NAME` | `reddit_session` | Name of login cookie. |
| `SESSION_TTL_SECONDS` | `2592000` | Session length: 30 days by default. |
| `COOKIE_SECURE` | `true` in production | Sends cookie only over HTTPS. |
| `COOKIE_SAME_SITE` | `none` in production, `lax` locally | Cookie cross-site behavior. |
| `PROFILE_READ_RATE_LIMIT` | `120` | Rate limit count. |
| `PROFILE_READ_RATE_WINDOW_SECONDS` | `60` | Rate limit time window. |

For local development, `.env.example` expects a frontend at `http://localhost:5173` and the backend on port `3000`.

For a frontend and API on separate production sites:

```env
NODE_ENV=production
FRONTEND_ORIGIN=https://your-frontend-domain.example
COOKIE_SECURE=true
COOKIE_SAME_SITE=none
```

The frontend must send HTTP requests with `credentials: 'include'` and connect Socket.IO with `withCredentials: true`.

## 7. Database Layer And Migrations

### Database Helper

`src/db.js` exposes three operations:

| Method | Behavior |
| --- | --- |
| `db.query(sql, params)` | Sends one SQL query through the PostgreSQL pool. |
| `db.transaction(operation)` | Runs several queries in `BEGIN` / `COMMIT`, using `ROLLBACK` on failure. |
| `db.close()` | Closes the pool when shutting down or finishing migrations. |

Transactions are used when multiple writes must succeed together, such as creating a user and its initial session, or creating a post and its notification.

### Migration Process

Run:

```bash
npm run db:migrate
```

`scripts/migrate.js` reads every `.sql` file in `migrations/`, sorts them by filename, and executes them in this order:

1. `001_auth_schema.sql`
2. `002_profile_schema.sql`
3. `003_social_content_chat_schema.sql`
4. `004_allow_negative_post_scores.sql`

### Tables And Their Relationships

```text
users
 |-- auth_sessions
 |-- user_profiles
 |-- community_memberships -- communities
 |-- posts ----------------- communities
 |     |-- post_votes
 |     |-- saved_posts
 |     `-- notifications
 |-- user_follows --> users
 |-- community_messages ---- communities
 `-- direct_messages -------> users
```

| Table | Purpose | Important details |
| --- | --- | --- |
| `users` | Account identity | Unique case-insensitive username and email; bcrypt password hash. |
| `auth_sessions` | Login sessions | Stores hashed tokens and expiry timestamps. |
| `user_profiles` | Public optional profile information | Display name, bio, HTTPS avatar, hex banner color. |
| `communities` | Groups where posts/chat happen | Names are unique case-insensitively; eight communities are seeded. |
| `community_memberships` | Which users joined which communities | Used as the permission rule for community chat. |
| `posts` | Feed posts | Community, author, title, body, image, counts, visibility. |
| `post_votes` | One user's current vote per post | Vote can be `1` or `-1`; removal deletes row. |
| `saved_posts` | Posts bookmarked by users | One save record per user/post pair. |
| `user_follows` | One-direction follow relationships | Two reciprocal records are needed for direct chat. |
| `community_messages` | Persisted community-chat messages | Message body length is at most 2000. |
| `direct_messages` | Persisted user-to-user messages | Sender cannot equal recipient. |
| `notifications` | Items displayed in notifications page | Currently created when the author publishes a post. |

`004_allow_negative_post_scores.sql` removes the original constraint that forced `posts.vote_count` to stay non-negative. This allows posts with more downvotes than upvotes.

## 8. Authentication: Register, Login, Session, Logout

Files:

- `src/auth/auth.routes.js`
- `src/auth/auth.validation.js`
- `src/auth/auth.service.js`
- `src/http/request-auth.js`

### Authentication Endpoints

| Method and URL | Authentication | What it does |
| --- | --- | --- |
| `POST /api/auth/register` | Public | Create account, create session, set cookie. |
| `POST /api/auth/login` | Public | Verify credentials, create session, set cookie. |
| `GET /api/auth/session` | Cookie required | Return the signed-in user. |
| `POST /api/auth/logout` | Cookie optional | Delete the current session and clear cookie. |

### Register Flow

Example input:

```json
{
  "username": "sample_user",
  "email": "sample@example.com",
  "password": "Password1"
}
```

Validation rules:

| Input | Rule |
| --- | --- |
| `username` | Trimmed; 3 to 20 letters, digits, or underscores only. |
| `email` | Trimmed and lowercased; valid-looking email; max 191 characters. |
| `password` | At least 8 characters, with uppercase, lowercase, and number. |

What happens after valid input:

1. Password is converted to a bcrypt hash with cost factor `10`.
2. A database transaction inserts the user.
3. The same transaction creates a session token.
4. The API sends the plain session token only to the browser cookie.
5. The response contains public authenticated-user information.

If the username or email already exists, PostgreSQL unique-constraint error `23505` becomes HTTP `409`.

### Login Flow

The frontend supplies `identifier`, which can be a username or email, and a password.

1. The backend looks up `username = identifier` or `email = LOWER(identifier)`.
2. It compares the submitted password with the stored bcrypt hash.
3. Successful login creates a new session.
4. The API places its token into the login cookie.

A bad username, email, or password returns the same message so that an attacker is not told which account exists:

```json
{ "success": false, "error": "Invalid username, email, or password." }
```

### How Sessions Stay Secure

`AuthService.issueSession()` generates a random 32-byte token, represented as hex. The browser receives the original token, but the database stores:

```text
SHA-256(token)
```

The cookie is configured as:

| Cookie property | Why it matters |
| --- | --- |
| `HttpOnly` | Browser JavaScript cannot read it. |
| `Secure` in production | It is sent only through HTTPS. |
| `SameSite=None` in cross-site production setup | It may be sent from the separate frontend site. |
| 30-day maximum age by default | Session eventually expires. |
| Path `/` | It is available for all API and Socket.IO requests. |

For session restoration, the server hashes the received cookie and searches for an unexpired database session. Invalid or expired token rows are deleted when checked.

Logout deletes that session row and clears the cookie. Other login sessions from other devices remain unless they are separately logged out or expire.

### Optional Versus Required Authentication

`src/http/request-auth.js` has two useful helpers:

| Helper | Used when | Behavior without a valid session |
| --- | --- | --- |
| `optionalRequestUser()` | Anonymous browsing is allowed | Returns `null`. |
| `requiredRequestUser()` | User action/private data requires login | Throws HTTP `401`. |

For example, anyone can view the post feed, but only a logged-in user can vote or save.

## 9. Communities

Files:

- `src/community/community.routes.js`
- `src/community/community.service.js`

Communities group posts and authorize community-chat access.

### REST Endpoints

| Method and URL | Authentication | What it does |
| --- | --- | --- |
| `GET /api/communities` | Optional | Lists communities and whether the viewer joined. |
| `POST /api/communities/:name/join` | Required | Inserts a membership. |
| `DELETE /api/communities/:name/join` | Required | Removes a membership. |

### What Your Currently Open Route Code Does

The selected route file is intentionally thin:

```js
router.get('/', asyncRoute(async (request, response) => {
  const user = await optionalRequestUser(request, authService, config);
  response.json({ success: true, communities: await communityService.list(user?.id ?? null) });
}));
```

Meaning:

1. A visitor may list communities without logging in.
2. If a valid cookie is present, its user's id is supplied to the service.
3. The service can then return `joined: true` for communities that user has joined.
4. If anonymous, it uses `null`, so no communities appear joined.

For joining:

```js
router.post('/:name/join', asyncRoute(async (request, response) => {
  const user = await requiredRequestUser(request, authService, config);
  response.json({ success: true, community: await communityService.join(request.params.name, user.id) });
}));
```

Meaning:

1. Login is mandatory.
2. `request.params.name` comes from the URL, for example `artificial`.
3. `communityService.join()` inserts the membership if it is not already present.
4. It returns the updated community, including `joined: true`.

Leaving has the same structure but deletes membership and returns `joined: false`.

### Seeded Communities

The migrations create these communities:

```text
technology
programming
worldnews
science
artificial
personalfinance
MachineLearning
datascience
```

### Important Community Authorization Rule

`CommunityService.requireMembership(name, userId)` is the gatekeeper for community chat. If the user did not join the community, chat history, joining the realtime room, and sending community messages are rejected with HTTP/socket error `403` behavior.

Creating a post currently does not call `requireMembership()`. A logged-in user can post into an existing community even if they have not joined it.

## 10. Posts, Feed, Voting, Saving, And Search

Files:

- `src/content/post.routes.js`
- `src/content/post.service.js`
- `src/content/post.validation.js`

### Endpoints

| Method and URL | Authentication | What it does |
| --- | --- | --- |
| `GET /api/posts` | Optional | List public feed posts. |
| `POST /api/posts` | Required | Create a public post. |
| `GET /api/posts/:postId` | Optional | Read one public post. |
| `PUT /api/posts/:postId/vote` | Required | Set or remove viewer vote. |
| `PUT /api/posts/:postId/saved` | Required | Save/bookmark a post. |
| `DELETE /api/posts/:postId/saved` | Required | Remove saved bookmark. |
| `GET /api/search` | Public | Search usernames and public post titles. |

### Post Shape Returned To Frontend

The service maps database rows to:

```json
{
  "id": 1,
  "community": "technology",
  "communityColor": "#A855F7",
  "author": "sample_user",
  "createdAt": "2026-05-25T00:00:00.000Z",
  "flair": null,
  "flairColor": null,
  "title": "A title",
  "image": "https://example.com/image.jpg",
  "text": "Post body",
  "link": null,
  "linkDomain": null,
  "votes": 0,
  "comments": 0,
  "reactions": 0,
  "userVote": 0,
  "saved": false
}
```

`userVote` and `saved` are personalized when the viewer sends a valid session cookie. For an anonymous visitor the SQL joins use `null`, resulting in default values.

### Feed Sorting

`GET /api/posts?sort=...` accepts:

| Sort | Meaning in code |
| --- | --- |
| `best` | Larger score first, where score combines votes, comments, and reactions. |
| `hot` | Score adjusted down as the post becomes older. |
| `new` | Most recently created posts first. |
| `top` | Highest vote count first. |
| `rising` | Recent posts within the last 48 hours are boosted by their score. |

Only posts with `visibility = 'public'` are returned.

### Creating A Post

Input supports:

| Field | Rule |
| --- | --- |
| `community` | Existing name matching 2-40 letters/digits/underscores. |
| `title` | Required, max 300 characters. |
| `text` or `description` | Optional, max 10,000 characters. |
| `image` or `imageUrl` | Optional, max 2048 characters and must use HTTPS. |

The service:

1. Finds the requested community.
2. Inserts a post with that community and the logged-in author.
3. Inserts a `post_created` notification for that same author.
4. Returns the complete created post.

Both writes happen in one database transaction.

The schema already has fields for `link_url`, `link_domain`, flair, comments, and reactions, but the current post creation endpoint does not accept links/flairs and there are no comment or reaction creation endpoints.

### Voting

Request body:

```json
{ "vote": 1 }
```

Accepted values:

| Vote | Meaning |
| --- | --- |
| `1` | Upvote. |
| `-1` | Downvote. |
| `0` | Remove existing vote. |

The service remembers any previous vote and adjusts `posts.vote_count` by:

```text
new vote - previous vote
```

Examples:

| Previous | New | Score change |
| --- | --- | --- |
| none (`0`) | `1` | `+1` |
| `1` | `-1` | `-2` |
| `-1` | `0` | `+1` |

### Saving Posts

Saving creates a row in `saved_posts`. Attempting to save the same post again does nothing harmful because it uses `ON CONFLICT DO NOTHING`.

Unsaving deletes that user/post row. Saved posts appear in the private `GET /api/me/saved` endpoint.

### Search

`GET /api/search?q=tech&limit=10`:

- Requires `q` of 2 to 100 characters.
- Finds matching usernames with a case-insensitive `ILIKE` search.
- Finds matching titles of public posts.
- Defaults to 10 results per category, with a maximum limit of 20.

## 11. Profiles And Private Saved Items

Files:

- `src/profile/profile.routes.js`
- `src/profile/profile.service.js`
- `src/profile/profile.validation.js`

### Endpoints

| Method and URL | Authentication | What it does |
| --- | --- | --- |
| `GET /api/profiles/:username` | Optional | Public user profile plus viewer context. |
| `GET /api/profiles/:username/activity` | Public | Public posts/activity. |
| `GET /api/me/saved` | Required | Signed-in user's saved posts. |

### Public Profile

Usernames are looked up case-insensitively but returned with their stored spelling.

Returned profile fields:

| Field | Origin/meaning |
| --- | --- |
| `username` | `users.username`. |
| `displayName` | Optional `user_profiles.display_name`. |
| `bio` | Optional `user_profiles.bio`. |
| `avatarUrl` | Only emitted when it is a valid HTTPS URL. |
| `bannerColor` | Only emitted when it matches `#RRGGBB`. |
| `postKarma` | Total score of public posts, not less than zero in profile display. |
| `commentKarma` | Always `0` because comments are not implemented. |
| `followers` | Count of users following this profile. |
| `cakeDay` | User account-created date. |
| `communities` | Most recent five joined communities with member counts. |

Private account email is never returned from this public endpoint.

### Viewer Context

The profile response includes:

```json
{
  "viewer": {
    "isAuthenticated": true,
    "isSelf": false,
    "isFollowing": false,
    "canMessage": true
  }
}
```

This context helps the frontend render buttons. Important detail: `canMessage` is simply true for a signed-in viewer viewing someone else. It does not prove that direct chat will be authorized; actual direct-message permission still requires mutual follows in `SocialService.requireMutualFollow()`.

If the request contains an expired cookie, a public profile is still returned as an anonymous view rather than failing the entire request.

### Activity

The `type` query parameter accepts:

| Type | Current output |
| --- | --- |
| `overview` | Public posts. |
| `posts` | Public posts. |
| `comments` | Empty items because comment-writing is not implemented. |
| `saved` | Rejected; saved data is private. |

### Saved Items

`GET /api/me/saved` requires login and returns public posts saved by the signed-in user, newest saves first.

## 12. Following, Notifications, And Username Editing

Files:

- `src/social/social.routes.js`
- `src/social/social.service.js`

### Endpoints

| Method and URL | Authentication | What it does |
| --- | --- | --- |
| `POST /api/profiles/:username/follow` | Required | Follow another user. |
| `DELETE /api/profiles/:username/follow` | Required | Stop following another user. |
| `GET /api/notifications` | Required | Fetch notification list. |
| `PATCH /api/me/username` | Required | Change logged-in username. |

### Following

A follow is directional:

```text
alice follows bob
```

is one row, and does not mean:

```text
bob follows alice
```

The database prevents a user from following themselves. The service also gives a clear HTTP `400` error before attempting a self-follow insert.

### Mutual Follows And Direct Chat

`SocialService.requireMutualFollow()` looks for both records:

```text
alice -> bob
bob   -> alice
```

Only when both exist may a user load direct-message history, join a direct socket room, or send a direct message.

### Notifications

The notification endpoint is pageable and returns:

```json
{
  "id": 1,
  "type": "post_created",
  "message": "Your post has been published.",
  "postId": 10,
  "actor": "sample_user",
  "read": false,
  "createdAt": "2026-05-25T00:00:00.000Z"
}
```

Currently the backend creates a notification only when a user creates their own post. There is no endpoint in this code for marking notifications as read.

### Username Editing

A logged-in user may change their username. It uses the registration username format:

```text
3-20 letters, digits, or underscores
```

The case-insensitive database unique index prevents two usernames that differ only by capitalization.

## 13. Pagination

Many list endpoints use `limit` and `cursor`:

```text
?limit=20&cursor=<opaque-string>
```

`src/http/query.js` implements this. The cursor is a base64url-encoded JSON object that contains an offset:

```json
{ "offset": 20 }
```

The service fetches one more row than requested:

```text
requested limit + 1
```

If an extra row exists, the response supplies the next cursor. The frontend should treat that cursor as opaque and simply return it in the next request.

Endpoints using this general pattern include:

- Feed posts.
- Public activity.
- Saved posts.
- Notifications.
- Chat history.

Chat history is queried newest-first for pagination, then each returned page is reversed so messages display chronologically within that page.

## 14. Chat History Over REST

Files:

- `src/chat/chat.routes.js`
- `src/chat/chat.service.js`

### History Endpoints

| Method and URL | Permission rule |
| --- | --- |
| `GET /api/chats/communities/:name/messages` | Logged in and currently a community member. |
| `GET /api/chats/users/:username/messages` | Logged in and mutually following that user. |

Every returned message has this shape:

```json
{
  "id": 123,
  "sender": "sample_user",
  "body": "Hello",
  "createdAt": "2026-05-25T00:00:00.000Z"
}
```

Message bodies are trimmed and must contain 1 to 2000 characters.

REST endpoints only read stored history. New chat messages are sent through Socket.IO, described next.

## 15. Realtime Socket.IO Chat

File: `src/chat/socket.js`

### Socket Authentication

The frontend connects to the same backend origin and includes the existing session cookie:

```js
const socket = io(API_ORIGIN, { withCredentials: true });
```

When the socket connects:

1. The server parses `reddit_session` from the handshake cookie.
2. It calls `authService.session(token)`.
3. If valid, it stores the current user on `socket.data.user`.
4. If invalid or absent, the handshake fails with `Authentication required.`.

### Why Rooms Exist

A Socket.IO room represents one open conversation.

```text
community:<community id>
direct:<smaller user id>:<larger user id>
```

The direct room is deterministic: Alice and Bob calculate the same room regardless of which user sends first.

### Community Events

| Event | Client payload | What backend does |
| --- | --- | --- |
| `community:join` | `{ community }` | Check current membership, then add socket to room. |
| `community:leave` | `{ community }` | Remove that socket from previously joined room. |
| `community:message:send` | `{ community, body }` | Require membership and room join, persist, then broadcast. |
| `community:message` | Server result | Broadcast received by currently eligible joined clients. |

Community broadcasting has an additional safety step. Before sending the live event to each socket already in the room, it checks that recipient's community membership again. If they left or lost access since joining the room, their socket is removed from the room and does not receive the new message.

### Direct Message Events

| Event | Client payload | What backend does |
| --- | --- | --- |
| `direct:join` | `{ username }` | Require mutual follow, then add socket to shared room. |
| `direct:leave` | `{ username }` | Remove socket from previously joined direct room. |
| `direct:message:send` | `{ username, body }` | Require mutual follow and room join, persist, then broadcast. |
| `direct:message` | Server result | Broadcast received by joined sockets. |

For direct broadcasts, the `with` field is different for each participant. If Alice sends to Bob:

```text
Alice receives: { with: "bob", message: ... }
Bob receives:   { with: "alice", message: ... }
```

### Sending A Message Step By Step

For a community message:

```text
1. Client already authenticated its socket.
2. Client emits community:join.
3. Backend confirms membership and acknowledges the join.
4. Client emits community:message:send.
5. Backend confirms membership again.
6. Backend confirms the sender socket joined this room.
7. ChatService validates and INSERTs the message into PostgreSQL.
8. Backend emits community:message to eligible room sockets.
9. Backend acknowledges the send with the stored message.
```

Direct messages follow the same pattern, replacing membership checks with mutual-follow checks.

### Essential Frontend Rules

The frontend must follow these rules:

1. Wait for a successful `:join` acknowledgement before enabling send.
2. Emit `:leave` when switching away from a conversation if it no longer wants broadcasts.
3. Rejoin the visible room after every socket reconnect.
4. Deduplicate acknowledged messages and broadcast messages by message id, because the sender receives the room broadcast too.

Room membership exists only for the lifetime of one socket connection. A reconnect creates a new socket with no old room memberships.

## 16. Health Check

`GET /api/health` calls `HealthService.check()`, which performs a PostgreSQL query for the current database name and PostgreSQL server version.

Example response:

```json
{
  "success": true,
  "database": "connected",
  "databaseName": "database_name",
  "serverVersion": "PostgreSQL ..."
}
```

This route checks deployment connectivity; it is not a login check.

## 17. Complete REST Endpoint Reference

| Method | Endpoint | Login required? | Purpose |
| --- | --- | --- | --- |
| `GET` | `/api/health` | No | Database connection health. |
| `POST` | `/api/auth/register` | No | Create account and login session. |
| `POST` | `/api/auth/login` | No | Login and set cookie. |
| `GET` | `/api/auth/session` | Yes | Restore current signed-in user. |
| `POST` | `/api/auth/logout` | No | Remove session if present and clear cookie. |
| `GET` | `/api/posts` | No | Browse public feed. |
| `POST` | `/api/posts` | Yes | Create post. |
| `GET` | `/api/posts/:postId` | No | Read public post. |
| `PUT` | `/api/posts/:postId/vote` | Yes | Set/remove vote. |
| `PUT` | `/api/posts/:postId/saved` | Yes | Save post. |
| `DELETE` | `/api/posts/:postId/saved` | Yes | Unsave post. |
| `GET` | `/api/search` | No | Search username and post title. |
| `GET` | `/api/communities` | No | Browse communities, with joined state when logged in. |
| `POST` | `/api/communities/:name/join` | Yes | Join community. |
| `DELETE` | `/api/communities/:name/join` | Yes | Leave community. |
| `GET` | `/api/profiles/:username` | No | View public profile. |
| `GET` | `/api/profiles/:username/activity` | No | View public post activity. |
| `POST` | `/api/profiles/:username/follow` | Yes | Follow profile. |
| `DELETE` | `/api/profiles/:username/follow` | Yes | Unfollow profile. |
| `GET` | `/api/me/saved` | Yes | View own saved posts. |
| `PATCH` | `/api/me/username` | Yes | Change own username. |
| `GET` | `/api/notifications` | Yes | View notifications. |
| `GET` | `/api/chats/communities/:name/messages` | Yes + joined | Community message history. |
| `GET` | `/api/chats/users/:username/messages` | Yes + mutual follow | Direct message history. |

## 18. Tests And What They Prove

Run:

```bash
npm test
```

### `test/app.test.js`

Tests the REST contract using service stubs. It verifies:

- Registration validation and `HttpOnly` cookie setting.
- Login, session restoration, and logout cookie clearing.
- Database health response.
- JSON parse errors and unexpected error formatting.
- CORS behavior for configured origin.
- Public/private profile behavior and avoidance of leaked email.
- Saved-items authentication.
- Feed option parsing, post creation input mapping, and search.
- Community joining, following, notifications, username change, and chat-history routing.

### `test/socket.test.js`

Starts an actual HTTP and Socket.IO server with lightweight fake data services. It verifies:

- Two joined community members receive one persisted live message.
- Two mutually-following users receive direct messages.
- REST history contains messages sent by socket.
- Socket clients must join a room before sending.
- `community:leave` and `direct:leave` stop unwanted broadcasts.
- Community broadcasts remove a recipient whose membership was revoked.
- Reconnected clients must rejoin before receiving new room messages.
- Missing session cookie, missing permission, blank messages, and over-2000-character messages are rejected.

Note that `REALTIME_CHAT_BACKEND_HANDOFF.md` contains an older "Backend Work Needed" list. The current source and tests already include leave events and the major socket integration/reconnect tests listed there.

## 19. What Is Implemented And What Is Not

### Implemented

- Registration, login, cookie session restoration, and logout.
- PostgreSQL persistence and migrations.
- Public profiles and public post activity.
- Private saved-post view.
- Feed reading and multiple sorting modes.
- Post creation, votes, and saving.
- Search for usernames and post titles.
- Community list/join/leave.
- Follow/unfollow.
- Notifications for post creation.
- Username editing.
- Persisted community and direct-message history.
- Authenticated Socket.IO community and direct live chat.
- Leave and reconnect behavior tests.

### Present In Schema/Response But Not Fully Implemented

| Area | Current state |
| --- | --- |
| Comments | `comment_count` and `commentKarma` exist, but there are no comment routes; comment activity is empty. |
| Reactions | `reaction_count` contributes to feed score, but there are no reaction routes. |
| Link/flair posting | Columns and returned fields exist, but current post creation accepts title, description, and image only. |
| Profile editing | Profile display columns exist, but only username editing is exposed through an endpoint. |
| Notification read state | Database has `read_at`, but no mark-as-read endpoint exists. |

## 20. A Practical Reading Order For Learning The Code

Use this sequence if you want to understand or extend the backend:

1. Read `src/app.js` to see the entire API surface and middleware.
2. Read `src/server.js`, `src/config.js`, and `src/db.js` to see startup and infrastructure.
3. Read `migrations/*.sql` to understand what data exists.
4. Trace authentication: `auth.routes.js` -> `auth.validation.js` -> `auth.service.js`.
5. Trace the currently open community feature: `community.routes.js` -> `community.service.js`.
6. Trace content: `post.routes.js` -> `post.validation.js` -> `post.service.js`.
7. Read `profile` and `social` modules for user-facing data and relationships.
8. Trace chat twice: REST history in `chat.routes.js`/`chat.service.js`, then realtime events in `chat/socket.js`.
9. Read tests to see the expected behavior in short examples.

## 21. Example: Following One Request Through The Code

Suppose a logged-in frontend user clicks **Join** on the `artificial` community:

```http
POST /api/communities/artificial/join
Cookie: reddit_session=<private token>
```

The flow is:

```text
app.js
  mounts /api/communities router
    |
community.routes.js
  requiredRequestUser() reads cookie and calls AuthService.session()
    |
auth.service.js
  hashes token and finds unexpired auth_sessions row joined to users
    |
community.routes.js
  calls communityService.join("artificial", user.id)
    |
community.service.js
  inserts into community_memberships, avoiding duplicate join rows
  queries current community information
    |
HTTP response
  { success: true, community: { name: "artificial", joined: true, ... } }
```

After this succeeds, the frontend may open chat:

```text
GET /api/chats/communities/artificial/messages
socket.emit("community:join", { community: "artificial" }, acknowledgement)
```

Both actions independently check `community_memberships`, so the chat permission is based on the saved membership in PostgreSQL, not only the frontend interface.

## 22. Useful Development Commands

```bash
npm install          # Install dependencies
cp .env.example .env # Prepare local environment configuration
npm run db:migrate   # Create/update database schema and seed communities
npm run dev          # Start backend with Node watch mode
npm test             # Run API and realtime contract tests
npm start            # Start backend normally
```

## Final Summary

This backend is organized around a clear pattern:

```text
route = receive request and return JSON
validation = reject bad user input
service = enforce application rules and query the database
database = lasting source of truth
socket server = live delivery after the same permissions are checked
```

The most important rules to remember are:

- Login is stored as an `HttpOnly` cookie session, not a frontend token.
- Public feed/profile browsing can be anonymous, but modifying data requires login.
- Community chat requires membership.
- Direct chat requires mutual follows.
- Socket users must join a room before sending, and must rejoin after reconnecting.
- Comments, reactions, and several richer profile/content actions are not implemented yet.