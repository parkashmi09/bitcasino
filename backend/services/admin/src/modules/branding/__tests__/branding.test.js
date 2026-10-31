'use strict';

const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const express = require('express');

const { createLogger, errorHandler, requestContext } = require('@ibitplay/common');

const { createEntitlementsStore, sign } = require('../../entitlements/entitlements.store');
const { memoryDb } = require('../../entitlements/__tests__/memoryDb');
const { createBrandingStore } = require('../branding.store');
const { cleanBranding, imageProblem } = require('../branding.rules');
const publicRoutes = require('../routes/public.routes');

/**
 * Branding (docs/OWNER-PANEL.md §8): the owner panel uploads each image, kept only when its
 * bytes hash to its name and pass the image checks; the signed document names images by that
 * SHA-256; the public read lists only what the current document names and the table holds;
 * the asset route serves it immutable and inert.
 */

const SECRET = 'test-owner-shared-secret-0123456789abcdef';
const logger = createLogger({ name: 'branding-test', level: 'silent' });
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

/** A real PNG header (the sniff needs the signature) padded past the 64-byte minimum. */
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]), Buffer.alloc(120, 7)]);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><rect width="128" height="128" rx="28" fill="#1A1D1E"/><path fill="#24EE89" d="M10 10h50v50H10z"/></svg>\n');
const EVIL = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><script>alert(document.cookie)</script><path d="M0 0h1v1H0z"/></svg>\n');

const ref = (buf, ext, type) => ({ file: `${sha(buf)}.${ext}`, type, bytes: buf.length, width: 128, height: 128 });
const logo = { ...ref(PNG, 'png', 'image/png'), width: 576 };
const mark = ref(SVG, 'svg', 'image/svg+xml');
const evil = ref(EVIL, 'svg', 'image/svg+xml');

const branding = (over = {}) => ({
  siteName: 'parker567',
  title: 'Parker567 — Casino & Sports',
  titleTemplate: '%s · Parker567',
  description: 'Crypto casino and sports.',
  keywords: ['casino', 'Casino', 'sports'],
  ogTitle: '',
  ogDescription: '',
  themeColor: '#24ee89',
  logo,
  mark,
  ogImage: null,
  ...over,
});

const doc = (version, b) => ({ site: 'hash-game-exchange', version, updatedAt: '2026-10-12T10:00:00.000Z', features: {}, flags: {}, ...(b === undefined ? {} : { branding: b }) });

test('rules: a malformed field reads as unset, never reaches a reader', () => {
  const c = cleanBranding(branding({ title: '<script>x</script>', titleTemplate: 'no placeholder', themeColor: 'red', logo: { file: '../../etc/passwd', type: 'image/png', bytes: 100 }, extra: 1 }));
  assert.equal(c.title, '');
  assert.equal(c.titleTemplate, '');
  assert.equal(c.themeColor, '');
  assert.equal(c.logo, null);
  assert.deepEqual(c.keywords, ['casino', 'sports']);
  assert.equal('extra' in c, false);
  assert.equal(cleanBranding(undefined), null);
  assert.equal(cleanBranding(branding()).themeColor, '#24EE89');
});

test('rules: image checks by bytes', () => {
  assert.equal(imageProblem(PNG, logo.file, 'logo'), null);
  assert.equal(imageProblem(SVG, mark.file, 'mark'), null);
  assert.match(imageProblem(EVIL, evil.file, 'mark'), /unsafe SVG/);
  assert.match(imageProblem(SVG, `${sha(SVG)}.png`, 'logo'), /not a PNG/);
  assert.match(imageProblem(PNG, `${sha(PNG)}.svg`, 'logo'), /raster/);
  assert.match(imageProblem(Buffer.alloc(300 * 1024, 1), logo.file, 'logo'), /too large/);
});

/** `owner_branding_assets` as a Map (the real table: ownerApi.test.js). */
function assetTable() {
  const rows = new Map();
  const site = new Map();
  const meta = { row: null };
  return {
    rows,
    OwnerBrandingAsset: {
      findOrCreate: async ({ where, defaults }) => {
        if (!rows.has(where.file)) rows.set(where.file, { ...defaults });
        return [rows.get(where.file), true];
      },
      findByPk: async (file) => (rows.has(file) ? { ...rows.get(file) } : null),
      // `site_branding` (the Super Admin's images) as a Map, `site_branding_meta` as one value.
      sequelize: {
        QueryTypes: { SELECT: 'SELECT' },
        query: async (sql, { replacements: r = {} } = {}) => {
          if (sql.includes('site_branding_meta')) {
            if (sql.startsWith('SELECT')) return meta.row ? [meta.row] : [];
            meta.row = sql.startsWith('DELETE') ? null : { meta: JSON.parse(r.meta), owner_meta: r.ownerMeta };
            return [];
          }
          if (sql.startsWith('SELECT')) return [...site.values()];
          if (sql.startsWith('DELETE')) site.delete(r.slot);
          else site.set(r.slot, { slot: r.slot, file: r.file, content_type: r.type, byte_size: r.bytes, owner_file: r.ownerFile });
          return [];
        },
      },
    },
  };
}

