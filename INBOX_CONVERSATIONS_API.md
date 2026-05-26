# Inbox Conversations API Requirement

## Missing Capability

The Inbox page must show every user who is currently authorized for direct chat: users who mutually follow the authenticated user. The current API supports:

- Follow and unfollow actions.
- Loading message history only when a username is already known.
- Sending and receiving live direct messages for a selected conversation.

It does not provide an endpoint to discover the authenticated user's mutual-follow conversations. The frontend cannot produce an accurate inbox list from individual profile/history endpoints without hardcoding usernames or scanning all users.

## Required Endpoint

```http
GET /api/chats/conversations?limit=30&cursor=<opaque-cursor>
Cookie: reddit_session=<session>
```

Requirements:

- Requires authentication.
- Returns only users for whom the current user and target user follow each other.
- Includes a conversation even when it has no messages yet, so a newly mutual-followed user appears immediately.
- Sorts conversations by latest message descending, with newly eligible conversations that have no message after messaged conversations.
- Does not expose email addresses or session data.

Success response:

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
      "unreadCount": 0
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

No matching conversations:

```json
{
  "success": true,
  "conversations": [],
  "nextCursor": null
}
```

No valid session:

```json
{
  "success": false,
  "error": "You must be logged in to view messages."
}
```

## Field Notes

| Field | Required | Purpose |
| --- | --- | --- |
| `username` | yes | Canonical conversation route and Socket.IO `direct:join` target. |
| `displayName` | yes, nullable | Friendly list label when profile metadata exists. |
| `avatarUrl` | yes, nullable | Inbox avatar without additional profile requests. |
| `lastMessage` | yes, nullable | Latest-message preview; same message shape as direct history. |
| `unreadCount` | recommended | Badge support. Return `0` until read-state storage exists. |

## Optional Read State

If unread counts become persistent, add:

```http
POST /api/chats/conversations/:username/read
```

The frontend can call this after it opens a visible conversation. Until then it treats a viewed thread as read only in memory.

## Realtime Conversation Availability

The REST endpoint populates Inbox on entry and refresh. To make an Inbox that is already open update immediately when a reciprocal follow makes a new chat eligible, the authenticated Socket.IO connection should also emit:

| Direction | Event | Payload |
| --- | --- | --- |
| server -> client | `direct:conversation` | `{ "conversation": Conversation }` |

`Conversation` uses the same object shape returned in `conversations`. Emit this event to both connected users when the second follow creates mutual authorization. It may also be emitted after a direct message updates the latest-message preview; the frontend merges it by `username`.

## Frontend Integration Already Added

The Vue Inbox requests `GET /api/chats/conversations` and renders:

- Mutual-follow conversation rows with latest-message previews.
- New mutual follows with an empty-thread prompt.
- `direct:conversation` updates so newly mutual users can appear without reloading an open Inbox.
- Realtime updates that move an active conversation to the top of the list.
- A search area retained for finding a user and opening a newly authorized chat.

Until this endpoint is implemented, the Inbox shows an API-pending explanation and still allows opening conversations by searching for a username or following an existing profile link.
