'use strict';

const { Op } = require('sequelize');

const errors = require('./banners.errors');
const { inspect } = require('./upload');
const { AGENT_PREFIX, modeOf } = require('./banners.constants');

/**
 * The banners on the front of the site.
 *
 * One row per placement, enforced by a unique index (migration 027) rather than
 * by convention — legacy INSERTed a new row on every create and then UPDATEd
 * every row of the type, so a placement accumulated indistinguishable
 * duplicates and only the newest was ever served.
 */
class BannersService {
  constructor({ models, db, logger }) {
    this.models = models;
    this.db = db;
    this.logger = logger;
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Writing
  // ══════════════════════════════════════════════════════════════════════

  /**
   * @legacy POST /api/banners/createBanner
   * @legacy POST /api/banners/updateBanner
   *
   * Both legacy routes did the same job through different, disagreeing paths:
   * create INSERTed a duplicate, update rewrote every row of the type. A
   * placement has one current image, so this is one operation.
   *
   * The bytes are inspected BEFORE anything is written, and `contentType` comes
   * from the signature that matched — not from the request.
   */
  async putBanner({ staff, type, label, title, subtitle, ctaLabel, ctaHref, sortOrder, file }) {
    /**
     * No file on an EXISTING placement is an edit of its copy: the image stays.
     * The admin's Replace form says "leave empty to keep the current one", and
     * without this an operator could not fix a typo in a headline without
     * re-uploading the picture. A placement that does not exist yet still needs
     * an image, so that case falls through to `inspect` and its NO_FILE.
     */
    if (!file?.buffer?.length) {
      const existing = await this.models.Banners.findOne({ where: { type }, attributes: ['id'], raw: true });
      if (existing) return this.#putCopy({ staff, type, label, title, subtitle, ctaLabel, ctaHref, sortOrder });
    }

    const image = inspect(file);

    /**
     * `upsert` on the unique `type` index, so two operators uploading the same
     * placement at once end with one row and the later write winning, rather
     * than a duplicate-key error surfacing as a 500.
     */
    const [row, created] = await this.models.Banners.upsert(
      {
        type,
        // Kept for anything still reading the legacy column. It is a label
        // now, not a path — nothing opens a file by this name.
        image: `${type}${image.extension}`,
        image_data: image.data,
        content_type: image.contentType,
        byte_size: image.byteSize,
        uploaded_by: staff?.id ?? null,
        is_active: true,

        /**
         * The slide copy — migration 037.
         *
         * `?? null` and not `|| null`: an operator clearing a headline sends
         * an empty string, and that must overwrite the old one. Coalescing on
         * falsiness would keep whatever was there and make "delete this text"
         * silently do nothing.
         *
         * An upload that names none of these blanks them, which is the same
         * replace-the-placement semantics the image already has: this is one
         * operation that writes a whole banner, not a patch.
         */
        title: title ?? null,
        subtitle: subtitle ?? null,
        cta_label: ctaLabel ?? null,
        cta_href: ctaHref ?? null,
        sort_order: sortOrder ?? 0,

        updated_at: new Date(),
        created_at: new Date(),
      },
      { conflictFields: ['type'], returning: true }
    );

    this.logger?.info(
      {
        type,
        staffId: staff?.id,
        bytes: image.byteSize,
        contentType: image.contentType,
        created,
        label: label ?? null,
      },
      // Worth an INFO line every time: legacy could not log this because it did
      // not know who was uploading.
      'Banner image replaced'
    );

    return this.#describe(row?.get?.({ plain: true }) ?? row, { includeUrl: true });
  }

  /**
   * The copy-only half of `putBanner`: same replace-the-whole-banner semantics
   * for the text (anything not sent is blanked), the bytes untouched.
   */
  async #putCopy({ staff, type, label, title, subtitle, ctaLabel, ctaHref, sortOrder }) {
    await this.models.Banners.update(
      {
        title: title ?? null,
        subtitle: subtitle ?? null,
        cta_label: ctaLabel ?? null,
        cta_href: ctaHref ?? null,
        sort_order: sortOrder ?? 0,
        uploaded_by: staff?.id ?? null,
        is_active: true,
        updated_at: new Date(),
      },
      { where: { type } }
    );

    this.logger?.info({ type, staffId: staff?.id, label: label ?? null }, 'Banner copy updated, image kept');

    const row = await this.models.Banners.findOne({ where: { type }, attributes: this.#metaColumns(), raw: true });
    return this.#describe(row, { includeUrl: true });
  }

  /**
   * Take a placement down without destroying it.
   *
   * Legacy had no way to do this — the only removal was replacing the image
   * with a different one, so an operator wanting a placement blank had to
   * upload a blank picture.
   */
  async setActive({ staff, type, active }) {
    const [affected] = await this.models.Banners.update(
      { is_active: active, updated_at: new Date() },
      { where: { type } }
    );
    if (!affected) throw errors.NOT_FOUND({ type });

    this.logger?.info({ type, active, staffId: staff?.id }, 'Banner visibility changed');
    return { type, active };
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Reading
  // ══════════════════════════════════════════════════════════════════════

  /** @legacy GET /api/banners/banner/:type */
  async byType({ type, includeInactive = false }) {
    const row = await this.models.Banners.findOne({
      where: { type, ...(includeInactive ? {} : { is_active: true }) },
      attributes: this.#metaColumns(),
      raw: true,
    });
    if (!row) throw errors.NOT_FOUND({ type });
    return this.#describe(row, { includeUrl: true });
  }

  /** @legacy GET /api/banners/getBannerAll */
  async list({ includeInactive = false, mode }) {
    const byMode = mode
      ? { type: mode === 'agent' ? { [Op.startsWith]: AGENT_PREFIX } : { [Op.notLike]: `${AGENT_PREFIX}%` } }
      : {};
    const rows = await this.models.Banners.findAll({
      where: { ...(includeInactive ? {} : { is_active: true }), ...byMode },
      attributes: this.#metaColumns(),
      /* Slide order, then placement — see migration 037. Ordering on `type`
         alone puts hero-10 before hero-2. */
      order: [['sort_order', 'ASC'], ['type', 'ASC']],
      raw: true,
    });
    return { total: rows.length, rows: rows.map((r) => this.#describe(r, { includeUrl: true })) };
  }

  /**
   * @legacy GET /api/banners/getAllImagesBinary
   *
   * Every banner, base64-encoded, in one response.
   *
   * Kept because a client depends on it, but it is the expensive shape — the
   * whole set of images in a single JSON body, ~33% larger than the bytes for
   * the encoding. `list()` plus `imageBytes()` is the cheap path and both are
   * available; this one is bounded by the placement count, which the unique
   * index now actually bounds. Legacy's could return the same image dozens of
   * times over because duplicate rows per type were unrestricted.
   */
  async listWithImages({ includeInactive = false }) {
    const rows = await this.models.Banners.findAll({
      where: includeInactive ? {} : { is_active: true },
      /* Slide order, then placement — see migration 037. Ordering on `type`
         alone puts hero-10 before hero-2. */
      order: [['sort_order', 'ASC'], ['type', 'ASC']],
      raw: true,
    });

    return {
      total: rows.length,
      rows: rows.map((row) => ({
        ...this.#describe(row, { includeUrl: true }),
        base64: row.image_data ? Buffer.from(row.image_data).toString('base64') : null,
      })),
    };
  }

  /**
   * @legacy GET /api/banners/image/:filename
   *
   * The raw bytes, for an `<img src>`.
   *
   * Accepts either the placement name or the numeric id. Legacy took a path on
   * disk; there is no path now, so there is nothing to traverse — the argument
   * either names a row or it does not.
   */
  async imageBytes({ key, includeInactive = false }) {
    const identifier = String(key ?? '').trim();
    // Strip a trailing extension so a legacy `home.png` URL still resolves.
    const bare = identifier.replace(/\.(png|jpe?g|webp)$/i, '').toLowerCase();

    const where = /^\d+$/.test(bare) ? { id: Number(bare) } : { type: bare };

    const row = await this.models.Banners.findOne({
      where: { ...where, ...(includeInactive ? {} : { is_active: true }) },
      raw: true,
    });

    if (!row?.image_data) throw errors.NOT_FOUND({ key: bare });

    return {
      data: Buffer.from(row.image_data),
      // From the signature detected at upload, never from the request.
      contentType: row.content_type || 'application/octet-stream',
      byteSize: row.byte_size ?? row.image_data.length,
      updatedAt: row.updated_at ?? null,
    };
  }

  // ══════════════════════════════════════════════════════════════════════

  /**
   * Every column EXCEPT the bytes.
   *
   * Listing banners must not drag megabytes of image through the query — legacy
   * read every file from disk on every list call, which is the same mistake
   * with a different backing store.
   *
   * The slide fields (migration 037) are here rather than only on the binary
   * read for the same reason in reverse: a carousel needs the copy to lay a
   * slide out, and should not have to pull every image to get at it.
   */
  #metaColumns() {
    return [
      'id', 'type', 'image', 'content_type', 'byte_size', 'uploaded_by', 'is_active',
      'title', 'subtitle', 'cta_label', 'cta_href', 'sort_order',
      'created_at', 'updated_at',
    ];
  }

  #describe(row, { includeUrl = false } = {}) {
    if (!row) return null;
    return {
      id: row.id,
      type: row.type,
      mode: modeOf(row.type),
      contentType: row.content_type ?? null,
      byteSize: row.byte_size ?? null,
      active: row.is_active !== false,
      uploadedBy: row.uploaded_by ?? null,

      /**
       * The slide, when there is one — migration 037.
       *
       * All four are null on an image-only banner, which is what every row
       * written before that migration is. A consumer that needs copy checks
       * for it; the hero carousel falls back to its captured slides rather
       * than rendering a headline-shaped blank.
       *
       * `cta` is one object or null rather than two loose fields, because a
       * label without an href is a button that goes nowhere — the pair is only
       * meaningful together, and this makes that impossible to get half right.
       */
      title: row.title ?? null,
      subtitle: row.subtitle ?? null,
      cta: row.cta_label && row.cta_href ? { label: row.cta_label, href: row.cta_href } : null,
      sortOrder: row.sort_order ?? 0,

      createdAt: row.created_at ?? null,
      updatedAt: row.updated_at ?? null,
      /**
       * Where to fetch the bytes. Built from the placement rather than the
       * stored filename so a client never constructs a path out of a value
       * that came from an upload.
       */
      ...(includeUrl ? { url: `/api/v1/admin/banners/image/${encodeURIComponent(row.type)}` } : {}),
    };
  }
}

/** Exported for the report modules, which link to banners by placement. */
BannersService.ACTIVE_ONLY = { is_active: { [Op.ne]: false } };

module.exports = { BannersService };
