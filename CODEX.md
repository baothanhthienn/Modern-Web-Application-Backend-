# Authentication Migration Handoff: PHP to Express on Railway

## Purpose

This document records the current authentication implementation, the PHP work
already present in the repository, failures observed during debugging, and a
concrete implementation brief for replacing PHP authentication with an Express
API hosted on Railway.

The target direction is:

- Keep the Vue/Vite frontend.
- Replace `public/api/*.php` with an Express authentication service.
- Host the Express API and its database connectivity on Railway.
- Update the frontend to call the Railway API through configuration, not PHP
  files bundled into the frontend deployment.

## Current Repository State

At the time this handoff was written, the git working tree was clean before
adding this file. The application currently contains the committed PHP
implementation, without the experimental source fixes discussed during
debugging.

Relevant committed files:

| File | Responsibility |
| --- | --- |
| `src/services/auth.js` | Frontend auth requests, local user cache, reactive auth state |
| `src/views/LoginView.vue` | Login form and successful navigation |
| `src/views/RegisterView.vue` | Registration form and successful navigation |
| `src/components/AppShell.vue` | Restores session and renders login/logout state |
| `public/api/auth/bootstrap.php` | Common PHP response, PDO, session-cookie, password helpers |
| `public/api/auth/login.php` | Login endpoint |
| `public/api/auth/register.php` | Registration endpoint |
| `public/api/auth/session.php` | Current-user/session restoration endpoint |
| `public/api/auth/logout.php` | Session revocation endpoint |
| `public/api/health.php` | Database connection health check |
| `public/api/config.php` | PHP MariaDB credentials and debug option |
| `public/api/schema.sql` | `users` and `auth_sessions` schema |

## Current Architecture

### Frontend

The frontend is Vue 3 with Vite and hash-based Vue Router routing. The
authentication service currently uses:

```js
const AUTH_API_URL = './api/auth'
```

Requests made by the frontend:

```text
POST ./api/auth/login.php
POST ./api/auth/register.php
GET  ./api/auth/session.php
POST ./api/auth/logout.php
```

All requests use:

```js
credentials: 'same-origin'
headers: { 'Content-Type': 'application/json' }
```

On successful login, registration, or restored session, the frontend stores
the returned user object in:

```text
localStorage key: reddit_user
```

with an additional local property:

```json
{ "loggedIn": true }
```

The PHP session token itself is not intended to be exposed to JavaScript.

### PHP Backend

`bootstrap.php` defines:

- JSON response helper using `json_encode`.
- PDO MariaDB connection based on `public/api/config.php`.
- `reddit_session` cookie name.
- 30-day session lifetime.
- Session tokens generated using random bytes.
- Session token storage as SHA-256 hashes in the database.
- Password hashing/checking based on bcrypt-compatible `crypt()`.

### Database

Current database schema:

```sql
CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  username VARCHAR(20) NOT NULL,
  email VARCHAR(191) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_users_username (username),
  UNIQUE KEY uniq_users_email (email)
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  token_hash CHAR(64) NOT NULL,
  created_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_auth_sessions_token (token_hash),
  INDEX idx_auth_sessions_expiry (expires_at),
  CONSTRAINT fk_auth_sessions_user
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
```

Times are stored as millisecond epoch values. Existing password hashes should
be compatible with bcrypt validation in Node if the same database is retained.

## Current PHP API Contract

An Express replacement should initially preserve this response contract so the
frontend migration remains small and testable.

### Register

Current route:

```http
POST /api/auth/register.php
Content-Type: application/json
```

Request:

```json
{
  "username": "sample_user",
  "email": "sample@example.com",
  "password": "Password1"
}
```

Validation:

- Email must be valid and no longer than 191 characters.
- Username must match `^[A-Za-z0-9_]{3,20}$`.
- Password must be at least 8 characters and contain uppercase, lowercase,
  and a number.
- Username and email must be unique.

Successful response, HTTP `201`:

```json
{
  "success": true,
  "user": {
    "id": 1,
    "username": "sample_user",
    "email": "sample@example.com",
    "joinDate": "2026-05-25T00:00:00+00:00"
  }
}
```

Failure examples:

