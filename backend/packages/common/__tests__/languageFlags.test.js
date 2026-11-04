'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { flagOnIn } = require('../src/entitlements');

/**
 * The owner's Languages switches. The first nine read ON when never set, as every flag does;
 * the eleven added for roobet's picker read OFF until the owner switches them on, so a site
 * whose owner never saw them does not start offering them.
 */
test('language flags', async (t) => {
  await t.test('the first nine read on when the owner never set them', () => {
    for (const code of ['en', 'ar', 'es', 'fr', 'ja', 'pt', 'ru', 'tr', 'zh']) {
      assert.equal(flagOnIn({ flags: {} }, `lang_${code}`), true, code);
    }
  });

  await t.test('the later eleven read off until switched on', () => {
    for (const code of ['en-IN', 'hi', 'sr', 'cs', 'fil', 'fa', 'id', 'fi', 'vi', 'th', 'ko']) {
      assert.equal(flagOnIn({ flags: {} }, `lang_${code}`), false, code);
      assert.equal(flagOnIn({ flags: { [`lang_${code}`]: true } }, `lang_${code}`), true, code);
    }
  });

  await t.test('an owner switching one off is honoured', () => {
    assert.equal(flagOnIn({ flags: { lang_fr: false } }, 'lang_fr'), false);
  });
});
