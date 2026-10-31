'use strict';

const { Op } = require('sequelize');

const E = require('./clubBroadcasts.errors');
const { BannerImageStore } = require('./imageStore');
const { CHANNEL, MAX_BANNERS_PER_CLUB } = require('./clubBroadcasts.constants');

/**
 * Club banners and the notifications that announce them.
 *
 * Twelve routes that have never worked: all six tables behind them are missing
 * from the schema (migration 019), so every one returned 500. That is the same
 * story as `club_memberships` in migration 014 — the club feature as a whole
 * has never run.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * THE IMAGE ROUTE WAS A PATH TRAVERSAL
 *
 * `GET /clubs/banner-image/:imagePath(*)` joined a WILDCARD path parameter onto
 * a storage root with no containment check and no authentication. See
 * `imageStore.js` — it is the most serious thing in this module and it is
 * fixed there, once, rather than at each call site.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * EVERYTHING WAS WRITTEN TWICE
 *
 * Free-standing notifications and banner notifications have identical logic and
 * two sets of tables, and legacy implemented the sender, the fan-out, the
 * listing and the read receipt separately for each. The copies had already
 * drifted: the banner sender required the club to be `is_active`, the plain one
 * did not, so a deactivated club could still broadcast through one of the two
 * routes. `CHANNEL` in the constants file is what lets one implementation serve
 * both.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * OWNERSHIP CAME FROM THE REQUEST BODY
 *
 *     const { ownerId, title } = req.body;
 *     SELECT unique_club_id FROM clubs WHERE id = $1 AND owner_id = $2
 *
 * The query looks like an authorisation check, and it is not — `ownerId` was
 * supplied by the caller, so anyone could name the real owner and pass it. The
 * actor comes from the token here.
 */
