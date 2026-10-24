'use strict';

const test = require('node:test');
const assert = require('node:assert');

/**
 * `legacy/` is a sibling of `backend/`, so this climbs out of the backend —
 * and it is NOT in every checkout.
 *
 * It used to be required at the top level, which meant a missing `legacy/`
 * threw before the first test registered and took the whole file with it:
 * frame encoding, the rate limiter and the non-ASCII name fix were all lost
 * to a dependency none of them have. Only the protocol comparison below
 * genuinely needs the monolith, so only that part stands down when it is
 * absent — and it SKIPS rather than passes, because "the wire protocol still
 * matches" is a claim this file cannot make without the thing to compare to.
 */
let legacyConstants = null;
try {
  legacyConstants = require('../../../../legacy/General/Constant');
} catch (error) {
  if (error?.code !== 'MODULE_NOT_FOUND') throw error;
}
const { EVENTS, NAME_OF, encode, decode, MAX_FRAME_BYTES, createRateLimiter } = require('../src');

/**
 * The socket foundation.
 *
 * The first test is the important one: the event names ARE the client protocol,
 * and a single character different anywhere silently kills that event for every
 * player — the server listens on one string, the client sends another, and
 * neither side errors.
 */

test('the event table is the legacy protocol, byte for byte', async (t) => {
  if (!legacyConstants) {
    t.skip('legacy/ is not in this checkout — nothing to compare the wire protocol against');
    return;
  }

  await t.test('every legacy key is present with the same value', () => {
    const differences = [];

    for (const [key, wire] of Object.entries(legacyConstants)) {
      if (EVENTS[key] !== wire) differences.push({ key, legacy: wire, ported: EVENTS[key] });
    }

    assert.deepEqual(differences, [], 'a differing value would silently break that event');
  });

  await t.test('nothing was invented', () => {
    const extra = Object.keys(EVENTS).filter((key) => !(key in legacyConstants));
    assert.deepEqual(extra, []);
  });

  await t.test('the keys that look like typos are preserved', () => {
    /**
     * `PLAT_SLOTS` (not PLAY_), `inr_History` (not INR_HISTORY). They are
     * inconsistent with everything around them and they are what the clients
     * send. Pinned so a future tidy-up fails here rather than in production.
     */
    assert.equal(EVENTS.PLAT_SLOTS, legacyConstants.PLAT_SLOTS);
    assert.equal(EVENTS.inr_History, legacyConstants.inr_History);
  });

  await t.test('the hand-edited values are preserved', () => {
    // These contain characters no hash function produces — somebody edited
    // them by hand years ago and the clients still send them.
    assert.match(EVENTS.RAKEBACK_AMOUNT, /h6fl9jxd7hm7$/);
    assert.match(EVENTS.SUBMIT_NEW_SWAP, /ci73bd3$/);
  });

  await t.test('TWO LEGACY EVENTS SHARE ONE WIRE NAME', () => {
    /**
     * ═══════════════════════════════════════════════════════════════════
     * `ERROR_CLASSIC_DICE` and `ERROR_HASH_DICE` are both
     * `"ef39faa35d2060a86223756ad06a18a2"`.
     *
     * Found by this test failing on the round-trip assertion, which is what
     * it was written to catch — a reverse lookup cannot distinguish them.
     *
     * On the wire they are ONE event. A client listening for a classic-dice
     * error receives hash-dice errors too, and vice versa. Both are error
     * channels for near-identical games, so the symptom is mild — an error
     * toast naming the wrong game — but it is not intentional, and anything
     * that ever branches on which game errored is wrong.
     *
     * NOT fixed here: changing either value changes the protocol, and a
     * client listening on the shared name would stop receiving one of them
     * entirely. It is pinned instead, so it stays visible.
     * ═══════════════════════════════════════════════════════════════════
     */
    assert.equal(EVENTS.ERROR_CLASSIC_DICE, EVENTS.ERROR_HASH_DICE);

    // And it is the ONLY collision — every other name is distinct.
    const byWire = new Map();
    const collisions = [];
    for (const [key, wire] of Object.entries(EVENTS)) {
      if (byWire.has(wire)) collisions.push([byWire.get(wire), key]);
      else byWire.set(wire, key);
    }
    assert.deepEqual(collisions, [['ERROR_CLASSIC_DICE', 'ERROR_HASH_DICE']]);
  });

  await t.test('every distinct wire name round-trips', () => {
    for (const [key, wire] of Object.entries(EVENTS)) {
      // The one collision resolves to the LAST key declared with that value —
      // `Object.fromEntries` keeps the later entry. Asserted explicitly below
      // rather than left to chance.
      if (key === 'ERROR_CLASSIC_DICE') continue;
      assert.equal(NAME_OF[wire], key, `${key} does not round-trip`);
    }

    assert.equal(NAME_OF[EVENTS.ERROR_CLASSIC_DICE], 'ERROR_HASH_DICE');
  });
});