test('branding: uploaded images → signed document → public read → served bytes', async (t) => {
  const config = { OWNER_SHARED_SECRET: SECRET, OWNER_POLL_SECONDS: 3600, RATE_LIMIT_ENABLED: false };
  const table = assetTable();
  const entitlementsStore = createEntitlementsStore({ config, logger, db: memoryDb() });
  const store = createBrandingStore({ logger, models: table });
  let version = 0;
  const save = (b) => {
    version += 1;
    const data = doc(version, b);
    return entitlementsStore.accept({ data, signature: sign(data, SECRET) });
  };

  const app = express();
  app.use(requestContext());
  app.use('/api/v1/admin/branding', publicRoutes({ entitlementsStore, brandingStore: store, config, logger }));
  app.use(errorHandler({ logger }));
  const server = app.listen(0);
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}/api/v1/admin/branding`;
  const read = async () => (await (await fetch(`${base}/public`)).json()).data;

  await t.test('not branded: every field null, the UI keeps its own', async () => {
    await save(undefined);
    const data = await read();
    assert.equal(data.branded, false);
    assert.equal(data.siteName, null);
    assert.equal(data.logoUrl, null);
  });

  await t.test('uploads are checked: bytes must hash to the name and pass the image checks', async () => {
    await assert.rejects(() => store.put(`${'0'.repeat(64)}.png`, PNG, 'logo'), (e) => e.status === 422 && /hash/.test(e.message));
    await assert.rejects(() => store.put(evil.file, EVIL, 'mark'), (e) => e.status === 422 && /unsafe SVG/.test(e.message));
    await assert.rejects(() => store.put(logo.file, PNG, 'banner'), (e) => e.status === 422);
    assert.equal(table.rows.size, 0, 'nothing refused is stored');
    await store.put(logo.file, PNG, 'logo');
    await store.put(mark.file, SVG, 'mark');
    await store.put(mark.file, SVG, 'mark'); // same name = same bytes: a second upload is a no-op
    assert.equal(table.rows.size, 2);
  });

  await t.test('an uploaded image is not served until a document names it', async () => {
    assert.equal((await fetch(`${base}/asset/${logo.file}`)).status, 404);
    assert.ok(await store.stored(logo.file), 'the owner panel can preview it');
  });

  await t.test('a document names images: listed with hash URLs once loaded from the table', async () => {
    await save(branding());
    const before = await read();
    assert.equal(before.siteName, 'parker567');
    assert.equal(before.titleTemplate, '%s · Parker567');
    assert.deepEqual(before.keywords, ['casino', 'sports']);
    assert.equal(before.themeColor, '#24EE89');
    // The read kicked a load; wait for the explicit sync too (what the store's onChange runs).
    const result = await store.sync(entitlementsStore.current().branding);
    assert.deepEqual(result.failed, []);
    const after = await read();
    assert.equal(after.logoUrl, `/api/v1/admin/branding/asset/${logo.file}`);
    assert.equal(after.markUrl, `/api/v1/admin/branding/asset/${mark.file}`);
    assert.equal(after.ogImageUrl, null);
    assert.ok(!JSON.stringify(after).includes(SECRET));
  });

  await t.test('the asset route serves the bytes immutable and inert', async () => {
    const res = await fetch(`${base}/asset/${mark.file}`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'image/svg+xml');
    assert.match(res.headers.get('cache-control'), /immutable/);
    assert.match(res.headers.get('content-security-policy'), /sandbox/);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('etag'), `"${sha(SVG)}"`);
    assert.deepEqual(Buffer.from(await res.arrayBuffer()), SVG);
    const png = await fetch(`${base}/asset/${logo.file}`);
    assert.equal(png.headers.get('content-type'), 'image/png');
  });

  await t.test('strict validators: bad names, traversal and query strings are refused', async () => {
    for (const p of [`/asset/${'f'.repeat(64)}.png`]) assert.equal((await fetch(base + p)).status, 404);
    for (const p of ['/asset/..%2F..%2Fowner-entitlements.json', `/asset/${logo.file.toUpperCase()}`, `/asset/${sha(PNG)}.jpg`, '/asset/x.png']) {
      const status = (await fetch(base + p)).status;
      assert.ok(status === 422 || status === 400, `${p} → ${status}`);
    }
    assert.ok([400, 422].includes((await fetch(`${base}/public?x=1`)).status));
    assert.ok([400, 422].includes((await fetch(`${base}/asset/${logo.file}?v=1`)).status));
  });

  await t.test('a document naming an image never uploaded lists no URL for it', async () => {
    const other = { ...logo, file: `${'0'.repeat(64)}.png` };
    const result = await store.sync({ ...entitlementsStore.current().branding, ogImage: other });
    assert.deepEqual(result.failed, [other.file]);
    assert.equal((await fetch(`${base}/asset/${other.file}`)).status, 404);
  });

  await t.test('an image the document stops naming stops being served', async () => {
    await save(branding({ mark: null }));
    await store.sync(entitlementsStore.current().branding);
    assert.equal((await fetch(`${base}/asset/${mark.file}`)).status, 404);
    assert.equal((await fetch(`${base}/asset/${logo.file}`)).status, 200);
  });
});

test('the Super Admin logo: the newer of the owner\'s and the Super Admin\'s shows', async () => {
  const store = createBrandingStore({ logger, models: assetTable() });
  const PNG2 = Buffer.concat([PNG, Buffer.from('super-admin')]);
  const PNG3 = Buffer.concat([PNG, Buffer.from('owner-new')]);
  await store.put(logo.file, PNG, 'logo');
  const owner = branding({ mark: null });
  await store.sync(owner);
  assert.match(store.view(owner, 1).logoUrl, new RegExp(logo.file));

  await store.setSite('logo', PNG2, { staff: { id: 1 }, ownerBranding: owner });
  assert.match(store.view(owner, 1).logoUrl, new RegExp(sha(PNG2)), 'the Super Admin set it last');

  // The owner saves a different logo afterwards: the owner's is the newer one now.
  const newer = { ...ref(PNG3, 'png', 'image/png'), width: 576 };
  await store.put(newer.file, PNG3, 'logo');
  const owner2 = branding({ mark: null, logo: newer });
  await store.sync(owner2);
  assert.match(store.view(owner2, 2).logoUrl, new RegExp(newer.file));

  // A Super Admin image with no owner branding at all still shows; reset brings back the UI's own.
  await store.setSite('mark', SVG, { staff: { id: 1 }, ownerBranding: null });
  assert.match(store.view(null, 0).markUrl, new RegExp(sha(SVG)));
  await store.clearSite('mark', { ownerBranding: null });
  assert.equal(store.view(null, 0).markUrl, null);
  await assert.rejects(() => store.setSite('ogImage', PNG, { ownerBranding: null }));
});

test("the Super Admin's name and metadata: the newer of the owner's and the Super Admin's shows", async () => {
  const table = assetTable();
  const store = createBrandingStore({ logger, models: table });
  const owner = cleanBranding(branding({ logo: null, mark: null }));
  assert.equal(store.view(owner, 1).title, 'Parker567 — Casino & Sports');

  const saved = await store.setMeta({ siteName: 'Parker', title: 'Parker — Play', titleTemplate: '%s | Parker', description: 'New text', keywords: ['bet', 'Bet', 'win'], ogTitle: '', ogDescription: '', themeColor: '#abcdef' }, { staff: { id: 1 }, ownerBranding: owner });
  assert.deepEqual(saved.keywords, ['bet', 'win']);
  let seen = store.view(owner, 1);
  assert.equal(seen.siteName, 'Parker');
  assert.equal(seen.title, 'Parker — Play', 'the Super Admin set it last');
  assert.equal(seen.themeColor, '#ABCDEF');
  assert.equal(store.metaBySite(owner), true);

  // A restart reads it back from the table.
  const again = createBrandingStore({ logger, models: table });
  await again.sync(owner);
  assert.equal(again.view(owner, 1).title, 'Parker — Play');

  // The owner saves an unrelated change: still the Super Admin's. The owner changes the metadata: the owner's.
  assert.equal(store.view({ ...owner, ogImage: null }, 2).title, 'Parker — Play');
  const owner2 = { ...owner, description: 'Owner wrote this later' };
  seen = store.view(owner2, 3);
  assert.equal(seen.title, 'Parker567 — Casino & Sports');
  assert.equal(seen.description, 'Owner wrote this later');
  assert.equal(store.metaBySite(owner2), false);

  // No owner branding at all: the Super Admin's shows; reset brings back the site's own.
  await store.setMeta({ siteName: 'Solo', title: 'Solo site', titleTemplate: '', description: '', keywords: [], ogTitle: '', ogDescription: '', themeColor: '' }, { staff: { id: 1 }, ownerBranding: null });
  assert.equal(store.view(null, 0).siteName, 'Solo');
  assert.equal(store.view(null, 0).branded, true);
  await store.clearMeta();
  assert.equal(store.view(null, 0).branded, false);
});

test('the Super Admin metadata body: limits, no markup, a template with %s once', () => {
  const { siteMeta } = require('../branding.validators');
  assert.equal(siteMeta.safeParse({ title: 'Fine' }).success, true);
  assert.equal(siteMeta.safeParse({ title: '<script>x</script>' }).success, false);
  assert.equal(siteMeta.safeParse({ titleTemplate: 'no placeholder' }).success, false);
  assert.equal(siteMeta.safeParse({ themeColor: 'red' }).success, false);
  assert.equal(siteMeta.safeParse({ siteName: 'x'.repeat(41) }).success, false);
  assert.equal(siteMeta.safeParse({ keywords: Array(21).fill('k') }).success, false);
  assert.equal(siteMeta.safeParse({ extra: 1 }).success, false);
});
