'use strict';

const test = require('node:test');
const assert = require('node:assert');

const db = require('@ibitplay/db');
const { createLogger } = require('@ibitplay/common');

const { BlogsService } = require('../blogs.service');
const v = require('../blogs.validators');

/**
 * Blogs.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * Never mounted, and every write route unauthenticated. The tests below are
 * the legacy defects written down as the behaviour they produced:
 *
 *   1. the upload took its type from the client's declared MIME and its stored
 *      filename extension from the client's filename, into a statically-served
 *      directory. `Content-Type: image/png` + `x.html` = stored XSS.
 *   2. slugs carried `Date.now()`, so two posts in one millisecond collided on
 *      the UNIQUE index and the second returned 500.
 *   3. the slug was regenerated on EVERY title change, so fixing a typo in a
 *      headline broke the post's URL.
 *   4. `getAllBlogs` returned every row with every full description, unpaged.
 *   5. there was no draft state — inserting a post published it.
 * ═════════════════════════════════════════════════════════════════════════
 */

const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';

let connection;

/** Real signatures, so the content check meets what it will actually see. */
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(300, 0x11),
]);
const HTML = Buffer.from('<script>alert(document.cookie)</script>'.padEnd(300, ' '));

const asFile = (buffer, originalname = 'cover.png', mimetype = 'image/png') => ({
  buffer,
  originalname,
  mimetype,
  size: buffer.length,
});

let seq = 0;
const newTitle = (label = 'Post') => `${label} ${process.pid} ${(seq += 1)}`;

