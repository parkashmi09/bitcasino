'use strict';

const crypto = require('node:crypto');

const { Op, fn, col, where: sqlWhere } = require('sequelize');

const { imageUpload } = require('@ibitplay/common');

const errors = require('./blogs.errors');
const { DEFAULT_AUTHOR, DEFAULT_CATEGORY, DEFAULT_PAGE_SIZE, MAX_SLUG_LENGTH } = require('./blogs.constants');

/**
 * Blogs — the platform's content pages.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * NEVER MOUNTED, AND THAT IS THE ONLY REASON IT WAS NOT EXPLOITED
 *
 * `legacy/Blogs/blogroutes.js` exports five write endpoints. Not one of them
 * has a middleware:
 *
 *     router.post('/uploadImage',   upload.single('image'), async (req, res) => {
 *     router.post('/createBlog',    upload.single('image'), async (req, res) => {
 *     router.post('/updateBlog',    (req, res) => {
 *     router.post('/deleteBlog',    async (req, res) => {
 *     router.post('/deleteBlogById', async (req, res) => {
 *
 * Anyone reaching the port could publish, rewrite or delete any page on the
 * site. `legacy/index.js` never requires the router, which is the whole of the
 * protection it had.
 *
 * ── THE UPLOAD WAS WORSE THAN UNAUTHENTICATED ────────────────────────────
 *
 *     fileFilter: allowed.includes(file.mimetype)          ← the client's claim
 *     filename:   path.extname(file.originalname) || '.jpg' ← the client's name
 *
 * Declare `image/png`, name the file `x.html`, and the bytes land in
 * `uploads/blogs/x.html` — served by the static mount, from the platform's own
 * origin. Stored XSS on the main domain, by unauthenticated POST. The 50MB
 * limit with no quota was the smaller problem.
 *
 * ── AND THE SMALLER ONES ─────────────────────────────────────────────────
 *
 *   `generateSlug` appends `Date.now()`, so two posts created in the same
 *   millisecond collide on the UNIQUE index and the second is a 500.
 *
 *   `updateBlog` regenerated the slug whenever the title changed, so fixing a
 *   typo in a headline broke the post's URL and every link to it.
 *
 *   `updateBlog` built `SET ${key} = $n` from object keys. The route passes a
 *   fixed field list so it is not reachable today, but the repository method is
 *   one careless call site away from column-name injection.
 *
 *   `getAllBlogs` returned every row with every full `description`, unpaged, on
 *   a public route.
 *
 *   The table was created by a floating promise at require time — if it failed,
 *   the module logged and carried on serving 500s.
 *
 * ── WHAT THIS MODULE KEEPS ───────────────────────────────────────────────
 *
 * The content model, exactly: slug, title, subheading, description, author,
 * date, category, image. Existing rows are readable unchanged. What changes is
 * who may write (staff), where the bytes go (the row — migration 032), and that
 * a post can exist before it is public.
 * ═════════════════════════════════════════════════════════════════════════
 */
class BlogsService {
  constructor({ models, logger }) {
    this.models = models;
    this.logger = logger;
  }

  // ── Public reads ──────────────────────────────────────────────────────

