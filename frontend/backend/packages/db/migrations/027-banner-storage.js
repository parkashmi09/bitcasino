'use strict';

/**
 * Banners — one row per placement, and the image bytes in the database.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * WHY THE BYTES MOVE INTO THE DATABASE
 *
 * Legacy stored uploads on the API server's local disk (`Banners/banners/`)
 * and kept only the filename in `banners.image`. That works for exactly one
 * server. This port runs admin-service behind a gateway with more than one
 * replica intended, and local disk is not shared: an upload landing on
 * replica A is a 404 from replica B, intermittently, depending on which
 * replica the load balancer picked. The same disk is also lost on every
 * container restart.
 *
 * There is no object-store credential anywhere in this repository to migrate
 * to, so the honest place for a handful of banner images — the platform has
 * ONE per placement, a few hundred KB each — is the row that already
 * describes them. `getAllImagesBinary` already returned them base64-encoded,
 * so the API shape does not change.
 *
 * `image` is kept as the legacy filename for anything still reading it, and
 * `image_data` is the truth.
 *
 * ── AND WHY `type` BECOMES UNIQUE ────────────────────────────────────────
 *
 * `createBanner` INSERTed a new row every time, while `getBannerByType`
 * returned only `ORDER BY created_at DESC LIMIT 1`. So each upload for an
 * existing placement left the previous row behind, invisible and permanent —
 * `getBannerAll` and `getAllImagesBinary` list them all, so the admin screen
 * accumulated a growing pile of dead banners it could not tell apart.
 *
 * Worse, `updateBanner` ran `UPDATE banners SET image=$2 WHERE type=$1` — no
 * LIMIT — so it rewrote EVERY row of that type to the new filename, after
 * deleting only the newest one's file. The older rows then pointed at a file
 * that was still on disk under a name nothing referenced, and every row of the
 * type became an indistinguishable duplicate.
 *
 * The collapse below keeps the newest row per type, which is precisely the one
 * `getBannerByType` has been serving all along. Nothing a caller could see is
 * discarded.
 */

async function up({ sequelize, transaction, logger }) {
  await sequelize.query(
    `ALTER TABLE banners
       ADD COLUMN IF NOT EXISTS image_data   BYTEA,
       ADD COLUMN IF NOT EXISTS content_type VARCHAR(60),
       ADD COLUMN IF NOT EXISTS byte_size    INTEGER,
       -- Who uploaded it. Legacy recorded nothing, and the route had no
       -- authentication, so there was nobody to record.
       ADD COLUMN IF NOT EXISTS uploaded_by  BIGINT,
       -- A placement can be taken down without deleting the history of it.
       ADD COLUMN IF NOT EXISTS is_active    BOOLEAN NOT NULL DEFAULT TRUE`,
    { transaction }
  );

  /**
   * Collapse duplicates, newest wins.
   *
   * Deliberately NOT a merge of any kind: these rows are alternatives, not
   * parts of a whole. The newest is what the read path already returned.
   */
  const [dupes] = await sequelize.query(
    `SELECT type, COUNT(*)::int AS n FROM banners GROUP BY type HAVING COUNT(*) > 1`,
    { transaction }
  );

  if (dupes.length) {
    logger?.warn(
      { placements: dupes.length, extra: dupes.reduce((sum, d) => sum + d.n - 1, 0) },
      'Collapsing duplicate banner rows — keeping the newest per type, which is the one getBannerByType served'
    );

    await sequelize.query(
      `DELETE FROM banners b
        WHERE b.id <> (
          SELECT k.id FROM banners k
           WHERE k.type = b.type
           ORDER BY k.created_at DESC NULLS LAST, k.id DESC
           LIMIT 1
        )`,
      { transaction }
    );
  }

  await sequelize.query(
    'CREATE UNIQUE INDEX IF NOT EXISTS uq_banners_type ON banners (type)',
    { transaction }
  );

  logger?.info('banners now holds its own image bytes and permits one row per placement');
}

async function down({ sequelize, transaction, logger }) {
  if (process.env.ALLOW_DESTRUCTIVE_MIGRATION !== 'true') {
    throw new Error(
      'Dropping image_data discards the only copy of every banner image — the legacy ' +
        'files it replaced are on a disk this deployment may no longer have. ' +
        'Re-run with ALLOW_DESTRUCTIVE_MIGRATION=true if intended.'
    );
  }
  await sequelize.query('DROP INDEX IF EXISTS uq_banners_type', { transaction });
  await sequelize.query(
    `ALTER TABLE banners
       DROP COLUMN IF EXISTS image_data,
       DROP COLUMN IF EXISTS content_type,
       DROP COLUMN IF EXISTS byte_size,
       DROP COLUMN IF EXISTS uploaded_by,
       DROP COLUMN IF EXISTS is_active`,
    { transaction }
  );
  logger?.warn('Reverted banner storage — image bytes are gone');
}

module.exports = { up, down };
