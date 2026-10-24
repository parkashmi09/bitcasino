'use strict';

/**
 * `banners` — give a banner the text a hero slide actually needs.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * THE TABLE COULD ONLY EVER HOLD A PICTURE
 *
 * `banners` is `(id, type, image, image_data, content_type, byte_size,
 * uploaded_by, is_active, …)` — one image per placement, and nowhere to put a
 * word. `BACKEND-GAP-REPORT.md` §1.1 records the consequence:
 *
 *   | `Components/heroCarousel/heroData.js` | 9 promotional slides — title,
 *   | subtitle, CTA, artwork | `admin/banners` **exists** and returns `[]`.
 *   | Needs a slide type, an image pipeline, and the front end pointed at it.
 *
 * The image pipeline is already there (migration 020 added the bytes and the
 * `/image/:type` route serves them). The **slide type** is what was missing, so
 * the hero carousel stayed a nine-slide fixture in the front end: pointing it
 * at this table would have thrown away the title, the subtitle and the CTA on
 * every slide, because there was nowhere for them to live.
 *
 * ── `type` STAYS UNIQUE, AND THE CAROUSEL IS BUILT AROUND THAT ───────────
 *
 * `uq_banners_type` enforces ONE ROW PER PLACEMENT, and the whole module is
 * built on it: `byType` is a `findOne`, and an upload for an existing `type`
 * REPLACES that banner rather than adding a second. That invariant is load
 * bearing and this migration does not touch it.
 *
 * So a carousel is not several rows in one placement — it is one placement per
 * slide: `hero-1` … `hero-9`. An operator re-uploads `hero-3` and replaces
 * exactly that slide, which is the behaviour the upload path already has.
 *
 * `sort_order` is what makes them a sequence, and it is not decoration: sorting
 * on `type` alone puts `hero-10` before `hero-2`, because that is a string.
 *
 * ── EVERY COLUMN IS NULLABLE, DELIBERATELY ───────────────────────────────
 *
 * A banner that is only a picture is still valid — that is what every existing
 * row is, and this migration must not invalidate them. A consumer that needs
 * text checks for it; `heroCarousel` falls back to its captured slides when a
 * row carries none, so a half-filled placement degrades to artwork rather than
 * rendering a slide with a blank headline.
 * ═════════════════════════════════════════════════════════════════════════
 */

async function up({ sequelize, transaction, logger }) {
  await sequelize.query(
    `ALTER TABLE banners
       -- The headline and the line under it. Both optional: an image-only
       -- banner is a real banner and every existing row is one.
       ADD COLUMN IF NOT EXISTS title       VARCHAR(160),
       ADD COLUMN IF NOT EXISTS subtitle    VARCHAR(300),
       -- The call to action: its label, and where it goes. A CTA with a label
       -- and no href is a button that does nothing, so the front end requires
       -- both before it draws one.
       ADD COLUMN IF NOT EXISTS cta_label   VARCHAR(60),
       ADD COLUMN IF NOT EXISTS cta_href    VARCHAR(500),
       -- Where this banner sits among its siblings. A hero carousel is one
       -- placement per slide (hero-1 … hero-9), so ordering cannot come from
       -- \`type\`: sorting that as a string puts hero-10 before hero-2.
       ADD COLUMN IF NOT EXISTS sort_order  INTEGER NOT NULL DEFAULT 0`,
    { transaction }
  );

  /**
   * The ordered read: active banners, in slide order.
   *
   * `type` is already uniquely indexed (`uq_banners_type`) and that stays, so
   * this is not about finding a placement — it is about returning a set of them
   * in a defined sequence without a sort.
   */
  await sequelize.query(
    `CREATE INDEX IF NOT EXISTS idx_banners_placement_order
       ON banners (sort_order, id)`,
    { transaction }
  );

  logger?.info('banners: slide fields added (title, subtitle, cta_label, cta_href, sort_order)');
}

/**
 * Reversible, and it drops the text with the columns.
 *
 * Called out because it is not recoverable: a slide's copy lives nowhere else,
 * so rolling this back loses whatever an operator has written. The images are
 * untouched.
 */
async function down({ sequelize, transaction, logger }) {
  await sequelize.query('DROP INDEX IF EXISTS idx_banners_placement_order', { transaction });
  await sequelize.query(
    `ALTER TABLE banners
       DROP COLUMN IF EXISTS title,
       DROP COLUMN IF EXISTS subtitle,
       DROP COLUMN IF EXISTS cta_label,
       DROP COLUMN IF EXISTS cta_href,
       DROP COLUMN IF EXISTS sort_order`,
    { transaction }
  );

  logger?.warn('banners: slide fields dropped — any slide copy is gone with them');
}

module.exports = { up, down };
