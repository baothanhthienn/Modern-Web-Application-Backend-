# Community Chat and Inbox — Frontend Technical Report

## 1. Feature Overview and Architecture

The application provides two real-time messaging features: **Community Chat** (`/chat`) and **Direct Inbox** (`/inbox`). Both are implemented as full-page views that combine REST API calls for loading historical data with a persistent Socket.IO connection for live updates. This hybrid approach is a deliberate architectural choice: REST handles durable, pageable history reliably, while Socket.IO handles the low-latency delivery that a chat experience demands.

Both features share the same underlying Socket.IO connection, managed as a singleton in `src/services/realtime.js`. Neither view creates its own connection — they call `getChatSocket()`, which returns the existing connected socket or creates and connects one on first call. This means navigating between the community chat and the inbox does not cause a reconnect: the transport layer is shared and persistent.

```
Browser
  └── getChatSocket()  ─── single socket.io-client instance (API_ORIGIN, withCredentials: true)
         │
         ├── ChatView.vue     (community:* events)
         └── InboxView.vue    (direct:* events)
```

The two features are structurally parallel: each has a left-panel list (rooms or conversations) and a right-panel conversation area, and each uses the same two child components — `MessageList.vue` and `MessageInput.vue` — to render messages and accept user input.

---

## 2. Socket.IO Service Layer — `src/services/realtime.js`

The service file is intentionally small (49 lines). Its job is to abstract three concerns away from the views: socket creation, event acknowledgement, and reaction metadata.

### 2.1 Singleton Socket

```js
export function getChatSocket() {
  if (!socket) {
    socket = io(API_ORIGIN, {
      autoConnect: false,
      withCredentials: true,
    })
  }
  if (!socket.connected) {
    socket.connect()
  }
  return socket
}
```

`autoConnect: false` prevents the socket from connecting at import time — the connection only opens when a view actually mounts and calls `getChatSocket()`. `withCredentials: true` ensures the session cookie is sent with the WebSocket handshake, which the backend uses to authenticate the user.

`API_ORIGIN` is derived from the same `VITE_API_BASE_URL` environment variable used by REST calls, ensuring the WebSocket always reaches the correct server. During local development the Vite proxy forwards both `/api` HTTP requests and `/socket.io` WebSocket traffic to the Railway backend.

### 2.2 Acknowledged Event Helper

All outgoing socket events go through `emitSocketEvent`:

```js
export function emitSocketEvent(socketClient, event, payload) {
  return new Promise((resolve, reject) => {
    socketClient.timeout(ACK_TIMEOUT_MS).emit(event, payload, (error, response) => {
      if (error) {
        reject(new Error('The live chat service did not respond.'))
        return
      }
      resolve(response)
    })
  })
}
```

The helper wraps Socket.IO's acknowledgement callback pattern in a Promise and enforces an 8-second hard timeout (`ACK_TIMEOUT_MS = 8000`). Every mutating action — joining a room, sending a message, marking as read, setting a reaction — goes through this function. The views can then `await` the call and handle errors uniformly rather than dealing with raw callback-style event emissions.

### 2.3 Reaction Metadata

```js
export const CHAT_REACTIONS = [
  { id: 'like', icon: '👍', label: 'Like' },
  { id: 'love', icon: '❤️', label: 'Love' },
  { id: 'laugh', icon: '😂', label: 'Laugh' },
  { id: 'surprised', icon: '😮', label: 'Surprised' },
  { id: 'sad', icon: '😢', label: 'Sad' },
]
```

Both community and direct messages share the same five reaction types, exported from `realtime.js` so they are defined in one place. `MessageList.vue` imports `CHAT_REACTIONS` to render the reaction picker palette.

---

## 3. Community Chat — `src/views/ChatView.vue`

### 3.1 Layout and State

The chat page is a two-column flex layout that fills the full viewport height below the top navigation bar (`height: calc(100vh - 56px)`). The left panel (310 px wide) is a scrollable list of community rooms. The right panel is the active conversation.

The key reactive state is:

| Ref | Type | Purpose |
|---|---|---|
| `rooms` | Array | All communities from REST |
| `activeRoom` | Object | The community currently selected |
| `messages` | Array | Messages for the active room |
| `connected` | Boolean | Socket transport is alive |
| `roomJoined` | Boolean | Server acknowledged the `community:join` event |
| `joinedCommunity` | String | Which room the socket is currently joined to |
| `typingUsers` | Array | Usernames of people currently typing |

