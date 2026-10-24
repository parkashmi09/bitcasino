'use strict';

/**
 * Blogs — image bytes in the row, and a publish state.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * SAME MOVE AS MIGRATION 027, FOR THE SAME REASON
 *
 * `legacy/Blogs/blogroutes.js` used `multer.diskStorage` into
 * `legacy/uploads/blogs/`, served by a static mount, with `blogs.image`
 * holding the relative path. Local disk is not shared between replicas: an
 * upload that lands on one server is a 404 from the next, and the whole
 * directory is lost on a container restart.
 *
 * The bytes move into the row, exactly as banners did. `image` is kept as the
 * legacy path for anything still reading it; `image_data` is the truth.
 *
 * ── AND WHY THE UPLOAD PATH ITSELF WAS THE PROBLEM ───────────────────────
 *
 * The filter was:
 *
 *     const allowed = ['image/png', 'image/jpg', 'image/jpeg', 'image/webp'];
 *     if (!allowed.includes(file.mimetype)) …reject
 *
 * `file.mimetype` is the Content-Type the CLIENT sent. The filename was then:
 *
 *     const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
 *
 * — the extension from the CLIENT's filename. So a request declaring
 * `Content-Type: image/png` while naming the file `payload.html` was written
 * to disk as `blog-….html` and served from the platform's own origin by the
 * static mount. That is stored cross-site scripting on the main domain, from
 * an endpoint with no authentication at all.
 *
 * None of the five write routes had any. Anyone who could reach the port could
 * publish, edit and delete site content, and fill the disk 50MB at a time.
 *
 * The port reads magic bytes (`banners/upload.js`) and stores what it detected,
 * never what was claimed — so this migration's `content_type` column is the
 * detected type, and there is no filename anywhere in the path.
 * ═════════════════════════════════════════════════════════════════════════
 */

async function up({ sequelize, transaction, logger }) {
  await sequelize.query(
    `ALTER TABLE blogs
       ADD COLUMN IF NOT EXISTS image_data    BYTEA,
       -- Detected from the CONTENT, never from the request.
       ADD COLUMN IF NOT EXISTS content_type  VARCHAR(60),
       ADD COLUMN IF NOT EXISTS byte_size     INTEGER,
       -- Legacy recorded no author of the change, because the routes had no
       -- authentication and there was nobody to record.
       ADD COLUMN IF NOT EXISTS created_by    BIGINT,
       ADD COLUMN IF NOT EXISTS updated_by    BIGINT,
       -- A post can be written before it is public. Legacy had no such state:
       -- createBlog inserted and GET /all returned everything, so writing a
       -- draft published it. Existing rows default to published — they are
       -- already visible and this migration must not take the site down.
       ADD COLUMN IF NOT EXISTS is_published  BOOLEAN NOT NULL DEFAULT TRUE,
       ADD COLUMN IF NOT EXISTS published_at  TIMESTAMPTZ`,
    { transaction }
  );

  /** Backfill `published_at` so ordering by it is meaningful from day one. */
  await sequelize.query(
    'UPDATE blogs SET published_at = COALESCE(date, created_at, NOW()) WHERE is_published AND published_at IS NULL',
    { transaction }
  );

  /**
   * The public list reads published posts, newest first.
   *
   * Legacy's index was on `created_at DESC` alone and the list had no
   * pagination at all — `getAllBlogs` selected every row including every full
   * `description`, on a public unauthenticated route.
   */
  await sequelize.query(
    `CREATE INDEX IF NOT EXISTS ix_blogs_published
       ON blogs (published_at DESC)
       WHERE is_published`,
    { transaction }
  );

  /**
   * Category browse, case-insensitively.
   *
   * `getBlogsByCategory` matched `LOWER(category) = LOWER($1)`, and legacy's
   * index was `ON blogs (LOWER(category))` — but the live table has it on the
   * bare column, so every category page was a sequential scan.
   */
  await sequelize.query('CREATE INDEX IF NOT EXISTS ix_blogs_category_lower ON blogs (LOWER(category))', {
    transaction,
  });

  logger?.info('blogs: image bytes, authorship and publish state added');
}

async function down({ sequelize, transaction }) {
  await sequelize.query('DROP INDEX IF EXISTS ix_blogs_category_lower', { transaction });
  await sequelize.query('DROP INDEX IF EXISTS ix_blogs_published', { transaction });
  await sequelize.query(
    `ALTER TABLE blogs
       DROP COLUMN IF EXISTS image_data,
       DROP COLUMN IF EXISTS content_type,
       DROP COLUMN IF EXISTS byte_size,
       DROP COLUMN IF EXISTS created_by,
       DROP COLUMN IF EXISTS updated_by,
       DROP COLUMN IF EXISTS is_published,
       DROP COLUMN IF EXISTS published_at`,
    { transaction }
  );
}

module.exports = { up, down };