class ClubBroadcastsService {
  constructor({ models, db, config, logger, images }) {
    this.models = models;
    this.db = db;
    this.config = config;
    this.logger = logger;
    this.images =
      images ?? new BannerImageStore({ root: config.CLUB_BANNER_STORAGE_DIR, logger });
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Banners
  // ══════════════════════════════════════════════════════════════════════

  /** @legacy POST /clubbanner/clubs/:clubId/banners */
  async createBanner({ clubId, actorId, title, image }) {
    const club = await this.#assertOwner(clubId, actorId);

    const count = await this.models.ClubBanner.count({ where: { club_id: clubId, is_active: true } });
    if (count >= MAX_BANNERS_PER_CLUB) throw E.TOO_MANY_BANNERS({ max: MAX_BANNERS_PER_CLUB });

    const stored = await this.images.write({ clubKey: club.unique_club_id ?? String(club.id), buffer: image });

    const banner = await this.models.ClubBanner.create({
      club_id: clubId,
      title,
      image_path: stored.storedPath,
      is_active: true,
    });

    return banner.get({ plain: true });
  }

  /** @legacy PUT /clubbanner/clubs/:clubId/banners/:bannerId */
  async updateBanner({ clubId, bannerId, actorId, title, image }) {
    const club = await this.#assertOwner(clubId, actorId);
    const banner = await this.#findBanner(clubId, bannerId);

    const patch = {};
    if (title !== undefined) patch.title = title;

    let previous = null;
    if (image) {
      const stored = await this.images.write({ clubKey: club.unique_club_id ?? String(club.id), buffer: image });
      patch.image_path = stored.storedPath;
      previous = banner.image_path;
    }

    // `COALESCE($1, title)` in legacy meant an explicitly-empty title silently
    // kept the old one. An absent field keeps it; a supplied one replaces it.
    if (!Object.keys(patch).length) return banner;

    await this.models.ClubBanner.update(patch, { where: { id: bannerId, club_id: clubId } });

    // The old file goes only after the row points at the new one, so a failure
    // never leaves a row referencing a file that is gone.
    if (previous) await this.images.remove(previous);

    return this.#findBanner(clubId, bannerId);
  }

  /**
   * @legacy DELETE /clubbanner/clubs/:clubId/banners/:bannerId
   *
   * Deactivated rather than deleted. A notification already sent about this
   * banner still refers to it, and a hard delete leaves those pointing at
   * nothing.
   */
  async removeBanner({ clubId, bannerId, actorId }) {
    await this.#assertOwner(clubId, actorId);
    await this.#findBanner(clubId, bannerId);

    await this.models.ClubBanner.update(
      { is_active: false },
      { where: { id: bannerId, club_id: clubId } }
    );

    return { bannerId: Number(bannerId), removed: true };
  }

  /**
   * @legacy GET /clubbanner/clubs/:clubId/banners
   *
   * A MEMBER may read the list. Legacy required no membership at all, so any
   * club's banners were readable by anyone who knew its id.
   */
  async listBanners({ clubId, actorId }) {
    await this.#assertMember(clubId, actorId);

    return this.models.ClubBanner.findAll({
      where: { club_id: clubId, is_active: true },
      order: [['created_at', 'DESC']],
      raw: true,
    });
  }

  /** @legacy GET /clubbanner/clubs/banner-image/:imagePath(*) — a path traversal */
  async readImage({ storedPath, actorId }) {
    /**
     * Membership is checked BEFORE the file is touched.
     *
     * The path is `<clubKey>/<name>`, so the club it belongs to is derivable —
     * and a banner is club-private content. Legacy served any path to anyone.
     */
    const [clubKey] = String(storedPath).split('/');

    const banner = await this.models.ClubBanner.findOne({
      where: { image_path: { [Op.like]: `${clubKey}/%` } },
      attributes: ['club_id'],
      raw: true,
    });

    if (!banner) throw E.IMAGE_NOT_FOUND();
    await this.#assertMember(banner.club_id, actorId);

    return this.images.read(storedPath);
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Notifications — one implementation, two channels
  // ══════════════════════════════════════════════════════════════════════

  /**
   * @legacy POST /clubnotification/clubs/:clubId/notifications
   * @legacy POST /clubbanner/clubs/:clubId/banners/:bannerId/notify
   */
  async send({ channel, clubId, bannerId, actorId, title, body, type, additionalData }) {
    const spec = CHANNEL[channel];
    await this.#assertOwner(clubId, actorId);

    if (spec.hasBanner) await this.#findBanner(clubId, bannerId);

    const members = await this.models.ClubMembership.findAll({
      where: { club_id: clubId },
      attributes: ['user_id'],
      raw: true,
    });

    const result = await this.db.transaction(async (transaction) => {
      const notification = await this.models[spec.notifications].create(
        {
          club_id: clubId,
          sender_id: actorId,
          title,
          body: body ?? null,
          type: type ?? (spec.hasBanner ? 'banner' : 'general'),
          additional_data: additionalData ?? null,
          ...(spec.hasBanner ? { banner_id: bannerId } : {}),
        },
        { transaction }
      );

      if (members.length) {
        /**
         * One delivery row per member, in ONE statement.
         *
         * Legacy looped and inserted per member — a query per member of a club
         * that can hold hundreds — with no constraint, so a resend produced a
         * second row per member and the read receipt then updated whichever
         * one it found. `updateOnDuplicate` against the unique key from
         * migration 019 makes a resend an upsert.
         */
        await this.models[spec.status].bulkCreate(
          members.map((m) => ({
            notification_id: notification.id,
            user_id: m.user_id,
            is_sent: true,
            sent_at: new Date(),
          })),
          { transaction, updateOnDuplicate: ['is_sent', 'sent_at'] }
        );
      }

      return notification.get({ plain: true });
    });

    /**
     * Push delivery is deliberately NOT part of the transaction.
     *
     * The notification is recorded whether or not a device is reachable, and a
     * push failure must not roll back the record — a member who opens the app
     * later still sees it. `user_fcm_tokens` is the token store; wiring it to a
     * real push transport is one dependency in the container.
     */
    const tokens = await this.#activeTokens(members.map((m) => Number(m.user_id)));
    this.logger?.info(
      { clubId, channel, recipients: members.length, devices: tokens.length },
      'Club broadcast recorded'
    );

    return { ...result, recipients: members.length, devices: tokens.length };
  }

  /**
   * @legacy GET /clubnotification/clubs/:clubId/notifications
   * @legacy GET /clubbanner/clubs/:clubId/banner-notifications
   *
   * A member's own view: the club's notifications with THEIR read state.
   * Legacy returned the raw notification rows with no per-member state at all,
   * so "unread" was unanswerable from the endpoint that was supposed to answer
   * it.
   */
  async list({ channel, clubId, actorId, limit, offset }) {
    const spec = CHANNEL[channel];
    await this.#assertMember(clubId, actorId);

    const { rows, count } = await this.models[spec.notifications].findAndCountAll({
      where: { club_id: clubId },
      order: [['created_at', 'DESC']],
      limit,
      offset,
      raw: true,
    });

    if (!rows.length) return { rows: [], total: count };

    const state = await this.models[spec.status].findAll({
      where: { notification_id: { [Op.in]: rows.map((r) => r.id) }, user_id: actorId },
      raw: true,
    });

    const byId = new Map(state.map((s) => [Number(s.notification_id), s]));

    return {
      rows: rows.map((row) => ({
        ...row,
        is_read: Boolean(byId.get(Number(row.id))?.is_read),
        read_at: byId.get(Number(row.id))?.read_at ?? null,
      })),
      total: count,
    };
  }

  /**
   * @legacy PUT /clubnotification/clubs/notifications/:notificationId/read
   * @legacy PUT /clubbanner/clubs/banner-notifications/:notificationId/read
   *
   * The player marks THEIR OWN copy read. Legacy took `userId` from the body,
   * so anyone could mark anyone's notifications as read.
   */
  async markRead({ channel, notificationId, actorId }) {
    const spec = CHANNEL[channel];

    const [changed] = await this.models[spec.status].update(
      { is_read: true, read_at: new Date() },
      // Conditional on it not already being read, so `read_at` records the
      // FIRST time it was seen rather than the most recent poll.
      { where: { notification_id: notificationId, user_id: actorId, is_read: false } }
    );

    if (!changed) {
      // Either it was already read, or there is no delivery row for this
      // player — which means it was not addressed to them.
      const exists = await this.models[spec.status].count({
        where: { notification_id: notificationId, user_id: actorId },
      });
      if (!exists) throw E.NOTIFICATION_NOT_FOUND({ notificationId });
    }

    return { notificationId: Number(notificationId), read: true };
  }

  // ══════════════════════════════════════════════════════════════════════

  /** The club, if this actor owns it. */
  async #assertOwner(clubId, actorId) {
    const club = await this.models.Clubs.findOne({ where: { id: clubId }, raw: true });
    if (!club) throw E.CLUB_NOT_FOUND({ clubId });

    // Compared against the TOKEN's id. Legacy compared against an `ownerId`
    // taken from the request body, which is not a check.
    if (Number(club.owner_id) !== Number(actorId)) throw E.NOT_CLUB_OWNER({ clubId });

    return club;
  }

  async #assertMember(clubId, actorId) {
    const membership = await this.models.ClubMembership.findOne({
      where: { club_id: clubId, user_id: actorId },
      raw: true,
    });
    if (!membership) throw E.NOT_A_MEMBER({ clubId });
    return membership;
  }

  async #findBanner(clubId, bannerId) {
    const banner = await this.models.ClubBanner.findOne({
      where: { id: bannerId, club_id: clubId },
      raw: true,
    });
    if (!banner) throw E.BANNER_NOT_FOUND({ bannerId });
    return banner;
  }

  async #activeTokens(userIds) {
    if (!userIds.length) return [];
    return this.models.UserFcmToken.findAll({
      where: { user_id: { [Op.in]: userIds }, is_active: true },
      attributes: ['user_id', 'token'],
      raw: true,
    });
  }
}

module.exports = { ClubBroadcastsService };