```json
{ "success": false, "error": "Enter a valid email address." }
{ "success": false, "error": "Username must be 3-20 letters, numbers, or underscores." }
{ "success": false, "error": "Password must be 8+ characters with uppercase, lowercase, and a number." }
{ "success": false, "error": "That username or email is already registered." }
```

On success, a session is also created.

### Login

Current route:

```http
POST /api/auth/login.php
Content-Type: application/json
```

Request:

```json
{
  "identifier": "sample_user",
  "password": "Password1"
}
```

`identifier` accepts a username or email address.

Successful response, HTTP `200`:

```json
{
  "success": true,
  "user": {
    "id": 1,
    "username": "sample_user",
    "email": "sample@example.com",
    "joinDate": "2026-05-25T00:00:00+00:00"
  }
}
```

Failure response, HTTP `401`:

```json
{
  "success": false,
  "error": "Invalid username, email, or password."
}
```

On success, a session row is inserted and the browser receives the session
cookie.

### Restore Session

Current route:

```http
GET /api/auth/session.php
```

Successful response, HTTP `200`, has the same `user` shape as login.

Failure response, HTTP `401`:

```json
{
  "success": false,
  "error": "Session expired or invalid."
}
```

### Logout

Current route:

```http
POST /api/auth/logout.php
```

Successful response, HTTP `200`:

```json
{ "success": true }
```

The session token row is deleted and the cookie is expired.

### Health Check

Current route:

```http
GET /api/health.php
```

Successful response:

```json
{
  "success": true,
  "database": "connected",
  "databaseName": "...",
  "serverVersion": "..."
}
```

## Failure History and Findings

### Observed User Errors

The login debugging produced these browser errors:

```text
Cannot read properties of undefined (reading 'stack')
```

and later:

```text
[auth] login.php returned a non-JSON response (200)
Authentication endpoint did not return JSON.
Authentication service returned an invalid response from ./api/auth/login.php.
```

### Confirmed Findings

1. `npm run dev` runs Vite only. Vite does not execute PHP.

   A browser request to `./api/auth/login.php` through Vite can receive the
   PHP file contents as static text with HTTP `200`, rather than JSON from an
   executing backend. This directly explains non-JSON responses while testing
   the Vue application locally through Vite.

2. A direct PHP-server invalid-login request was tested successfully during
   investigation.

   The PHP endpoint connected to the configured MariaDB database and returned:

   ```json
   { "success": false, "error": "Invalid username, email, or password." }
   ```

3. The configured database was checked during investigation and the
   `auth_sessions` table existed at that time.

4. The committed PHP code catches PDO connection failure only in
   `database()`. It does not catch PDO exceptions from subsequent statements,
   including:

   - login account lookup,
   - successful login session insertion,
   - registration queries and session insertion,
   - session restoration lookup,
   - logout deletion,
   - health query.

   Therefore a database operation failure after connection can produce
   non-contract output or a server error rather than JSON.

### Investigated but Not Currently Applied

The following fixes were discussed or temporarily explored, but are not in the
clean committed checkout described above:

- Removing console logging from the auth request path to avoid third-party
  console instrumentation affecting login error reporting.
- Strict validation of PHP JSON response shapes in `auth.js`.
- Converting every PHP PDO exception into JSON error responses.
- Buffering/suppressing PHP warning output before emitting JSON.
- Running a local PHP server or adding a Vite-to-PHP proxy.

Since the intended direction is now Express on Railway, those PHP-specific
fixes should not be treated as the final implementation.

## Why Replace PHP

The frontend is being tested locally through Vite, where PHP files cannot
execute. Production PHP hosting also couples the API to a specific Mercury
deployment layout. A separately deployable Express API provides:

- A consistent local and hosted API runtime.
- Environment-based configuration instead of credentials in frontend-deployed
  source assets.
- Clear JSON error middleware.
- Direct Railway deployment and observability.
- Easier automated testing and future API expansion.

## Critical Security Action

`public/api/config.php` currently contains a hardcoded database password in
tracked repository content. Do not copy this value into documentation, code,
logs, or prompts.

The migration work must:

