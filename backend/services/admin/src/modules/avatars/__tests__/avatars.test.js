'use strict';

const test = require('node:test');
const assert = require('node:assert');

const v = require('../avatars.validators');
const { AvatarsService, publicView, urlOf, versionOf } = require('../avatars.service');
const { MAX_AVATAR_BYTES } = require('../avatars.constants');

/**
 * Avatars (migration 115) — no database: the validators, the views and the upload check.
 */

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(200, 1)]);
const row = { id: 7, version: 'abc123def456', min_level: 2, sort: 3, enabled: true, byte_size: 208, content_type: 'image/png' };

test('multipart `enabled=false` is false, not truthy', () => {
  assert.strictEqual(v.create.body.parse({ minLevel: '1', enabled: 'false' }).enabled, false);
  assert.strictEqual(v.create.body.parse({ minLevel: '1', enabled: 'true' }).enabled, true);
  assert.strictEqual(v.create.body.parse({}).minLevel, 0);
});

test('a level is a ladder level, 0 to 40', () => {
  assert.throws(() => v.update.body.parse({ minLevel: -1 }));
  assert.throws(() => v.update.body.parse({ minLevel: 41 }));
  assert.strictEqual(v.update.body.parse({ minLevel: '40' }).minLevel, 40);
});

test('an empty PATCH is refused rather than a silent no-op', () => {
  assert.throws(() => v.update.body.parse({}));
  assert.throws(() => v.update.body.parse({ minLevel: 1, image: 'x' }));
});

test('the image URL carries the version, so it can be cached forever', () => {
  assert.strictEqual(urlOf(row), '/api/v1/admin/avatars/7/image?v=abc123def456');
  assert.deepStrictEqual(publicView(row), { id: 7, url: urlOf(row), minLevel: 2, sort: 3 });
  assert.strictEqual(versionOf(PNG).length, 12);
  assert.notStrictEqual(versionOf(PNG), versionOf(Buffer.concat([PNG, Buffer.from([2])])));
});

test('an upload is judged on its bytes and its size', async () => {
  const service = new AvatarsService({ models: { Avatar: { max: async () => 0, create: async (r) => ({ get: () => ({ id: 1, ...r }) }) } } });
  const ok = await service.create({ file: { buffer: PNG, originalname: 'x.png' }, minLevel: 1 });
  assert.strictEqual(ok.contentType, 'image/png');
  assert.strictEqual(ok.minLevel, 1);
  assert.strictEqual(ok.sort, 1);

  await assert.rejects(service.create({ file: { buffer: Buffer.alloc(300, 0x3c), originalname: 'a.png' } }), { code: 'AVATARS_NOT_AN_IMAGE' });
  await assert.rejects(
    service.create({ file: { buffer: Buffer.alloc(300, 0x3c), originalname: 'a.svg' } }),
    { code: 'AVATARS_FORMAT_REFUSED' }
  );
  await assert.rejects(
    service.create({ file: { buffer: Buffer.concat([PNG, Buffer.alloc(MAX_AVATAR_BYTES)]), originalname: 'big.png' } }),
    { code: 'AVATARS_TOO_LARGE' }
  );
  await assert.rejects(service.create({ file: null }), { code: 'AVATARS_NO_FILE' });
});

test('the public list asks for enabled rows only, in sort order', async () => {
  let asked;
  const service = new AvatarsService({ models: { Avatar: { findAll: async (q) => { asked = q; return [row]; } } } });
  const list = await service.publicList();
  assert.deepStrictEqual(asked.where, { enabled: true });
  assert.deepStrictEqual(asked.order, [['sort', 'ASC'], ['id', 'ASC']]);
  assert.ok(!asked.attributes.includes('image_data'));
  assert.deepStrictEqual(list, [publicView(row)]);
});
