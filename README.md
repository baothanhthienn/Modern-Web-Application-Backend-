# Modern Web Application Backend

Express authentication API for a Vue frontend, backed by PostgreSQL and
designed for deployment on Railway.

## Features

- JSON API responses, including failures.
- Registration and login with bcrypt password hashing.
- `HttpOnly` cookie sessions with only SHA-256 token hashes stored in the
  database.
- Credentialed CORS restricted to configured frontend origins.
- PostgreSQL schema migration and API contract tests.

## Setup

Requires Node.js 20 or later.

```bash
npm install
cp .env.example .env
npm run db:migrate
npm run dev
```

Set `DATABASE_URL` in `.env` locally and in Railway environment variables for
deployment. Never expose it through a `VITE_*` variable or commit `.env`.

For a separately deployed frontend, set:

```text
FRONTEND_ORIGIN=https://your-frontend.example
COOKIE_SECURE=true
COOKIE_SAME_SITE=none
```

The frontend public configuration should contain only:

```text
VITE_API_BASE_URL=https://your-api.example/api
```

and cross-origin browser requests must use `credentials: 'include'`.

## Commands

```bash
npm test            # Run endpoint contract tests
npm run db:migrate  # Create PostgreSQL users/session tables
npm start           # Start the HTTP server
```

## Endpoints

```text
GET  /api/health
POST /api/auth/register
POST /api/auth/login
GET  /api/auth/session
POST /api/auth/logout
```

Registration accepts `username`, `email`, and `password`. Login accepts
`identifier` (username or email) and `password`. Authentication responses use:

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

## Railway

Set `NODE_ENV=production`, `DATABASE_URL`, `FRONTEND_ORIGIN`,
`COOKIE_SECURE=true`, and `COOKIE_SAME_SITE=none` for a cross-site frontend.
Railway supplies `PORT` when running the service. Run `npm run db:migrate`
against the production database before using authentication endpoints.