1. Rotate the exposed MariaDB password immediately.
2. Remove credentials from tracked files.
3. Store server credentials only in Railway environment variables.
4. Consider removing PHP configuration files from future frontend deployment
   output once the Express service is active.
5. Keep session secrets and database URLs out of Vite-prefixed environment
   variables, because `VITE_*` variables are exposed to browser code.

## Target Express API Design

### Recommended Stack

- Node.js with Express.
- `mysql2/promise` if retaining the current MariaDB schema/database.
- `bcrypt` for password hashing and existing bcrypt hash verification.
- `cookie-parser`.
- `cors`.
- `helmet`.
- `dotenv` locally; Railway environment variables in production.
- A focused test runner such as Vitest or Node test runner plus Supertest.

### Route Design

Preferred clean routes:

```text
POST /api/auth/register
POST /api/auth/login
GET  /api/auth/session
POST /api/auth/logout
GET  /api/health
```

Migration option for minimal frontend disruption:

```text
POST /api/auth/register.php
POST /api/auth/login.php
GET  /api/auth/session.php
POST /api/auth/logout.php
GET  /api/health.php
```

Either is valid. If clean routes are used, update `src/services/auth.js`
accordingly.

### Environment Variables

Suggested Railway server variables:

```text
NODE_ENV=production
PORT=<provided by Railway>
DATABASE_HOST=...
DATABASE_PORT=3306
DATABASE_NAME=...
DATABASE_USER=...
DATABASE_PASSWORD=...
SESSION_COOKIE_NAME=reddit_session
SESSION_TTL_SECONDS=2592000
FRONTEND_ORIGIN=https://<frontend-host>
COOKIE_SECURE=true
COOKIE_SAME_SITE=none
```

If Railway provides a single `DATABASE_URL`, prefer that instead of individual
database fields.

Frontend configuration:

```text
VITE_API_BASE_URL=https://<railway-service-domain>/api
```

Only the public API base URL may be exposed to the Vite frontend.

### Database Behavior

The Express server should either reuse the current MariaDB schema or migrate it
explicitly. If reusing it:

- Preserve `users.password_hash` validation with bcrypt.
- Store newly generated passwords using `bcrypt.hash(password, 10)` or a
  documented chosen cost.
- Keep session tokens random and store only their SHA-256 hash.
- Store expiry values consistently, either preserving millisecond epoch values
  or migrating all session SQL queries together.

Session creation algorithm:

1. Generate at least 32 cryptographically random bytes.
2. Return the raw token only in an `HttpOnly` cookie.
3. Store `sha256(rawToken)` in `auth_sessions`.
4. Store creation and expiry time.
5. Delete expired sessions opportunistically or using scheduled cleanup.

Recommended cookie options:

```js
{
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: frontendAndApiAreCrossSite ? 'none' : 'lax',
  maxAge: 30 * 24 * 60 * 60 * 1000,
  path: '/'
}
```

The `sameSite` choice depends on where the Vue frontend will be hosted relative
to the Railway API. Cross-site cookie auth requires both `SameSite=None` and
`Secure`.

### CORS and Credentials

If frontend and API are on different origins, Express must return credentials
for the exact frontend origin:

```js
app.use(cors({
  origin: process.env.FRONTEND_ORIGIN,
  credentials: true
}))
```

The frontend must change from:

```js
credentials: 'same-origin'
```

to:

```js
credentials: 'include'
```

when calling a Railway domain from a separately hosted frontend.

Do not use `Access-Control-Allow-Origin: *` with cookie authentication.

### Error Contract

All Express routes should always return JSON, including unexpected failures:

```json
{
  "success": false,
  "error": "Authentication service failed."
}
```

Log internal exception details on the server. Do not return SQL, credentials,
or stack traces in production responses.

During development only, an optional `details` property can be returned:

```json
{
  "success": false,
  "error": "Authentication service failed.",
  "details": "development-only message"
}
```

## Required Frontend Migration

### `src/services/auth.js`

Replace the hardcoded PHP-relative base:

```js
const AUTH_API_URL = './api/auth'
```

with a configurable API base:

```js
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api'
```

For clean Express routes, request:

