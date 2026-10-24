'use strict';

const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');

const { SecretBox, createSecretBox } = require('../src/secretBox');
const totp = require('../src/totp');

/**
 * Encryption at rest for second-factor secrets, and one-time use for codes.
 *
 * Both close the same class of problem: a credential that could be used more
 * than once by more than one person.
 */

const KEY = crypto.randomBytes(32).toString('hex');
const SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
const silent = { info() {}, warn() {}, error() {}, debug() {} };

test('secret box', async (t) => {
  const box = new SecretBox({ key: KEY, logger: silent });

  await t.test('a sealed secret round-trips', () => {
    const sealed = box.seal(SECRET);
    assert.equal(box.open(sealed), SECRET);
  });

  await t.test('the plaintext is not recoverable from the stored value', () => {
    const sealed = box.seal(SECRET);
    assert.ok(!sealed.includes(SECRET));
    assert.ok(sealed.startsWith('v1.'), 'the version prefix is what makes rotation possible later');
    assert.equal(sealed.split('.').length, 4, 'version.iv.tag.ciphertext');
  });

  await t.test('the same secret seals differently every time', () => {
    /**
     * A fresh 96-bit IV per call. Reusing an IV under one key in GCM leaks the
     * XOR of the plaintexts and can expose the authentication key — so it is
     * generated per call and never derived from the record.
     */
    assert.notEqual(box.seal(SECRET), box.seal(SECRET));
  });

  await t.test('a tampered ciphertext is refused, not silently mis-decrypted', () => {
    /**
     * The reason for GCM over CBC or CTR. Both would decrypt happily and hand
     * back wrong bytes; an attacker with write access to the database could
     * then flip bits in a stored secret and the application would generate
     * codes against a value it partly controls.
     */
    const parts = box.seal(SECRET).split('.');
    const bytes = Buffer.from(parts[3], 'base64url');
    bytes[0] ^= 0xff;

    assert.equal(box.open([parts[0], parts[1], parts[2], bytes.toString('base64url')].join('.')), null);
  });

  await t.test('a tampered authentication tag is refused', () => {
    const parts = box.seal(SECRET).split('.');
    const tag = Buffer.from(parts[2], 'base64url');
    tag[0] ^= 0xff;

    assert.equal(box.open([parts[0], parts[1], tag.toString('base64url'), parts[3]].join('.')), null);
  });

  await t.test('another key cannot open it', () => {
    const other = new SecretBox({ key: crypto.randomBytes(32).toString('hex'), logger: silent });
    assert.equal(other.open(box.seal(SECRET)), null);
  });

  await t.test('a legacy plaintext secret still works, and is marked for resealing', () => {
    /**
     * The migration window. Every account enrolled before encryption existed
     * holds a bare base32 secret; refusing to read those would have locked all
     * of them out the moment this deployed.
     */
    assert.equal(box.open(SECRET), SECRET);
    assert.equal(box.needsResealing(SECRET), true);
    assert.equal(box.needsResealing(box.seal(SECRET)), false);
  });

  await t.test('a value that is neither sealed nor a valid secret is unusable', () => {
    /**
     * Returning garbage would hand `speakeasy` something to generate codes
     * from, which fails as "wrong code" and reads to the account holder as a
     * broken authenticator rather than a broken record.
     */
    for (const junk of ['not-a-secret!!', 'v1.only.three', '', null, undefined, 'lowercase-not-base32']) {
      assert.equal(box.open(junk), null, `${JSON.stringify(junk)} must not open`);
    }
  });

  await t.test('sealing requires something to seal', () => {
    assert.throws(() => box.seal(''), /non-empty/);
    assert.throws(() => box.seal(null), /non-empty/);
  });

  await t.test('a hex key, a base64 key and a passphrase are all accepted', () => {
    const hex = new SecretBox({ key: crypto.randomBytes(32).toString('hex') });
    const b64 = new SecretBox({ key: crypto.randomBytes(32).toString('base64') });
    // Stretched with HKDF rather than truncated or padded — a passphrase used
    // verbatim as an AES key has far less entropy than its length suggests.
    const phrase = new SecretBox({ key: 'a passphrase somebody typed' });

    for (const b of [hex, b64, phrase]) assert.equal(b.open(b.seal(SECRET)), SECRET);
  });

  await t.test('the same passphrase always derives the same key', () => {
    const a = new SecretBox({ key: 'stable input' });
    const b = new SecretBox({ key: 'stable input' });
    assert.equal(b.open(a.seal(SECRET)), SECRET, 'otherwise a restart would orphan every secret');
  });

  await t.test('createSecretBox prefers the dedicated key', () => {
    const explicit = createSecretBox({
      config: { TOTP_ENCRYPTION_KEY: KEY, JWT_ADMIN_SECRET: 'x'.repeat(48) },
      logger: silent,
    });
    assert.equal(explicit.open(new SecretBox({ key: KEY }).seal(SECRET)), SECRET);
  });

  await t.test('createSecretBox falls back to JWT_ADMIN_SECRET, loudly', () => {
    /**
     * The fallback still defeats the threat this exists for — a database copy
     * read WITHOUT the application's environment. What it costs is independent
     * rotation, which is why the warning names that consequence.
     */
    const warnings = [];
    const box2 = createSecretBox({
      config: { JWT_ADMIN_SECRET: 'y'.repeat(48) },
      logger: { ...silent, warn: (m) => warnings.push(m) },
    });

    assert.equal(box2.open(box2.seal(SECRET)), SECRET);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /TOTP_ENCRYPTION_KEY/);
    assert.match(warnings[0], /lock out everyone enrolled/);
  });

  await t.test('createSecretBox refuses to guess when there is no key at all', () => {
    assert.throws(() => createSecretBox({ config: {}, logger: silent }), /TOTP_ENCRYPTION_KEY/);
  });
});