test('the wire format', async (t) => {
  await t.test('a payload round-trips', () => {
    const payload = { status: true, balance: '100.50000000', rows: [1, 2, 3] };
    assert.deepEqual(decode(encode(payload)), payload);
  });

  await t.test('A NON-ASCII NAME SURVIVES — legacy CORRUPTED it', () => {
    /**
     * ═══════════════════════════════════════════════════════════════════
     * `Buffer.from(str, 'binary')` is latin1: it keeps the low byte of each
     * UTF-16 code unit and DISCARDS the rest. The decoder is `TextDecoder`,
     * which is UTF-8.
     *
     * The result is CORRUPTION, not rejection — which is worse. The frame
     * still parses as JSON, so nothing errors and nothing is logged; the
     * values inside are simply wrong. A player named `José` is `Jos\uFFFD`,
     * and `नमस्ते` comes back as `(.8M$G`.
     *
     * (My first version of this test asserted `JSON.parse` throws. It does
     * not — the mangled bytes are still syntactically valid JSON. Asserted
     * against the real behaviour below.)
     * ═══════════════════════════════════════════════════════════════════
     */
    const payload = { name: 'José', message: 'नमस्ते', emoji: '🎲' };
    assert.deepEqual(decode(encode(payload)), payload);

    // The legacy encoding, to show the difference is real:
    const legacyRoundTrip = JSON.parse(
      new TextDecoder().decode(Buffer.from(JSON.stringify(payload), 'binary'))
    );

    assert.notEqual(legacyRoundTrip.name, 'José');
    assert.notEqual(legacyRoundTrip.message, 'नमस्ते');
    assert.notEqual(legacyRoundTrip.emoji, '🎲');
    // Silently, with no error anywhere.
    assert.equal(typeof legacyRoundTrip.name, 'string');
  });

  await t.test('a falsy payload encodes to null, as legacy clients expect', () => {
    // Several handlers emit `encode(result)` where `result` can be false; the
    // clients read a null frame as "no data" rather than erroring.
    assert.equal(encode(null), null);
    assert.equal(encode(false), null);
    assert.equal(encode(undefined), null);
  });

  await t.test('an undecodable frame THROWS rather than returning undefined', () => {
    // Legacy caught, logged to stdout and returned nothing — so the caller
    // destructured `undefined` and threw somewhere unrelated.
    assert.throws(() => decode(Buffer.from('not json at all', 'utf8')), (err) => err.code === 'SOCKET_BAD_FRAME');
  });

  await t.test('an oversized frame is refused', () => {
    // Legacy had no limit, on a socket anyone could open.
    const huge = Buffer.alloc(MAX_FRAME_BYTES + 1, 0x41);
    assert.throws(() => decode(huge), (err) => err.code === 'SOCKET_FRAME_TOO_LARGE');
  });

  await t.test('an already-parsed object is accepted', () => {
    // Some legacy clients send JSON rather than a Buffer. Rejecting them would
    // break working sessions.
    assert.deepEqual(decode({ token: 'abc' }), { token: 'abc' });
  });

  await t.test('null and undefined decode to null, not a throw', () => {
    assert.equal(decode(null), null);
    assert.equal(decode(undefined), null);
  });
});

test('rate limiting', async (t) => {
  await t.test('a burst is capped and the window then resets', async () => {
    const limiter = createRateLimiter({});
    const limit = { windowMs: 50, max: 3 };

    assert.equal(limiter.allow('a:evt', limit), true);
    assert.equal(limiter.allow('a:evt', limit), true);
    assert.equal(limiter.allow('a:evt', limit), true);
    assert.equal(limiter.allow('a:evt', limit), false, 'the fourth is over');

    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.equal(limiter.allow('a:evt', limit), true, 'and the window reset');

    limiter.stop();
  });

  await t.test('one connection cannot exhaust another', () => {
    const limiter = createRateLimiter({});
    const limit = { windowMs: 1000, max: 1 };

    assert.equal(limiter.allow('a:evt', limit), true);
    assert.equal(limiter.allow('a:evt', limit), false);
    assert.equal(limiter.allow('b:evt', limit), true, 'a different key is unaffected');

    limiter.stop();
  });

  await t.test('one event cannot exhaust another on the same connection', () => {
    const limiter = createRateLimiter({});
    const limit = { windowMs: 1000, max: 1 };

    assert.equal(limiter.allow('a:login', limit), true);
    assert.equal(limiter.allow('a:login', limit), false);
    assert.equal(limiter.allow('a:credit', limit), true);

    limiter.stop();
  });

  await t.test('a disconnected connection is forgotten', () => {
    /**
     * Without this the map grows for the life of the process — every key any
     * socket ever used.
     */
    const limiter = createRateLimiter({});
    const limit = { windowMs: 1000, max: 5 };

    limiter.allow('gone:one', limit);
    limiter.allow('gone:two', limit);
    limiter.allow('stays:one', limit);
    assert.equal(limiter.size, 3);

    limiter.forget('gone');
    assert.equal(limiter.size, 1);

    limiter.stop();
  });
});
