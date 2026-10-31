'use strict';

const test = require('node:test');
const assert = require('node:assert');

const T = 'https://embed.test/embed/{gmid}?theme=dark';

test('getCricketEmbedUrl: 200 → url, 404 → null, timeout → null, cached per gmid, empty template → null', async () => {
  const { ScoreAnimationService_default: S } = await import('../services/ScoreAnimationService.mjs');
  let calls = 0;
  const get = (status) => async () => { calls++; return { status }; };

  assert.strictEqual(await S.getCricketEmbedUrl('1', { template: T, get: get(200) }), 'https://embed.test/embed/1?theme=dark');
  assert.strictEqual(await S.getCricketEmbedUrl('2', { template: T, get: get(404) }), null);
  assert.strictEqual(await S.getCricketEmbedUrl('3', { template: T, get: async () => { throw new Error('timeout of 4000ms exceeded'); } }), null);

  calls = 0;
  assert.strictEqual(await S.getCricketEmbedUrl('1', { template: T, get: get(404) }), 'https://embed.test/embed/1?theme=dark');
  assert.strictEqual(calls, 0, 'cached answer, no second fetch');
  const later = () => Date.now() + 4 * 60e3;
  assert.strictEqual(await S.getCricketEmbedUrl('1', { template: T, get: get(404), now: later }), null);
  assert.strictEqual(calls, 1, 'expired entry is re-checked');

  assert.strictEqual(await S.getCricketEmbedUrl('9', { template: '', get: get(200) }), null);
});