test('totp one-time use', async (t) => {
  await t.test('a valid code reports the step it belongs to', () => {
    const { valid, step } = totp.verifyCodeWithStep({ secret: SECRET, code: totp.currentCode(SECRET) });
    assert.equal(valid, true);
    assert.equal(step, Math.floor(Date.now() / 1000 / totp.STEP_SECONDS));
  });

  await t.test('a code cannot be spent twice', () => {
    /**
     * The whole point. A code is valid for its full acceptance window — three
     * 30-second steps with `window: 1` — so without recording the step, the
     * same six digits work repeatedly for up to 90 seconds.
     */
    const code = totp.currentCode(SECRET);

    const first = totp.verifyCodeOnce({ secret: SECRET, code, lastUsedStep: null });
    assert.equal(first.valid, true);

    const second = totp.verifyCodeOnce({ secret: SECRET, code, lastUsedStep: first.step });
    assert.equal(second.valid, false);
    assert.equal(second.replayed, true);
  });

  await t.test('a wrong code is not reported as a replay', () => {
    /**
     * The caller logs these differently — a replay attempt is a far more
     * interesting event than a typo — so the two must not be conflated.
     */
    const result = totp.verifyCodeOnce({ secret: SECRET, code: '000000', lastUsedStep: null });
    assert.equal(result.valid, false);
    assert.equal(result.replayed, false);
    assert.equal(result.step, null);
  });

  await t.test('a code from before the last accepted step is refused', () => {
    const code = totp.currentCode(SECRET);
    const now = Math.floor(Date.now() / 1000 / totp.STEP_SECONDS);

    const result = totp.verifyCodeOnce({ secret: SECRET, code, lastUsedStep: now + 5 });
    assert.equal(result.valid, false);
    assert.equal(result.replayed, true);
  });

  await t.test('the next step is accepted after the current one is spent', () => {
    /**
     * Clock drift is real, and refusing everything after one success would
     * make the second factor unusable on any phone running slightly fast.
     */
    const speakeasy = require('speakeasy');
    const now = Math.floor(Date.now() / 1000 / totp.STEP_SECONDS);
    const next = speakeasy.totp({
      secret: SECRET,
      encoding: 'base32',
      time: Date.now() / 1000 + totp.STEP_SECONDS,
    });

    const result = totp.verifyCodeOnce({ secret: SECRET, code: next, lastUsedStep: now });
    assert.equal(result.valid, true);
    assert.equal(result.step, now + 1);
  });

  await t.test('malformed input is refused without throwing', () => {
    for (const code of ['', '12345', '1234567', 'abcdef', null, undefined, '12 345']) {
      const r = totp.verifyCodeOnce({ secret: SECRET, code, lastUsedStep: null });
      assert.equal(r.valid, false, `${JSON.stringify(code)} must not verify`);
    }
    assert.equal(totp.verifyCodeOnce({ secret: null, code: '123456' }).valid, false);
  });
});