```js
fetch(`${API_BASE_URL}/auth/login`, ...)
fetch(`${API_BASE_URL}/auth/register`, ...)
fetch(`${API_BASE_URL}/auth/session`, ...)
fetch(`${API_BASE_URL}/auth/logout`, ...)
```

Use:

```js
credentials: 'include'
```

to allow cookies with the Railway API.

The frontend should validate:

- response is JSON,
- `data.success` is a boolean,
- login/register/session success contains `data.user.username`,
- failure uses `data.error`, with optional development `data.details`.

Keep or improve the existing reactive auth-state API:

```js
login(credentials)
register(details)
saveAuthSession({ user })
getStoredUser()
clearStoredAuth()
useAuthUser()
restoreAuthSession()
logout()
```

### Views and Shell

The current components already use the auth service and should require little
or no structural change:

- `LoginView.vue` calls `login()` then `saveAuthSession()`.
- `RegisterView.vue` calls `register()` then `saveAuthSession()`.
- `AppShell.vue` calls `restoreAuthSession()` and `logout()`.

Review auth state display after migration because an earlier investigated UI
issue involved rendering a Vue ref/object instead of a username string.

## Suggested Express Project Layout

One possible layout inside this repository:

```text
server/
  package.json
  src/
    app.js
    server.js
    config.js
    db.js
    middleware/
      error-handler.js
    auth/
      auth.routes.js
      auth.controller.js
      auth.service.js
      auth.validation.js
      session.service.js
  test/
    auth.test.js
```

Alternatively, use a separate Railway backend repository. In that case, keep
this document and the frontend API environment setup in this repository.

## Express Implementation Checklist

1. Create the Express server with JSON body parsing and centralized JSON error
   handling.
2. Configure MariaDB access through Railway environment variables.
3. Implement `GET /api/health`.
4. Implement registration validation and duplicate handling.
5. Implement bcrypt password hashing and verification.
6. Implement login by username or lowercase email.
7. Implement hashed cookie-session issuance.
8. Implement session lookup and logout revocation.
9. Configure CORS and credentialed cookies for the chosen frontend host.
10. Rewrite `src/services/auth.js` to use `VITE_API_BASE_URL` and Express
    routes.
11. Remove or stop deploying PHP API files after frontend cutover.
12. Rotate the currently exposed database password and remove tracked secrets.
13. Add tests before deployment.

## Minimum Acceptance Tests

### API Tests

- `GET /api/health` returns JSON and does not disclose credentials.
- Registration succeeds with a valid new account.
- Registration rejects invalid email, username, and password.
- Registration rejects duplicate username/email.
- Login succeeds with username.
- Login succeeds with email.
- Login rejects invalid password with HTTP `401`.
- Successful auth sets an `HttpOnly` session cookie.
- Session endpoint restores authenticated user when cookie is supplied.
- Session endpoint rejects no/expired/invalid cookie.
- Logout invalidates the cookie and database session.
- Database and unexpected errors return JSON, never HTML stack output.

### Browser Workflow Tests

- Frontend registration redirects to home and displays the logged-in username.
- Frontend login redirects to home and survives reload via the session
  endpoint.
- Logout returns the UI to guest state.
- Failed login displays the API-provided user-facing message.
- Local Vite development calls the configured Express API rather than any
  `.php` asset.

### Railway Deployment Tests

- Railway health endpoint responds over HTTPS.
- CORS accepts only the deployed frontend origin.
- Cookie is accepted by the browser in the deployed frontend/API origin setup.
- No PHP config or database secret is included in frontend static output.

## Prompt for the Next Coding Agent

Use the following task statement with this repository:

> Replace the current PHP authentication backend with an Express API designed
> for Railway hosting. Read `AUTH_EXPRESS_RAILWAY_HANDOFF.md` first. Preserve
> the current frontend user-facing login/register behavior and response
> contract unless a clearly documented migration requires a change. Implement
> secure cookie-based sessions using hashed database tokens, configure the
> frontend through `VITE_API_BASE_URL`, support cross-origin credentialed
> requests when the frontend and Railway API have separate origins, add
> automated tests, remove any dependency on `.php` endpoints after cutover,
> and ensure secrets are supplied only through environment variables. Do not
> expose or reuse the tracked database password; require it to be rotated.