test('blogs', async (t) => {
  const logger = createLogger({ name: 'blogs-test', level: 'silent' });

  try {
    connection = await db.connect({
      config: {
        DB_HOST: process.env.DB_HOST || '127.0.0.1',
        DB_PORT: Number(process.env.DB_PORT || 5432),
        DB_NAME: TEST_DB,
        DB_USER: process.env.DB_USER || 'postgres',
        DB_PASSWORD: process.env.DB_PASSWORD || 'postgres',
        DB_SCHEMA: 'public',
      },
      logger,
      // The admin service owns this table.
      service: 'admin-service',
    });
    await connection.ping();
  } catch (error) {
    t.skip(`No test database reachable (${error.message})`);
    return;
  }

  const { models } = connection;
  const created = [];

  // Rows before the connection: node:test runs `after` hooks in registration
  // order, so closing first would strand the cleanup.
  t.after(async () => {
    if (created.length) await models.Blogs.destroy({ where: { id: created } });
  });
  t.after(async () => {
    if (connection) await connection.close();
  });

  const service = new BlogsService({ models, logger });
  const STAFF = { id: 9001 };

  const makePost = async (overrides = {}) => {
    const post = await service.create({
      staff: STAFF,
      title: newTitle(),
      description: 'Body text.',
      ...overrides,
    });
    created.push(post.id);
    return post;
  };

  // ── 1. The upload is judged on its bytes ──────────────────────────────

  await t.test('an HTML file declaring itself a PNG is refused', async () => {
    /**
     * The legacy defect exactly: `fileFilter` checked `file.mimetype`, which
     * the client sets, and the stored extension came from `originalname`, which
     * the client also sets. Both are lies here, and the content check is what
     * catches them.
     */
    await assert.rejects(
      () =>
        service.create({
          staff: STAFF,
          title: newTitle(),
          description: 'x',
          file: asFile(HTML, 'payload.html', 'image/png'),
        }),
      (error) => error.code === 'BLOGS_NOT_AN_IMAGE'
    );
  });

  await t.test('the stored content type comes from the bytes, not the request', async () => {
    const post = await makePost({ file: asFile(PNG, 'anything.jpg', 'image/webp') });

    // Three different claims in the request; one answer, from the signature.
    assert.strictEqual(post.contentType, 'image/png');
    assert.strictEqual(post.byteSize, PNG.length);
  });

  await t.test('no filename from the request reaches storage', async () => {
    const post = await makePost({ file: asFile(PNG, '../../etc/passwd.png', 'image/png') });

    const row = await models.Blogs.findByPk(post.id, { raw: true });

    /**
     * `image` is a label derived from the slug now, not a path. Legacy built it
     * from `originalname` and the static mount opened it.
     */
    assert.ok(!row.image.includes('..'));
    assert.ok(!row.image.includes('passwd'));
    assert.ok(row.image.startsWith(row.slug));
  });

  await t.test('the image is served from the row with the detected type', async () => {
    const post = await makePost({ file: asFile(PNG), isPublished: true });

    const image = await service.image({ id: post.id });
    assert.strictEqual(image.contentType, 'image/png');
    assert.ok(image.data.equals(PNG));
  });

  await t.test('a post with no image reports that, rather than a broken link', async () => {
    const post = await makePost({ isPublished: true });

    assert.strictEqual(post.imageUrl, null);
    await assert.rejects(
      () => service.image({ id: post.id }),
      (error) => error.code === 'BLOGS_NO_IMAGE'
    );
  });

  // ── 2. Slugs ──────────────────────────────────────────────────────────

  await t.test('a slug is derived from the title with no timestamp in it', async () => {
    const post = await makePost({ title: 'How To Win At Roulette!' });

    assert.strictEqual(post.slug, 'how-to-win-at-roulette');
    // Legacy appended `-${Date.now()}` — thirteen digits in every published link.
    assert.ok(!/\d{13}/.test(post.slug));
  });

  await t.test('two posts with the same title both get an address', async () => {
    /**
     * Legacy's uniqueness came from `Date.now()`, so two creates in the same
     * millisecond produced the same slug, hit the UNIQUE index, and the second
     * returned a 500 carrying a Postgres error string.
     */
    const title = newTitle('Duplicate');
    const first = await makePost({ title });
    const second = await makePost({ title });

    assert.notStrictEqual(first.slug, second.slug);
    assert.ok(second.slug.startsWith(first.slug), 'the second is a suffixed form of the first');
  });

  await t.test('fixing a typo in a headline does not move the post', async () => {
    const post = await makePost({ title: 'Teh Best Bonuses' });
    const original = post.slug;

    const fixed = await service.update({ staff: STAFF, id: post.id, title: 'The Best Bonuses' });

    /**
     * Legacy: `if (title) updates.slug = generateSlug(title)` — unconditional.
     * Every headline edit broke the URL and every link pointing at it.
     */
    assert.strictEqual(fixed.slug, original, 'the address is unchanged');
    assert.strictEqual(fixed.title, 'The Best Bonuses');
  });

  await t.test('the address can be changed deliberately', async () => {
    const post = await makePost({ title: 'Old Headline Here' });

    const moved = await service.update({
      staff: STAFF,
      id: post.id,
      title: 'New Headline Here',
      regenerateSlug: true,
    });

    assert.strictEqual(moved.slug, 'new-headline-here');
  });

  await t.test('a title of nothing but punctuation still produces a usable slug', async () => {
    const post = await makePost({ title: '!!! ??? ...' });
    assert.strictEqual(post.slug, 'post');
  });

  // ── 3. Drafts ─────────────────────────────────────────────────────────

  await t.test('a new post is a draft unless publishing is asked for', async () => {
    const post = await makePost();

    // Legacy had no draft state at all: the INSERT was the publish.
    assert.strictEqual(post.published, false);
    assert.strictEqual(post.publishedAt, null);
  });

  await t.test('a draft is invisible to a reader and visible to staff', async () => {
    const draft = await makePost({ title: newTitle('Draft') });

    await assert.rejects(
      () => service.byId({ id: draft.id }),
      (error) => error.code === 'BLOGS_NOT_FOUND',
      'a reader cannot fetch it'
    );

    const asStaff = await service.byId({ id: draft.id, includeUnpublished: true });
    assert.strictEqual(asStaff.id, draft.id);
  });

  await t.test('publishing stamps the time once and editing does not move it', async () => {
    const post = await makePost({ isPublished: true });
    const first = (await service.byId({ id: post.id })).publishedAt;

    assert.ok(first, 'publishing stamps a time');

    const edited = await service.update({ staff: STAFF, id: post.id, isPublished: true, title: newTitle('Edited') });

    /**
     * The public list orders by `published_at`. If a re-publish moved it, a
     * one-word correction to an old post would jump it to the top of the front
     * page.
     */
    assert.strictEqual(new Date(edited.publishedAt).getTime(), new Date(first).getTime());
  });

  // ── 4. Lists ──────────────────────────────────────────────────────────

  await t.test('a list never carries the article bodies', async () => {
    await makePost({ isPublished: true });

    const result = await service.list({ limit: 5 });

    assert.ok(result.rows.length > 0);
    for (const row of result.rows) {
      // `getAllBlogs` selected every row INCLUDING every full description, with
      // no limit, on an unauthenticated route.
      assert.ok(!('description' in row), 'no description in a list row');
    }
  });

  await t.test('a list is paged and reports the real total', async () => {
    const result = await service.list({ page: 1, limit: 2 });

    assert.ok(result.rows.length <= 2);
    assert.ok(result.count >= result.rows.length, 'count is the total, not the page size');
  });

  await t.test('the list excludes drafts', async () => {
    const draft = await makePost({ title: newTitle('Hidden') });

    const result = await service.list({ limit: 100 });
    assert.ok(!result.rows.some((row) => row.id === draft.id));

    const staffView = await service.list({ limit: 100, includeUnpublished: true });
    assert.ok(staffView.rows.some((row) => row.id === draft.id));
  });

  await t.test('a category with no posts is an empty list, not a 404', async () => {
    /**
     * Legacy returned 404 when a category had no rows, which makes a client
     * treat "no news this month" as a broken link.
     */
    const result = await service.byCategory({ category: `nothing-${process.pid}` });

    assert.deepStrictEqual(result.rows, []);
    assert.strictEqual(result.count, 0);
  });

  await t.test('category matching is case-insensitive, as it was', async () => {
    const post = await makePost({ category: 'Promotions', isPublished: true });

    const lower = await service.byCategory({ category: 'promotions' });
    assert.ok(lower.rows.some((row) => row.id === post.id));

    const upper = await service.byCategory({ category: 'PROMOTIONS' });
    assert.ok(upper.rows.some((row) => row.id === post.id));
  });

  // ── 5. Updates and deletes ────────────────────────────────────────────

  await t.test('an update that names nothing is a 400, not a 500', async () => {
    const post = await makePost();

    // Legacy threw a bare `Error('No valid fields to update.')` from inside the
    // repository, which surfaced as a 500.
    await assert.rejects(
      () => service.update({ staff: STAFF, id: post.id }),
      (error) => error.code === 'BLOGS_NOTHING_TO_UPDATE'
    );
  });

  await t.test('an update records who made it', async () => {
    const post = await makePost();
    await service.update({ staff: { id: 9002 }, id: post.id, title: newTitle('Revised') });

    const row = await models.Blogs.findByPk(post.id, { raw: true });
    assert.strictEqual(String(row.updated_by), '9002');
    assert.strictEqual(String(row.created_by), String(STAFF.id));
  });

  await t.test('deleting by id and by slug reach the same post', async () => {
    const byId = await makePost();
    const bySlug = await makePost();

    assert.deepStrictEqual(await service.remove({ staff: STAFF, id: byId.id }), {
      id: byId.id,
      slug: byId.slug,
      deleted: true,
    });

    const second = await service.remove({ staff: STAFF, slug: bySlug.slug });
    assert.strictEqual(second.id, bySlug.id);

    // The image went with the row — it IS the row now. Legacy unlinked a file
    // and left an orphan behind whenever that failed.
    assert.strictEqual(await models.Blogs.findByPk(byId.id), null);
  });

  await t.test('deleting a post that is not there is a 404', async () => {
    await assert.rejects(
      () => service.remove({ staff: STAFF, id: 2_147_483_600 }),
      (error) => error.code === 'BLOGS_NOT_FOUND'
    );
  });

  // ── Validators ────────────────────────────────────────────────────────

  await t.test('a client cannot choose a post its own address', () => {
    // A caller-supplied slug could claim a path that collides with a route.
    assert.ok(!Object.keys(v.create.body.shape).includes('slug'));
    assert.strictEqual(v.create.body.safeParse({ title: 'x', description: 'y', slug: 'admin' }).success, false);
  });

  await t.test('an unparseable date is rejected before the insert', () => {
    // Legacy checked `isNaN(Date.parse(date))` inline in two of five handlers.
    assert.strictEqual(
      v.create.body.safeParse({ title: 'x', description: 'y', date: 'not-a-date' }).success,
      false
    );
  });

  await t.test('the page size is capped', () => {
    // `getAllBlogs` had no limit of any kind.
    assert.strictEqual(v.list.query.safeParse({ limit: '5000' }).success, false);
    assert.strictEqual(v.list.query.parse({}).limit, 20);
  });
});
