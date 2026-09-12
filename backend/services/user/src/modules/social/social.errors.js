'use strict';

const { defineErrors } = require('@ibitplay/common');

module.exports = defineErrors('SOCIAL', {
  UNKNOWN_ROOM: { status: 422, message: 'No such chat room' },

  EMPTY_MESSAGE: {
    status: 422,
    /**
     * Legacy checked `message === ""` and `message === " "` as separate
     * literals, then trimmed and checked both again — four comparisons that a
     * single trim-and-test covers, and none of which caught a tab.
     */
    message: 'A message cannot be empty',
  },

  MESSAGE_TOO_LONG: {
    status: 422,
    // Legacy had no bound anywhere: socket to table to every connected client.
    message: 'That message is too long',
  },

  MUTED: {
    status: 403,
    /**
     * Legacy did `if (muted === true) return;` AFTER having already called
     * back with the message — so a muted player saw their own message
     * broadcast and only the database write was skipped.
     */
    message: 'You cannot post in chat',
  },

  PLAYER_NOT_FOUND: { status: 404, message: 'No such player' },

  INVALID_AVATAR: {
    status: 422,
    /**
     * Legacy did `UPLOAD_URL + avatar` with no check, so `../` segments and a
     * whole different origin both survived the concatenation — and the result
     * is rendered on every chat message that player sends.
     */
    message: 'An avatar must be a plain filename',
  },

  CANNOT_FRIEND_SELF: { status: 422, message: 'You cannot add yourself' },

  CANNOT_MESSAGE_SELF: { status: 422, message: 'You cannot message yourself' },

  TOO_MANY_FRIENDS: {
    status: 422,
    /**
     * `users.friends` is a comma-separated TEXT column read, appended to and
     * written back on every add. Unbounded, that string grows forever and
     * every add rewrites all of it.
     */
    message: 'You have reached the maximum number of friends',
  },
});