The connection status indicator in the header combines two conditions:

```js
const canSend = computed(() =>
  Boolean(activeRoom.value?.joined && connected.value && roomJoined.value)
)
```

This three-part guard ensures the user can only send messages when (1) they are a community member, (2) the WebSocket transport is alive, and (3) the server has explicitly acknowledged their room join. A user whose connection drops mid-session will see the input disabled immediately when `connected.value` becomes `false`.

### 3.2 Loading Messages and Joining the Room

When the user selects a community, `selectRoom()` calls `loadMessages()`, which runs three sequential steps:

```
1. REST:   GET /api/chats/communities/:name/messages
           → populates messages.value with history

2. Socket: emitSocketEvent('community:join', { community: name })
           → backend authorises membership, returns { success, community }
           → sets roomJoined.value = true

3. Socket: emitSocketEvent('community:read', { community: name })
           → marks all visible messages as read on the server
```

The REST call always runs first. This means the user sees the message history immediately without waiting for the WebSocket handshake. The join ack arrives shortly after, enabling the input. If the join fails (e.g., the user's membership lapsed between the REST call and the socket event), `messageError` is set and the input remains disabled.

A stale-result guard is placed after every async boundary:

```js
const data = await getCommunityMessages(roomName)
if (activeRoom.value?.name !== roomName) return   // user switched rooms mid-flight
```

This prevents a slow response for room A from overwriting the state of room B that the user has already navigated to.

### 3.3 Sending Messages

```js
async function sendMessage(body) {
  if (!canSend.value) return
  const response = await emitSocketEvent(socket, 'community:message:send', {
    community: activeRoom.value.name,
    body,
  })
  if (!response?.success) throw new Error(response?.error || 'Message could not be sent.')
  appendMessage(response.message)
}
```

The sender adds their own message to the list from the acknowledgement response, not from the broadcast. The backend broadcasts the message to all other members of the room as a `community:message` event. If the same message arrived twice (once from the ack and once from the broadcast), the deduplication check in `appendMessage` prevents a duplicate:

```js
function appendMessage(message) {
  if (message && !messages.value.some((entry) => String(entry.id) === String(message.id))) {
    messages.value.push(message)
  }
}
```

### 3.4 Incoming Events

The view registers four server-push listeners in `onMounted`:

| Event | Handler | What it does |
|---|---|---|
| `community:message` | `receiveMessage` | Appends a new message if it belongs to the active room; triggers a read mark |
| `community:typing` | `receiveTyping` | Adds or removes a username from `typingUsers` |
| `community:read` | `applyCommunityRead` | Marks a set of message IDs as `seen: true` in the local array; increments `seenByCount` for messages sent by others |
| `community:reaction` | `applyCommunityReaction` | Replaces the `reactions` array on a specific message with updated counts |

All four listeners are removed in `onBeforeUnmount` using the exact same function references so no orphaned handlers leak when the user navigates away.

### 3.5 Reconnect Handling

```js
function handleConnect() {
  connected.value = true
  connectionError.value = ''
  joinActiveRoom()
}

function handleDisconnect() {
  connected.value = false
  roomJoined.value = false
  joinedCommunity.value = ''
  typingUsers.value = []
}
```

When the socket disconnects (network interruption, server restart), `roomJoined.value` is immediately set to `false`, which disables the message input via `canSend`. When the socket reconnects, `handleConnect` fires and calls `joinActiveRoom()` again. The server does not persist room membership across connections — a client must re-join after every reconnect. The view handles this transparently: from the user's perspective the input simply re-enables once the connection is restored.

---

## 4. Direct Inbox — `src/views/InboxView.vue`

### 4.1 Authorization Model — Mutual Follow Gating

Direct messages are restricted to pairs of users who both follow each other. This is enforced by the backend: attempting to load messages for a non-mutual-follow user returns HTTP 403. The frontend handles this explicitly:

```js
} catch (error) {
  historyError.value = error.message
  historyForbidden.value = error.status === 403
}
```

When `historyForbidden` is true, the UI shows an explanatory message: "Direct chat becomes available once both users follow each other." A Follow button is shown in the conversation header if the current user is not yet following the other person, allowing them to initiate the mutual-follow relationship from within the inbox.

### 4.2 Conversation List

The left panel shows all active conversations fetched from `GET /api/chats/conversations`. Each entry shows the other user's avatar, display name, last message preview, relative timestamp, and an unread badge. The 404 handling deserves special note:

```js
if (error.status === 404) {
  conversationApiPending.value = true
}
```

If the conversations endpoint returns 404, the view does not show an error — instead it shows an informational banner: "Inbox sync is not available yet." This is a graceful degradation for deployments where the conversation API has not yet been enabled.

### 4.3 Opening a Conversation

`openConversation(username)` performs two parallel requests:

```js
const [history, profile] = await Promise.all([
  getDirectMessages(username),
  getProfile(username),
])
```

The parallel fetch is important for perceived performance: message history and profile data (needed for the header and the Follow button) arrive simultaneously rather than sequentially. After both resolve, the view calls `joinActiveDirect()` to open the socket channel, then `markActiveConversationRead()` to clear the unread counter.

### 4.4 Conversation Upsert — Live List Ordering

A key UX requirement is that the conversation list always shows the most recent conversation at the top. `upsertConversation` handles this:

```js
function upsertConversation(username, lastMessage, incrementUnread = false) {
  const index = conversations.value.findIndex((c) => c.username === username)
  const existing = index >= 0 ? conversations.value[index] : { username, unreadCount: 0 }
  const updated = {
    ...existing,
    lastMessage: lastMessage || existing.lastMessage || null,
    unreadCount: incrementUnread ? (existing.unreadCount || 0) + 1 : 0,
  }
  if (index >= 0) conversations.value.splice(index, 1)
  conversations.value.unshift(updated)
}
```

The function removes the conversation from its current position and prepends it to the array. If a message arrives for a conversation that is not currently open (`incrementUnread = true`), the unread counter increments. When the user opens that conversation, `markActiveConversationRead()` resets the counter to zero via `applyDirectRead`.

### 4.5 Direct Socket Events

InboxView registers five server-push listeners:

| Event | Handler | What it does |
|---|---|---|
| `direct:message` | `receiveMessage` | Appends message to active conversation; upserts conversation row; triggers read mark |
| `direct:conversation` | `receiveConversation` | Moves a conversation entry to the top of the list (used when a new conversation is initiated by the other party) |
| `direct:typing` | `receiveTyping` | Sets `typingUsers` to the sender's username (DMs only ever show one typer) |
| `direct:read` | `applyDirectRead` | Marks messages `seen: true`, adds `seenAt` timestamp, clears unread count |
| `direct:reaction` | `applyDirectReaction` | Updates reaction counts on a specific message |

### 4.6 URL-Based Deep Linking

The inbox supports direct linking via the `?with=username` query parameter:

```js
function applyInitialContact() {
  const username = typeof route.query.with === 'string' ? route.query.with : ''
  if (username && username !== activeUsername.value) {
    openConversation(username)
  }
}

onMounted(() => {
  // ...
  applyInitialContact()
})
watch(() => route.query.with, applyInitialContact)
```

When the page mounts with `?with=alice`, `openConversation('alice')` is called automatically. This allows other parts of the application (e.g., a user profile page) to link directly to a specific conversation. The `watch` on `route.query.with` means the conversation also updates if the query parameter changes while the inbox is already open.

---

## 5. Shared Components

### 5.1 `MessageList.vue`

The message list renders a column of message bubbles. The current user's messages appear on the right with a blue background; other users' messages appear on the left with a grey background, preceded by an avatar letter.

**Auto-scroll**: A watcher on `props.messages.length` triggers `nextTick` then scrolls the container to the bottom:

```js
watch(() => props.messages.length, async () => {
  await nextTick()
  if (listRef.value) listRef.value.scrollTop = listRef.value.scrollHeight
})
```

`nextTick` is required because the DOM update (rendering the new message bubble) happens asynchronously after the reactive data change. Without it, `scrollHeight` would reflect the pre-update height and the scroll would land one message short.

**Seen state**: For messages sent by the current user, a `seen-state` label appears below the bubble if `message.seen` is true. In community rooms this shows "Seen by N" (a count). In direct messages it shows "Seen HH:MM" (the specific timestamp from `message.seenAt`).

**Typing indicator**: When `typingUsers.length > 0`, an animated three-dot indicator appears at the bottom of the list with a label: "u/alice is typing" or "3 people are typing".

**Reaction palette**: Each message has a smiley-face button that toggles a floating palette of the five reaction options. Clicking a reaction emits a `reaction` event to the parent view — `MessageList` does not call the API directly.

```js
function toggleReaction(message, reaction) {
  emit('reaction', {
    messageId: message.id,
    reaction: message.viewerReaction === reaction ? null : reaction,
  })
}
```

If the user clicks their already-selected reaction, `reaction` is passed as `null`, signalling a removal. The parent (`ChatView` or `InboxView`) handles the actual socket event.

### 5.2 `MessageInput.vue`

A `<form>` containing a resizable `<textarea>` and a send button. Key behaviours:

- **Enter to send**: `@keydown.enter.exact.prevent="send"` submits without creating a newline. Shift+Enter (which does not match `.exact`) inserts a newline as expected.
- **Typing indicator**: A `watch` on the body ref emits `typing-change(true)` when the user types and `typing-change(false)` when they stop. A 1.6-second debounce timer (`typingTimeout`) resets the typing state automatically. The `typing-change` event is also emitted on blur, on disable, and on unmount, ensuring the server is never left with a stale "is typing" state.
- **Disabled state**: When `disabled` is `true`, the textarea shows the `disabledMessage` prop as its placeholder (e.g., "Connecting to live chat...") and the send button is also disabled.

---

## 6. Real-Time Features

### 6.1 Typing Indicators

The flow from keystroke to display involves four steps:

```
User types in MessageInput
  → watch(body) → emitTyping(true) → emit('typing-change', true)
  → parent view: setTyping(true)
  → emitSocketEvent('community:typing', { community, isTyping: true })
  → server broadcasts typing event to other room members
  → other users' receiveTyping() → typingUsers updated
  → MessageList renders animated dots
```

The typing state is explicitly cleared on five triggers: stop typing (1.6s idle), input cleared (body becomes empty), form submitted, input blurred, input disabled, and component unmounted. This ensures the server is never left with a stale "Alice is typing" indicator if Alice navigates away.

### 6.2 Read Receipts

Community and direct messages implement read receipts differently.

**Community chat**: `seenByCount` is a running total. When a user opens a room, `markActiveRoomRead()` emits `community:read`. The backend returns a `community:read` event to all room members with the set of message IDs that were marked and the username who read them. All clients update their local message objects:

```js
seenByCount: increment ? (message.seenByCount || 0) + increment : (message.seenByCount || 0)
```

The increment is 1 when the reader is someone other than the current user (self-reads don't increment the counter).

**Direct messages**: Read receipts are per-message with a timestamp. The backend returns `{ messageIds, readAt }` and the client sets `seen: true` and `seenAt: readAt` on each affected message. The "Seen HH:MM" label appears under the sender's own messages.

### 6.3 Message Reactions

Reactions are stored as aggregated counts on the server: `[{ reaction: 'like', count: 3 }, ...]`. When a user sets or removes a reaction, the server recomputes the full array and broadcasts it to all participants. The client replaces the message's `reactions` array in place:

```js
messages.value = messages.value.map((message) =>
  String(message.id) === String(payload.messageId)
    ? { ...message, reactions: payload.reactions, viewerReaction: ... }
    : message
)
```

The immutable map (creating new objects rather than mutating) ensures Vue's reactivity system detects the change and re-renders the affected bubble.

---

## 7. Reconnect Handling and Room Lifecycle

Socket.IO rooms do not survive a disconnect. The server removes a client from all rooms when their connection drops. The frontend must re-join after every reconnect.

Both views follow the same pattern:

```js
function handleConnect() {
  connected.value = true
  joinActiveRoom()       // or joinActiveDirect()
}

function handleDisconnect() {
  connected.value = false
  roomJoined.value = false
  typingUsers.value = []
}
```

The `canSend` computed property is the central guard that keeps the UI consistent across connection state changes:

```
connected: false  →  canSend: false  →  textarea disabled, placeholder "Connecting..."
connected: true, join pending  →  canSend: false  →  placeholder "Joining this live chat..."
connected: true, join acked  →  canSend: true  →  textarea enabled, full interaction
```

Room membership is also cleaned up when the user navigates to a different room. `leaveJoinedRoom()` emits `community:leave` before `joinActiveRoom()` emits `community:join` for the new room. This prevents a user from being subscribed to multiple rooms simultaneously and receiving messages for rooms they are not viewing.

The cleanup is also registered in `onBeforeUnmount`:

```js
onBeforeUnmount(() => {
  leaveJoinedRoom()
  socket?.off('community:message', receiveMessage)
  // ... remove all listeners
})
```

Removing listeners with the exact function reference (not an anonymous wrapper) is important — `socket.off(event)` without a reference removes all handlers for that event, which would break the other view if it shares the socket.

---

## 8. REST API Endpoints Used

### Community Chat

| Method | Path | Used for |
|---|---|---|
| `GET` | `/api/communities` | Load room list with member counts and joined status |
| `POST` | `/api/communities/:name/join` | Join a community (also unlocks the chat) |
| `DELETE` | `/api/communities/:name/join` | Leave a community |
| `GET` | `/api/chats/communities/:name/messages` | Load message history for a room |

### Direct Inbox

| Method | Path | Used for |
|---|---|---|
| `GET` | `/api/chats/conversations` | Load all conversation threads for the current user |
| `GET` | `/api/chats/users/:username/messages` | Load message history for a specific DM thread |
| `GET` | `/api/profiles/:username` | Load the other user's profile (avatar, follow state) |
| `POST` | `/api/profiles/:username/follow` | Follow a user from within the inbox |

### Socket.IO Events

**Outgoing (client → server, all acknowledged):**

| Event | Payload | Purpose |
|---|---|---|
| `community:join` | `{ community }` | Subscribe to a room's live updates |
| `community:leave` | `{ community }` | Unsubscribe from a room |
| `community:message:send` | `{ community, body }` | Send a message |
| `community:typing` | `{ community, isTyping }` | Update typing state |
| `community:read` | `{ community }` | Mark messages as read |
| `community:reaction:set` | `{ community, messageId, reaction }` | Set a reaction |
| `community:reaction:remove` | `{ community, messageId }` | Remove a reaction |
| `direct:join` | `{ username }` | Subscribe to a DM channel |
| `direct:leave` | `{ username }` | Unsubscribe from a DM channel |
| `direct:message:send` | `{ username, body }` | Send a direct message |
| `direct:typing` | `{ username, isTyping }` | Update typing state |
| `direct:read` | `{ username }` | Mark DMs as read |
| `direct:reaction:set` | `{ username, messageId, reaction }` | Set a reaction |
| `direct:reaction:remove` | `{ username, messageId }` | Remove a reaction |

**Incoming (server → client, no ack):**

| Event | Handler view | Trigger |
|---|---|---|
| `community:message` | ChatView | Another user sent a message to the active room |
| `community:typing` | ChatView | Another user's typing state changed |
| `community:read` | ChatView | A user read messages in the active room |
| `community:reaction` | ChatView | A reaction was set or removed in the active room |
| `direct:message` | InboxView | A new direct message was received |
| `direct:conversation` | InboxView | A new conversation was initiated |
| `direct:typing` | InboxView | The other party's typing state changed |
| `direct:read` | InboxView | The other party read the messages |
| `direct:reaction` | InboxView | A reaction was set or removed in the active DM |

---

## 9. Error Handling and Edge Cases

**Authentication errors**: If the socket handshake returns "Authentication required.", the view shows "Log in to use live chat." rather than a generic connection error. This happens for unauthenticated users — the chat features require a valid session.

**403 Forbidden on direct messages**: When `openConversation` catches a 403, `historyForbidden` is set to `true` and a contextual message is shown. The profile is still fetched so the Follow button can be displayed, guiding the user toward unlocking the chat.

**404 on conversations API**: Treated as a soft failure (`conversationApiPending = true`), not an error. Shows a friendly "not available yet" message rather than a red error banner.

**Stale async results**: Every async operation that depends on `activeRoom` or `activeUsername` checks whether those values have changed before applying its result. This prevents a slow network response from overwriting state that belongs to a different room or conversation.

**Typing cleanup on unmount**: `MessageInput.vue` calls `emitTyping(false)` in `onBeforeUnmount`, and both views call `leaveJoinedRoom()` or `leaveActiveDirect()` before removing socket listeners. This ensures the server's state is clean when the user navigates away.

---

# Backend Technical Report

## 10. Backend Architecture

The backend is a Node.js/Express API deployed on Railway, backed by a Railway-hosted PostgreSQL database. It uses an application factory pattern (`createApp` in `src/app.js`) that accepts injected service instances, making the entire stack testable without a live database connection.

```
src/server.js          — creates http.Server, attaches Socket.IO
src/app.js             — Express factory, registers all routers
src/db.js              — node-postgres connection pool wrapper
src/errors.js          — HttpError class mapped to HTTP status codes
src/http/
  request-auth.js      — optionalRequestUser / requiredRequestUser middleware
  query.js             — cursor pagination helpers
src/<domain>/
  *.service.js         — all database queries
  *.routes.js          — HTTP method → service call wiring
  *.validation.js      — input parsing and HttpError throws
```

Every service class receives a single `db` handle; no global database state exists. All async route handlers are wrapped with a local `asyncRoute` helper that forwards thrown `HttpError` instances to Express's error middleware, which converts them to the correct HTTP status code and JSON shape.

---

## 11. Authentication and Session Management

Authentication is cookie-based with server-side hashing. On login or registration the server generates a cryptographically random 32-byte token, stores only its SHA-256 hash in `auth_sessions`, and sets an `HttpOnly` session cookie. The raw token is never persisted — a database breach exposes only useless hashes.

```
POST /api/auth/login
  → bcrypt.compare(password, stored_hash)
  → crypto.randomBytes(32) → token
  → SHA-256(token) → stored in auth_sessions with expires_at
  → Set-Cookie: reddit_session=<token>; HttpOnly; SameSite; Secure
```

Session resolution on subsequent requests queries `auth_sessions JOIN users WHERE token_hash = $1 AND expires_at > NOW()`. Cookie security attributes are environment-driven:

- **Local development** — `SameSite=Lax; Secure=false` (from `.env`)
- **Railway production** — `SameSite=None; Secure=true` applied automatically when `RAILWAY_*` environment variables are detected, enabling cross-site cookies between the Vite frontend and API domains without manual configuration.

Two middleware helpers in `src/http/request-auth.js` provide consistent auth checks across all route files: `optionalRequestUser` (returns `null` for guests) and `requiredRequestUser` (throws `HttpError(401)` when no valid session exists).

---

## 12. Database Layer and Migrations

`src/db.js` wraps `node-postgres` in a thin object exposing `query(text, params)` and `transaction(fn)`. The transaction helper acquires a client, runs `BEGIN`/`COMMIT`/`ROLLBACK` automatically, and releases the client in a `finally` block — callers never manage connections directly.

All schema changes live in numbered SQL files under `migrations/`. The runner (`scripts/migrate.js`) reads every `.sql` file alphabetically and executes each with `db.query()`. All statements use `IF NOT EXISTS` guards (or PL/pgSQL `DO $$` blocks for constructs like `ADD CONSTRAINT` that lack that clause), making every migration idempotent and safe to re-run on each deployment.

| Migration | Change |
|---|---|
| 001 | `users`, `auth_sessions` — identity and hashed session tokens |
| 002 | `user_profiles` — display name, bio, `avatar_url`, banner colour |
| 003 | `communities`, `posts`, `post_votes`, `saved_posts`, `user_follows`, messages, `notifications` |
| 004 | Remove `CHECK (vote_count >= 0)` to allow negative scores |
| 005 | Message read state, reactions tables for community and direct messages |
| 006 | `related_user_id` on `notifications`; partial unique index for `mutual_follow` dedup |
| 007 | `recommendation_events` — view/upvote/search signals with partial unique indexes enabling `INSERT … ON CONFLICT DO UPDATE` upserts |
| 008 | `avatar_original_url TEXT`, `avatar_crop JSONB` on `user_profiles` for crop re-edit persistence |

**Key schema decisions:**

- *Soft deletion* — `posts.visibility` column; deleted posts stay in the database but are filtered at query time with `WHERE visibility = 'public'`.
- *Partial unique indexes* — used in migrations 006 and 007 to enable conflict-targeted upserts without full-table uniqueness constraints.
- *JSONB for crop metadata* — avatar crop coordinates are stored as opaque JSON. The backend stores and returns the object verbatim; it does not interpret the coordinate values, keeping the API decoupled from vue-advanced-cropper's internal format.

---

## 13. REST API Design

### Pagination

All list endpoints use opaque cursor pagination. The cursor encodes an integer offset, preventing clients from treating it as a page number. Every list response includes `nextCursor: string | null`. The backend fetches `limit + 1` rows; if the extra row exists it returns `limit` rows and a cursor, otherwise `nextCursor` is `null`.

### Home Feed Ranking

Five sort modes are implemented as inline PostgreSQL expressions — no materialised cache:

| Sort | SQL logic |
|---|---|
| `best` | `vote_count + comment_count * 2 + reaction_count * 2` |
| `hot` | best score divided by `POWER(hours_since_created + 2, 1.35)` |
| `new` | `created_at DESC` |
| `top` | `vote_count DESC` |
| `rising` | best score restricted to posts younger than 48 hours |

### Recommendation Events

`POST /api/recommendations/events` records a single user interaction. For `view`/`upvote` events, the upsert conflicts on `(user_id, post_id, type)`; for `search` events it conflicts on `(user_id, keyword)`. In both cases `created_at` is refreshed to `NOW()`, replicating the client-side localStorage "move to front" deduplication. `GET /api/recommendations/history` runs three parallel queries (via `Promise.all`) and enforces 50/50/20 caps with `LIMIT` at read time.

### Profile Avatar

`PATCH /api/me/avatar` persists `{ avatarUrl, originalUrl, crop }` into `user_profiles` using an `INSERT … ON CONFLICT (user_id) DO UPDATE` upsert. Images are never uploaded to or served from the database — the frontend uploads files directly to Cloudinary and sends only HTTPS URLs to the backend. `avatarOriginalUrl` and `avatarCrop` are returned exclusively to the authenticated owner via `GET /api/me/avatar`; public profile responses expose only `avatarUrl`.

---

## 14. Socket.IO Server

The Socket.IO server is created in `src/chat/socket.js` and attached to the same `http.Server` instance as Express in `src/server.js`, so both transports share one port.

**Authentication middleware** runs on every connection before any event is processed:

```js
io.use(async (socket, next) => {
  const token = /* parse session cookie from handshake headers */
  const session = await authService.session(token)
  socket.userId = session.user.id
  socket.username = session.user.username
  next()   // unauthenticated → next(error) disconnects immediately
})
```

**Community rooms** use Socket.IO named rooms (`community:${name}`). Community membership is re-validated at both `community:join` and `community:message:send`, so a user removed from a community between their join ack and their send is rejected at send time.

**Direct message gating** requires mutual follow on every `direct:join` and `direct:message:send`. When a follow action completes a mutual relationship, the server emits `direct:conversation` to both users' sockets immediately, enabling the inbox without requiring a page refresh.

**Read receipts differ by channel type:**

- Community — `seenByCount` running total; broadcast to all room members on `community:read`.
- Direct — per-message `seen` boolean and `seenAt` timestamp; broadcast to both participants on `direct:read`.

All mutating socket events return an acknowledgement with `{ success: true }` or `{ success: false, error }`. The client-side `emitSocketEvent` helper wraps these in a Promise with an 8-second hard timeout, allowing views to `await` and handle errors uniformly.

---

## 15. Deployment Configuration

The application runs on Railway. Key environment variables:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string — never exposed to frontend |
| `FRONTEND_ORIGIN` | Exact frontend origin for CORS and cookie SameSite validation |
| `COOKIE_SECURE` / `COOKIE_SAME_SITE` | Override Railway auto-detection defaults (`true` / `none`) |
| `SESSION_TTL_SECONDS` | Default 2 592 000 (30 days) |
| `PORT` | Supplied by Railway at runtime |

The frontend Vite dev server proxies `/api` and `/socket.io` to the Railway backend, making all requests same-origin in the browser and eliminating cross-site cookie restrictions during local development. `helmet` sets secure HTTP headers on every response; `cors` restricts `Access-Control-Allow-Origin` to the configured frontend origin only. Public read endpoints (`/api/profiles`, `/api/posts`, `/api/communities`, `/api/chats`) are rate-limited via `express-rate-limit` with configurable window and request-count environment variables.
