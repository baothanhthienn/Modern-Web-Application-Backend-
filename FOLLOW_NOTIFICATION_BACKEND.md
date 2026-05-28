# Mutual Follow Notification Backend Handoff

## Goal

When two users follow each other, the backend should create a notification so
the frontend can show that direct chat is now available.

This is separate from the existing `post_created` notification flow.

## User-facing Behavior

Example:

1. `u/alice` follows `u/bob`
2. `u/bob` follows `u/alice`
3. The relationship is now mutual
4. Both users should see a notification that they can chat
5. Clicking the notification should open the inbox thread with the other user

Frontend target route:

```text
/inbox?with=<other-username>
```

## Recommended Notification Type

Add a dedicated notification type:

```text
mutual_follow
```

The frontend already supports fallback aliases, but `mutual_follow` should be
the canonical backend value.

## Recommended Message

Use a user-facing message similar to:

```text
You and u/<username> now follow each other. You can start chatting.
```

The exact message text is flexible. The frontend displays the backend message
verbatim.

## Required API Response Shape

Extend `GET /api/notifications` items so mutual-follow notifications include a
target username.

Recommended item shape:

```json
{
  "id": 42,
  "type": "mutual_follow",
  "message": "You and u/bob now follow each other. You can start chatting.",
  "postId": null,
  "actor": "bob",
  "targetUsername": "bob",
  "read": false,
  "createdAt": "2026-05-26T10:20:30.000Z"
}
```

Notes:

- `actor` should be the other user involved in the mutual follow.
- `targetUsername` should also be the other user, so the frontend can route to
  `/inbox?with=<targetUsername>`.
- Keep `postId` as `null` for non-post notifications.

## Backend Trigger Point

Current follow logic already detects a mutual follow in:

```text
src/social/social.service.js
```

Current behavior:

- `follow()` inserts the follow row
- checks whether the reverse follow already exists
- calls `this.onMutualFollow(...)` when mutual

That is the correct place to create the notification.

## Recommended Implementation

When mutual follow is established, insert notifications for both users.

Suggested behavior:

1. User A follows User B
2. Reverse follow already exists
3. Insert one notification for User A about User B
4. Insert one notification for User B about User A

This keeps both inboxes and notifications aligned with the new ability to chat.

## Suggested Database Write

Assuming the existing `notifications` table already supports:

- `user_id`
- `type`
- `actor_id`
- `post_id`
- `message`
- `created_at`
- `read_at`

then no schema change is required if the frontend can derive the target user
from `actor`.

If you want the API response to include `targetUsername` directly, the backend
can compute it during serialization without adding a new column.

## Suggested Serializer Update

Current notification serialization returns:

```json
{
  "id": 1,
  "type": "post_created",
  "message": "Your post has been published.",
  "postId": 1,
  "actor": "sample_user",
  "read": false,
  "createdAt": "2026-05-25T03:15:00.000Z"
}
```

Please extend it to also return:

```json
{
  "targetUsername": "other_user"
}
```

for mutual-follow notifications.

Recommended rule:

- for `mutual_follow`, set `targetUsername` to the other user
- for existing post notifications, omit it or return `null`

## Frontend Status

The frontend has already been updated to support:

- `type: "mutual_follow"`
- fallback aliases `follow_matched` and `chat_unlocked`
- routing those notifications to `/inbox?with=<username>`
- reading username from `targetUsername`, `username`, or `actor`

Canonical backend output should still use:

```text
type = "mutual_follow"
targetUsername = "<other-username>"
```

## Test Cases To Add

1. Non-mutual follow does not create a notification
2. Mutual follow creates notifications for both users
3. `GET /api/notifications` returns the new item with:
   - `type = mutual_follow`
   - `postId = null`
   - `actor = other username`
   - `targetUsername = other username`
4. Clicking the frontend notification opens `/inbox?with=<other-username>`
5. Repeated follow requests do not create duplicate mutual-follow notifications

