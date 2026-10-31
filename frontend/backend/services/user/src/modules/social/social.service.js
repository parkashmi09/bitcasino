'use strict';

const { Op, fn, col, where } = require('sequelize');

const errors = require('./social.errors');
const {
  CHAT_ROOMS,
  ROOM_LABELS,
  MAX_MESSAGE_LENGTH,
  MAX_PRIVATE_MESSAGE_LENGTH,
  MAX_CHAT_HISTORY,
  MAX_FRIENDS,
} = require('./social.constants');

/**
 * Chat, friends and private messages.
 */
class SocialService {
  constructor({ models, db, logger, config }) {
    this.models = models;
    this.db = db;
    this.logger = logger;
    /** `setAvatar` reads `AVATAR_BASE_URL` — legacy had it as a module constant. */
    this.config = config ?? {};
  }

  /** The model for a room, or a refusal. Never a concatenated table name. */
  #roomModel(room) {
    const key = String(room ?? '').trim().toLowerCase();
    const modelName = CHAT_ROOMS[key];
    if (!modelName) throw errors.UNKNOWN_ROOM({ room: key });

    const model = this.models[modelName];
    if (!model) throw errors.UNKNOWN_ROOM({ room: key });

    return { key, model };
  }

  /**
   * @legacy SOCKET 1e6ccf0ddced017179b173e5cc78beea
   *
   * `C.ADD_CHAT` — post a message to a room.
   *
   * ─────────────────────────────────────────────────────────────────────
   * STORED FIRST, BROADCAST SECOND
   *
   * Legacy called back — which the handler turned into `io.emit` to every
   * connected client — and THEN ran the INSERT. A failed insert meant every
   * player had already seen a message that does not exist.
   *
   * The row is written here and the payload returned for the caller to
   * broadcast, so a message that reaches the room is a message that is in the
   * table.
   * ─────────────────────────────────────────────────────────────────────
   */
  async postChat({ userId, room, message }) {
    const text = String(message ?? '').trim();
    if (!text) throw errors.EMPTY_MESSAGE();
    if (text.length > MAX_MESSAGE_LENGTH) throw errors.MESSAGE_TOO_LONG({ max: MAX_MESSAGE_LENGTH });

    const { key, model } = this.#roomModel(room);

    const user = await this.models.Users.findOne({
      where: { id: userId },
      attributes: ['id', 'name', 'avatar', 'muted', 'level', 'status'],
      raw: true,
    });
    // Legacy's equivalent branch referenced an undefined `err` and threw.
    if (!user) throw errors.PLAYER_NOT_FOUND({ userId });

    /**
     * A muted player's message is REFUSED, not silently dropped.
     *
     * Legacy did `if (muted === true) return;` — after having already called
     * back with the message, so a muted player saw their own message broadcast
     * and only the database write was skipped.
     */
    if (user.muted === true) throw errors.MUTED();
    if (user.status === 'closed') throw errors.MUTED();

    const now = new Date();
    /**
     * `sorter` is the NOT NULL numeric these tables order on — they have no
     * `id` column. Milliseconds since the epoch, as legacy used.
     */
    const sorter = now.getTime();

    await model.create({
      name: user.name,
      uid: user.id,
      avatar: user.avatar ?? null,
      message: text,
      time: now.toISOString().slice(11, 19),
      sorter,
      level: user.level ?? 1,
    });

    return {
      // The label the clients filter on — `brazil` is broadcast as `spam`.
      country: ROOM_LABELS[key] ?? key,
      room: key,
      message: text,
      name: user.name,
      uid: String(user.id),
      avatar: user.avatar ?? null,
      level: Number(user.level ?? 1),
      sorter,
      date: now.toISOString(),
    };
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Moderation — the four handlers from `legacy/Admin/index.js`
  //
  //  Their entire authorisation was `if (!privates) return;`, where `privates`
  //  is a field in the message the CLIENT sends. Sending `{privates: true}`
  //  satisfied it. See `sockets.js` and `docs/SOCKETS.md`.
  // ══════════════════════════════════════════════════════════════════════

  /**
   * Mute or unmute a player.
   *
   * @legacy SOCKET eca6e08ddde39e22f965270b7d8175d17 (C.ADMIN_SET_MUTE)
   *
   * ── LEGACY TOGGLED, AND CRASHED ON A BAD NAME ────────────────────────
   *
   *     UserRule.getUserInfoByName(name, (result, error) => {
   *       let id = _.toNumber(result.id);        // ← `result` is undefined
   *       let muted = result.muted;              //    when the name is unknown
   *       ... set = muted ? false : true
   *
   * The `error` parameter is destructured and never read, so an unknown name
   * reaches `result.id` on `undefined` and throws inside a pg callback — an
   * unhandled rejection, which takes the process down.
   *
   * And it TOGGLED rather than setting. Two operators muting the same player at
   * the same time leave them unmuted, and an operator cannot express "make sure
   * this player is muted" — only "flip whatever it currently is".
   */
  async setMute({ staff, name, muted }) {
    const user = await this.models.Users.findOne({
      where: { [Op.and]: [where(fn('LOWER', col('name')), String(name ?? '').toLowerCase())] },
      attributes: ['id', 'name', 'muted'],
    });

    if (!user) throw errors.PLAYER_NOT_FOUND({ name });

    // Set, not toggle. `muted` is required by the validator, so there is no
    // "flip it" path to fall back to.
    await user.update({ muted: Boolean(muted) });

    this.logger?.warn(
      { staffId: staff?.id, userId: String(user.id), name: user.name, muted: Boolean(muted) },
      'Player mute changed'
    );

    return { uid: String(user.id), name: user.name, muted: Boolean(muted) };
  }

  /**
   * Set a player's avatar.
   *
   * @legacy SOCKET 15e76a8d237dd050a301d1f33967175a (C.ADMIN_ADD_AVATAR)
   *
   *     let fullAvatar = UPLOAD_URL + avatar;
   *     UPDATE users SET avatar = $1 WHERE name = $2
   *
   * `avatar` is concatenated onto a base URL with no validation, so the stored
   * value is whatever the message said — including `../` segments, or a whole
   * different origin if the value started with `http`, since string
   * concatenation does not care. The avatar is then rendered on every chat
   * message that player sends.
   *
   * The path is bounded here and the base URL comes from configuration rather
   * than a module constant.
   */
  async setAvatar({ staff, name, avatar }) {
    const file = String(avatar ?? '').trim();

    /**
     * A filename, not a path and not a URL. Legacy accepted anything and
     * prefixed it; `..` or a scheme both survived that unchanged.
     */
    if (!/^[A-Za-z0-9._-]{1,120}$/.test(file) || file.includes('..')) {
      throw errors.INVALID_AVATAR({ avatar: file.slice(0, 40) });
    }

    const user = await this.models.Users.findOne({
      where: { [Op.and]: [where(fn('LOWER', col('name')), String(name ?? '').toLowerCase())] },
      attributes: ['id', 'name', 'avatar'],
    });

    if (!user) throw errors.PLAYER_NOT_FOUND({ name });

    const base = String(this.config?.AVATAR_BASE_URL ?? '').replace(/\/+$/, '');
    await user.update({ avatar: base ? `${base}/${file}` : file });

    this.logger?.info({ staffId: staff?.id, userId: String(user.id), file }, 'Player avatar set');
    return { uid: String(user.id), name: user.name, avatar: user.avatar };
  }

  /**
   * Post a chat message as a named player.
   *
   * @legacy SOCKET 2118e57f1f2bb7979c9a7796d6be671d (C.ADMIN_ADD_CHAT)
   *
   * A house-account message — the platform announcing something in chat under
   * a persona. Distinct from `postChat`, which is a player speaking as
   * themselves.
   *
   * Legacy's version reached `results.rows[0].avatar` after checking
   * `if (results === 'undefined')` — a comparison against the STRING
   * `'undefined'`, which is never true for a pg result object. So an unknown
   * player threw on `rows[0]` being undefined, in a callback, unhandled.
   *
   * It also skipped the mute check that `postChat` applies, so a muted persona
   * could still be made to speak. That is arguably correct for an operator
   * action and is stated here rather than left implicit.
   */
  async postChatAs({ staff, name, room, message }) {
    const user = await this.models.Users.findOne({
      where: { [Op.and]: [where(fn('LOWER', col('name')), String(name ?? '').toLowerCase())] },
      attributes: ['id'],
      raw: true,
    });

    if (!user) throw errors.PLAYER_NOT_FOUND({ name });

    this.logger?.info({ staffId: staff?.id, as: name, room }, 'Operator posted a chat message');

    /**
     * Straight through `postChat`, so the length limit, the room allowlist and
     * the write-then-broadcast ordering are the same ones a player gets. The
     * mute check comes with them — an operator posting as a muted persona is
     * refused, which is a narrower behaviour than legacy's and the safer
     * default to start from.
     */
    return this.postChat({ userId: user.id, room, message });
  }

  /**
   * @legacy SOCKET 7a7fe97bbc5ff21a561b79986db975c5
   *
   * `C.CHATS` — recent messages in a room.
   *
   * ─────────────────────────────────────────────────────────────────────
   * THIS ONE HAD NO AUTH CHECK IN LEGACY
   *
   *     client.on(C.CHATS, (data) => {
   *       let { country } = decode(data);
   *       Rule.getChats(country, (result) => {
   *
   * No `if (!id) return;` — one of two handlers in `Users/index.js` that
   * omits it. Reading a public chat room without being signed in is defensible,
   * and it stays a PUBLIC event here — but by declaration rather than by
   * omission, which is the difference between a decision and an oversight.
   * ─────────────────────────────────────────────────────────────────────
   */
  async listChat({ room, limit = 50 }) {
    const { key, model } = this.#roomModel(room);

    const rows = await model.findAll({
      order: [['sorter', 'DESC']],
      limit: Math.min(Number(limit) || 50, MAX_CHAT_HISTORY),
      raw: true,
    });

    return {
      room: key,
      country: ROOM_LABELS[key] ?? key,
      // Oldest first, which is how a chat window renders.
      rows: rows.reverse().map((row) => ({
        uid: String(row.uid),
        name: row.name,
        avatar: row.avatar ?? null,
        message: row.message,
        level: Number(row.level ?? 1),
        sorter: Number(row.sorter),
        date: row.date ?? null,
      })),
    };
  }

  /**
   * @legacy SOCKET 265ea6ce905188a0751e8f0273d30bb7
   *
   * `C.ADD_FRIEND`.
   *
   * `users.friends` is a comma-separated TEXT column, which is legacy's shape
   * and not one this port can change without a data migration touching every
   * row. What it CAN do is bound it and stop it accumulating duplicates.
   */
  async addFriend({ userId, name }) {
    const wanted = String(name ?? '').trim();
    if (!wanted) throw errors.PLAYER_NOT_FOUND({ name });

    const friend = await this.models.Users.findOne({
      where: { name: wanted },
      attributes: ['id', 'name', 'status'],
      raw: true,
    });
    if (!friend || friend.status === 'closed') throw errors.PLAYER_NOT_FOUND({ name: wanted });
    if (String(friend.id) === String(userId)) throw errors.CANNOT_FRIEND_SELF();

    return this.db.transaction(async (transaction) => {
      /**
       * `FOR UPDATE`, because the column is read, appended to and written
       * back. Two concurrent adds without the lock lose one of themselves —
       * legacy had no lock and no transaction.
       */
      const me = await this.models.Users.findOne({
        where: { id: userId },
        attributes: ['id', 'friends'],
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (!me) throw errors.PLAYER_NOT_FOUND({ userId });

      const current = parseFriends(me.friends);
      if (current.includes(friend.name)) return { added: false, friends: current };
      if (current.length >= MAX_FRIENDS) throw errors.TOO_MANY_FRIENDS({ max: MAX_FRIENDS });

      const next = [...current, friend.name];
      await me.update({ friends: `${next.join(',')},` }, { transaction });

      return { added: true, friends: next };
    });
  }

  /**
   * @legacy SOCKET 1e73d7d857e371f00a56105a7a38a576
   *
   * `C.MY_FRIENDS`.
   */
  async listFriends({ userId }) {
    const me = await this.models.Users.findOne({
      where: { id: userId },
      attributes: ['friends'],
      raw: true,
    });
    if (!me) throw errors.PLAYER_NOT_FOUND({ userId });

    const names = parseFriends(me.friends);
    if (!names.length) return { friends: [] };

    const rows = await this.models.Users.findAll({
      where: { name: names },
      attributes: ['id', 'name', 'avatar', 'level'],
      raw: true,
    });

    return {
      friends: rows.map((row) => ({
        uid: String(row.id),
        name: row.name,
        avatar: row.avatar ?? null,
        level: Number(row.level ?? 1),
      })),
    };
  }

  /**
   * @legacy SOCKET 292d72d37f7e189059f7f998737de9bb
   *
   * `C.ADD_MESSAGES` — a private message.
   */
  async sendMessage({ userId, toName, message }) {
    const text = String(message ?? '').trim();
    if (!text) throw errors.EMPTY_MESSAGE();
    if (text.length > MAX_PRIVATE_MESSAGE_LENGTH) {
      throw errors.MESSAGE_TOO_LONG({ max: MAX_PRIVATE_MESSAGE_LENGTH });
    }

    const [me, recipient] = await Promise.all([
      this.models.Users.findOne({ where: { id: userId }, attributes: ['id', 'name'], raw: true }),
      this.models.Users.findOne({
        where: { name: String(toName ?? '').trim() },
        attributes: ['id', 'name', 'status'],
        raw: true,
      }),
    ]);

    if (!me) throw errors.PLAYER_NOT_FOUND({ userId });
    if (!recipient || recipient.status === 'closed') throw errors.PLAYER_NOT_FOUND({ name: toName });
    if (String(recipient.id) === String(me.id)) throw errors.CANNOT_MESSAGE_SELF();

    const now = new Date();

    await this.models.Messages.create({
      room_key: roomKey(me.id, recipient.id),
      from_uid: me.id,
      to_uid: recipient.id,
      from_name: me.name,
      to_name: recipient.name,
      message: text,
      time: now.toISOString().slice(11, 19),
      date: now,
    });

    return {
      to: String(recipient.id),
      toName: recipient.name,
      from: String(me.id),
      fromName: me.name,
      message: text,
      date: now.toISOString(),
    };
  }

  /**
   * @legacy SOCKET de70938879b75d3db63bba721c93e018
   *
   * `C.MESSAGES` — a conversation.
   *
   * Scoped to conversations the caller is IN. The `room_key` is derived from
   * the two ids rather than accepted from the message, so a caller cannot ask
   * for somebody else's thread.
   */
  async listMessages({ userId, withName, limit = 50 }) {
    const other = await this.models.Users.findOne({
      where: { name: String(withName ?? '').trim() },
      attributes: ['id', 'name'],
      raw: true,
    });
    if (!other) throw errors.PLAYER_NOT_FOUND({ name: withName });

    const rows = await this.models.Messages.findAll({
      where: { room_key: roomKey(userId, other.id) },
      order: [['date', 'DESC']],
      limit: Math.min(Number(limit) || 50, MAX_CHAT_HISTORY),
      raw: true,
    });

    return {
      with: { uid: String(other.id), name: other.name },
      rows: rows.reverse().map((row) => ({
        from: String(row.from_uid),
        fromName: row.from_name,
        message: row.message,
        date: row.date,
      })),
    };
  }
}

/**
 * The `friends` column, as a list.
 *
 * It is `"Support,"` for a new account and grows by concatenation, so the
 * trailing comma produces an empty entry that has to be dropped.
 */
function parseFriends(value) {
  return String(value ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
}

/**
 * The key for a two-party conversation.
 *
 * Sorted numerically so both directions produce the same key — otherwise a
 * reply starts a second thread and neither party sees the whole conversation.
 */
function roomKey(a, b) {
  return [Number(a), Number(b)].sort((x, y) => x - y).join(':');
}

module.exports = { SocialService, parseFriends, roomKey };
