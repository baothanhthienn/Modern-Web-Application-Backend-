# Realtime Chat Backend Handoff

## Purpose

This document records the realtime chat investigation and defines backend behavior needed by the frontend community chat and direct-message views.

## Verified State

Inspection date: 2026-05-25.

- The frontend connects with Socket.IO to `API_ORIGIN`, using browser session cookies with `withCredentials: true`.
- The local server at `http://localhost:3000` exposes Socket.IO. A polling handshake to `/socket.io/?EIO=4&transport=polling` returned a valid Engine.IO session.
- The backend source attaches Socket.IO to the HTTP server and authenticates the handshake with the `reddit_session` cookie.
- `community:message:send` persists a message and emits `community:message` to `community:<id>`.
- `direct:message:send` persists a message and emits `direct:message` to the deterministic two-user direct room.

The Socket.IO endpoint and current event names are correct. The frontend had two realtime failures:

1. It allowed sending before the `community:join` or `direct:join` acknowledgement completed. A message could be saved successfully while the sender was not yet subscribed to its broadcast room, so it appeared only after reloading history.
2. Socket.IO reconnects create new server-side room membership. The frontend previously did not rejoin the visible room after reconnect, so later broadcasts stopped appearing.

The frontend now waits for successful room join before enabling send, joins again on each socket reconnect, shows socket connection errors, and appends acknowledged sender messages while deduplicating the broadcast copy by message ID.

## Required Socket Contract

Socket connection:

```js
io(API_ORIGIN, { withCredentials: true })
```

The handshake must reject unauthenticated sockets with `Authentication required.`.

Community events:

| Direction | Event | Payload | Successful acknowledgement |
| --- | --- | --- | --- |
| client -> server | `community:join` | `{ community: string }` | `{ success: true, community: string }` |
| client -> server | `community:message:send` | `{ community: string, body: string }` | `{ success: true, community: string, message: Message }` |
| server -> room | `community:message` | `{ community: string, message: Message }` | n/a |

Direct-message events:

| Direction | Event | Payload | Successful acknowledgement |
| --- | --- | --- | --- |
| client -> server | `direct:join` | `{ username: string }` | `{ success: true, with: string }` |
| client -> server | `direct:message:send` | `{ username: string, body: string }` | `{ success: true, with: string, message: Message }` |
| server -> room | `direct:message` | `{ with: string, message: Message }` | n/a |

Message shape:

```json
{
  "id": 123,
  "sender": "username",
  "body": "message text",
  "createdAt": "2026-05-25T00:00:00.000Z"
}
```

All failure acknowledgements should be:

```json
{ "success": false, "error": "Human-readable error" }
```

## Backend Work Needed

The current server implementation is sufficient for basic realtime delivery once a client has joined its room. The backend agent should add the following before deployment:

1. Add integration tests with two authenticated Socket.IO clients for community chat. Both clients should join the same authorized community; sending from one client must deliver one `community:message` event to both clients and the saved message must be returned by REST history.
2. Add equivalent two-client direct-message tests after establishing mutual follows. Both joined clients must receive one `direct:message` event and REST history must contain the message.
3. Add a reconnect test or document the reconnect rule explicitly: a newly connected socket is not in previous rooms and must re-emit join events.
4. Add `community:leave` and `direct:leave` events, or define that connections remain subscribed until disconnect. Without leave events, a user who switches conversations remains subscribed to older room broadcasts for the rest of that socket session.
5. Test failed joins and failed sends for non-members, non-mutual follows, expired cookies, empty messages, and bodies longer than 2000 characters.

## Railway Deployment Checks

- Railway must run the HTTP server that owns the Socket.IO instance, not only Express REST routes.
- WebSocket upgrades must be supported. Socket.IO polling fallback should also remain enabled.
- `FRONTEND_ORIGIN` must include the deployed frontend origin exactly and Socket.IO CORS must keep `credentials: true`.
- For frontend and backend on different production origins, the session cookie must use `SameSite=None; Secure`.
- The frontend API base URL and Socket.IO origin must address the same backend service.

## Manual Acceptance Test

1. Open two browsers with different logged-in users.
2. Join the same community in both browsers.
3. Open its chat in both browsers and confirm each shows a live state after joining.
4. Send a message from user A. It must appear immediately for both A and B without refresh.
5. Temporarily disconnect and restore user B's network or restart its socket connection. When reconnected and rejoined, new messages from A must appear immediately.
6. Make the users follow each other, open direct messages in both browsers, and repeat the send/reconnect checks.