  /**
   * @legacy GET /all
   *
   * Paged, and published-only. Legacy returned the whole table including every
   * `description` — the single most expensive query a visitor could ask for,
   * on a route with no authentication and no limit.
   */
  async list({ page = 1, limit = DEFAULT_PAGE_SIZE, category, search, includeUnpublished = false } = {}) {
    const where = includeUnpublished ? {} : { is_published: true };

    if (category) {
      // `LOWER(category) = LOWER(?)`, matching legacy's comparison and the
      // functional index migration 032 adds for it.
      where[Op.and] = [sqlWhere(fn('LOWER', col('category')), String(category).toLowerCase())];
    }

    if (search) {
      const term = `%${search}%`;
      where[Op.or] = [{ title: { [Op.iLike]: term } }, { subheading: { [Op.iLike]: term } }];
    }

    const result = await this.models.Blogs.findAndCountAll({
      where,
      // Never the description in a list, and never the bytes.
      attributes: this.#summaryColumns(),
      order: [
        // Unpublished posts have no `published_at`, so the admin listing falls
        // back to creation order rather than dropping them to the end.
        [includeUnpublished ? 'created_at' : 'published_at', 'DESC'],
        ['id', 'DESC'],
      ],
      limit,
      offset: (page - 1) * limit,
      raw: true,
    });

    return {
      rows: result.rows.map((row) => this.#summarise(row)),
      count: result.count,
    };
  }

  /** @legacy GET /by-category?category=news */
  async byCategory({ category, page = 1, limit = DEFAULT_PAGE_SIZE }) {
    /**
     * Legacy answered 404 when a category had no posts. An empty list is not a
     * missing resource — the category page exists and is empty — and a 404 here
     * makes a client treat "no news this month" as a broken link.
     */
    return this.list({ category, page, limit });
  }

  /** @legacy GET /by-slug?slug=my-post-1714000000000 */
  async bySlug({ slug, includeUnpublished = false }) {
    const row = await this.models.Blogs.findOne({
      where: { slug, ...(includeUnpublished ? {} : { is_published: true }) },
      attributes: this.#fullColumns(),
      raw: true,
    });

    if (!row) throw errors.NOT_FOUND({ slug });
    return this.#describe(row);
  }

  /** @legacy GET /by-id?id=5 */
  async byId({ id, includeUnpublished = false }) {
    const row = await this.models.Blogs.findOne({
      where: { id, ...(includeUnpublished ? {} : { is_published: true }) },
      attributes: this.#fullColumns(),
      raw: true,
    });

    if (!row) throw errors.NOT_FOUND({ id });
    return this.#describe(row);
  }

  /**
   * The image bytes.
   *
   * Legacy had no such endpoint — the file was served by a static mount, which
   * is what made the filename dangerous. Here the bytes come from the row and
   * the `Content-Type` is the one detected at upload, so a stored file cannot
   * be served as something it is not.
   */
  async image({ id, includeUnpublished = false }) {
    const row = await this.models.Blogs.findOne({
      where: { id, ...(includeUnpublished ? {} : { is_published: true }) },
      attributes: ['id', 'image_data', 'content_type', 'byte_size', 'updated_at'],
      raw: true,
    });

    if (!row) throw errors.NOT_FOUND({ id });
    if (!row.image_data) throw errors.NO_IMAGE({ id });

    return {
      data: Buffer.from(row.image_data),
      contentType: row.content_type || 'application/octet-stream',
      byteSize: row.byte_size ?? row.image_data.length,
      updatedAt: row.updated_at ?? null,
    };
  }

  // ── Staff writes ──────────────────────────────────────────────────────

  /**
   * @legacy POST /createBlog
   * @legacy POST /uploadImage  (folded in — see the validators)
   */
  async create({ staff, title, description, subheading, author, category, date, isPublished = false, file }) {
    const image = file ? imageUpload.inspect(file, errors) : null;

    const slug = await this.#uniqueSlug(title);
    const now = new Date();

    const row = await this.models.Blogs.create({
      slug,
      title,
      subheading: subheading ?? null,
      description,
      author: author || DEFAULT_AUTHOR,
      category: category || DEFAULT_CATEGORY,
      // The DISPLAY date — what the post says. Distinct from `published_at`.
      date: date ?? now,
      image: image ? `${slug}${image.extension}` : null,
      image_data: image?.data ?? null,
      content_type: image?.contentType ?? null,
      byte_size: image?.byteSize ?? null,
      created_by: staff?.id ?? null,
      updated_by: staff?.id ?? null,
      is_published: isPublished,
      published_at: isPublished ? now : null,
      created_at: now,
      updated_at: now,
    });

    this.logger?.info(
      { blogId: row.id, slug, staffId: staff?.id, published: isPublished, bytes: image?.byteSize ?? 0 },
      'Blog post created'
    );

    return this.#describe(row.get({ plain: true }));
  }

  /**
   * @legacy POST /updateBlog?id=…
   *
   * Only the named fields change. Legacy assembled the SET clause from object
   * keys, which is why the field list is explicit here rather than a spread.
   */
  async update({ staff, id, regenerateSlug = false, file, ...fields }) {
    const row = await this.models.Blogs.findByPk(id);
    if (!row) throw errors.NOT_FOUND({ id });

    const image = file ? imageUpload.inspect(file, errors) : null;
    const updates = { updated_by: staff?.id ?? null, updated_at: new Date() };

    if (fields.title !== undefined) updates.title = fields.title;
    if (fields.description !== undefined) updates.description = fields.description;
    if (fields.subheading !== undefined) updates.subheading = fields.subheading;
    if (fields.author !== undefined) updates.author = fields.author;
    if (fields.category !== undefined) updates.category = fields.category;
    if (fields.date !== undefined) updates.date = fields.date;

    /**
     * The address changes only when asked.
     *
     * Legacy regenerated it on every title change — `if (title) updates.slug =
     * generateSlug(title)` — so correcting a headline typo moved the post and
     * broke every link and bookmark pointing at it.
     */
    if (regenerateSlug && fields.title) {
      updates.slug = await this.#uniqueSlug(fields.title, { excludeId: id });
    }

    /**
     * Publishing stamps the time once.
     *
     * Re-publishing a post that is already live must not move `published_at` —
     * the public list orders by it, so a small edit would jump an old post to
     * the top of the front page.
     */
    if (fields.isPublished !== undefined) {
      updates.is_published = fields.isPublished;
      if (fields.isPublished && !row.published_at) updates.published_at = new Date();
    }

    if (image) {
      updates.image = `${updates.slug ?? row.slug}${image.extension}`;
      updates.image_data = image.data;
      updates.content_type = image.contentType;
      updates.byte_size = image.byteSize;
    }

    // `updated_by`/`updated_at` are always set, so they do not count as change.
    const changed = Object.keys(updates).filter((key) => key !== 'updated_by' && key !== 'updated_at');
    if (!changed.length) throw errors.NOTHING_TO_UPDATE({ id });

    await row.update(updates);

    this.logger?.info({ blogId: id, staffId: staff?.id, changed }, 'Blog post updated');

    return this.#describe(row.get({ plain: true }));
  }

  /**
   * @legacy POST /deleteBlog     — body: { slug }
   * @legacy POST /deleteBlogById — query: id
   *
   * One method. Legacy had two routes doing the same delete through different
   * keys, one reading the body and one the query string.
   *
   * The image goes with the row, because it IS the row now — legacy unlinked a
   * file from disk here and left orphans behind whenever the unlink failed or
   * the path did not match the prefix check.
   */
  async remove({ staff, id, slug }) {
    const where = id !== undefined ? { id } : { slug };

    const row = await this.models.Blogs.findOne({ where });
    if (!row) throw errors.NOT_FOUND({ ...where });

    await row.destroy();

    this.logger?.warn({ blogId: row.id, slug: row.slug, staffId: staff?.id }, 'Blog post deleted');

    return { id: row.id, slug: row.slug, deleted: true };
  }

  // ══════════════════════════════════════════════════════════════════════

  /**
   * A URL-safe, unique address for a post.
   *
   * ── WHY NOT `Date.now()` ─────────────────────────────────────────────
   *
   * Legacy's was:
   *
   *     slug.replace(…) + '-' + Date.now()
   *
   * Two posts created in the same millisecond produce the same slug, hit the
   * UNIQUE index and the second returns 500. More to the point, a timestamp in
   * the address is thirteen digits of noise in every link the site publishes.
   *
   * This derives the slug from the title alone and appends a short suffix ONLY
   * when the plain form is taken. So the first post about a topic gets a clean
   * address, and a later one with the same title gets a distinct one.
   */
  async #uniqueSlug(title, { excludeId } = {}) {
    const base =
      String(title ?? '')
        .toLowerCase()
        .trim()
        .replace(/[^\w\s-]/g, '')
        .replace(/[\s_]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, MAX_SLUG_LENGTH)
        // Slicing can leave a trailing dash.
        .replace(/-+$/, '') || 'post';

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const candidate = attempt === 0 ? base : `${base}-${crypto.randomBytes(3).toString('hex')}`;

      const clash = await this.models.Blogs.findOne({
        where: { slug: candidate, ...(excludeId ? { id: { [Op.ne]: excludeId } } : {}) },
        attributes: ['id'],
        raw: true,
      });

      if (!clash) return candidate;
    }

