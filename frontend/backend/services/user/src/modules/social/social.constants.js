'use strict';

/**
 * Chat rooms, mapped to the models that hold them.
 *
 * Chat is genuinely stored per room — `chat_global` and `chat_brazil` are real
 * tables. Legacy's `"chat_" + country` was guarded by a real allowlist checked
 * first, so it was safe; a map is used here anyway so the room never reaches a
 * string concatenation at all, and so the same helper serves the rain
 * recipients, where legacy's equivalent was NOT guarded.
 */
const CHAT_ROOMS = Object.freeze({
  global: 'ChatGlobal',
  brazil: 'ChatBrazil',
});

/**
 * The label a room is broadcast under.
 *
 * Legacy renamed one on the way out and nowhere else:
 *
 *     if (_.lowerCase(c) === "brazil") c = "spam";
 *
 * So the Brazil room is called `brazil` in the table name and `spam` in every
 * message the clients receive. Kept, because the clients filter on it.
 */
const ROOM_LABELS = Object.freeze({ global: 'global', brazil: 'spam' });

/**
 * The longest chat message.
 *
 * Legacy had no limit anywhere — `message` went from the socket into the table
 * and out to every connected client unbounded.
 */
const MAX_MESSAGE_LENGTH = 500;

/** The longest private message. Same reasoning. */
const MAX_PRIVATE_MESSAGE_LENGTH = 2000;

/** How many messages one read returns. Legacy's chat read had no limit either. */
const MAX_CHAT_HISTORY = 100;

/**
 * How many friends one account may hold.
 *
 * `users.friends` is a comma-separated TEXT column — the whole list is read,
 * appended to and written back on every add. Without a ceiling that string
 * grows without bound and every add rewrites all of it.
 */
const MAX_FRIENDS = 500;

module.exports = {
  CHAT_ROOMS,
  ROOM_LABELS,
  MAX_MESSAGE_LENGTH,
  MAX_PRIVATE_MESSAGE_LENGTH,
  MAX_CHAT_HISTORY,
  MAX_FRIENDS,
};