    /**
     * Five collisions on a random 24-bit suffix is not chance. Refusing beats
     * looping — and beats legacy's alternative, which was a 500 carrying a
     * Postgres constraint name.
     */
    throw errors.SLUG_TAKEN({ base });
  }

  /** A list row: no `description`, no bytes. */
  #summaryColumns() {
    return [
      'id',
      'slug',
      'title',
      'subheading',
      'author',
      'date',
      'category',
      'image',
      'content_type',
      'byte_size',
      'is_published',
      'published_at',
      'created_at',
      'updated_at',
    ];
  }

  /** A single post: everything except the bytes, which have their own route. */
  #fullColumns() {
    return [...this.#summaryColumns(), 'description', 'created_by', 'updated_by'];
  }

  #summarise(row) {
    if (!row) return null;
    return {
      id: row.id,
      slug: row.slug,
      title: row.title,
      subheading: row.subheading ?? null,
      author: row.author ?? DEFAULT_AUTHOR,
      category: row.category ?? DEFAULT_CATEGORY,
      date: row.date ?? null,
      published: row.is_published !== false,
      publishedAt: row.published_at ?? null,
      /**
       * Where to fetch the image, derived from the id.
       *
       * Never the stored `image` value: that column holds a legacy path like
       * `/uploads/blogs/blog-….jpg`, and handing a client a path to open is
       * exactly the shape that made the upload dangerous.
       */
      imageUrl: row.byte_size ? `/api/v1/admin/blogs/${row.id}/image` : null,
      contentType: row.content_type ?? null,
      byteSize: row.byte_size ?? null,
      createdAt: row.created_at ?? null,
      updatedAt: row.updated_at ?? null,
    };
  }

  #describe(row) {
    if (!row) return null;
    return {
      ...this.#summarise(row),
      description: row.description,
      createdBy: row.created_by ?? null,
      updatedBy: row.updated_by ?? null,
    };
  }
}

module.exports = { BlogsService };
