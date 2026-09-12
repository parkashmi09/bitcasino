'use strict';

const SHA256 = require('crypto-js/sha256');

/**
 * The in-house game result generator.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * PORTED AS-IS FROM `legacy/Games/Hash.js`, ON INSTRUCTION
 *
 * The arithmetic below is byte-for-byte legacy's. It was not redesigned,
 * because the games' behaviour is a product decision and the instruction was
 * to take it as it stands.
 *
 * Two properties of it are worth having written down in one place, so that
 * changing them later is a small edit rather than an archaeology exercise.
 * Neither is a change; both are descriptions.
 *
 * ── 1. THE OUTCOME SOURCE IS `Math.random()` ─────────────────────────────
 *
 *     function randomString(length) {
 *       var chars = '0123456789abcdefghiklmnopqrstuvwxyz'.split('');
 *       for (var i = 0; i < length; i++)
 *         str += chars[Math.floor(Math.random() * chars.length)];
 *     }
 *
 * `makeHash` is SHA-256 OF THAT STRING. Hashing does not add entropy — the
 * result carries exactly the randomness of `Math.random()`, which in V8 is
 * xorshift128+ and is not cryptographically secure. All sixteen games draw
 * from the one generator.
 *
 * The swap is `randomString` → `crypto.randomBytes`, one function, and
 * `SEED_SOURCE` below is where it goes. Left as legacy has it.
 *
 * ── 2. THERE IS NO CLIENT SEED AND NO COMMITMENT ─────────────────────────
 *
 * `makeHash()` takes no player input, and the hash is generated at the same
 * moment as the result rather than published beforehand. So the `hash` a
 * player is shown is not something they can verify a result against — it is a
 * value produced alongside it. Whatever the UI calls it, the mechanism is not
 * a provably-fair one.
 *
 * ── 3. AND THE `normal = false` BRANCH RE-ROLLS ──────────────────────────
 *
 *     if (!normal) {
 *       if (type === null) {
 *         if (result > 2.00) return Hash.make(normal);
 *       }
 *     }
 *
 * Results above 2.00 are discarded and drawn again, which is not a uniform
 * distribution. Nothing in the ported code calls `make(false)` — legacy did
 * not either, in any live path — but the branch is carried over with the rest.
 * ═════════════════════════════════════════════════════════════════════════
 */

const ALPHABET = '0123456789abcdefghiklmnopqrstuvwxyz'.split('');

/**
 * The seed source, isolated.
 *
 * This is the one function to change to make outcomes unpredictable. It is
 * `Math.random()` because that is what legacy uses and the instruction was to
 * port as-is.
 */
const SEED_SOURCE = () => Math.floor(Math.random() * ALPHABET.length);

/** Legacy's `randomString`, unchanged. */
function randomString(length) {
  let str = '';
  for (let i = 0; i < length; i += 1) str += ALPHABET[SEED_SOURCE()];
  return str;
}

/** Legacy's `makeHash`, unchanged — including the fourteen leading zeros. */
function makeHash() {
  const key = `00000000000000${randomString(50)}`;
  return SHA256(key).toString();
}

/**
 * Legacy's `makeResult`, unchanged.
 *
 * The `98` is the house edge expressed as a percentage of the multiplier
 * curve: `floor((98 * 2^52) / (2^52 - h)) / 100`.
 */
function makeResult(seed) {
  const hash = SHA256(seed).toString();
  const h = parseInt(hash.slice(0, 13), 16);
  const e = 2 ** 52;
  const result = Math.floor((98 * e) / (e - h));
  return (result / 100).toFixed(2);
}

/**
 * Legacy's `Hash.make`, unchanged.
 *
 * @param {boolean} normal When false and `type` is null, results above 2.00 are
 *   re-rolled. See the header — nothing calls it that way.
 */
function make(normal = true, type = null) {
  const hash = makeHash();
  const result = makeResult(hash);

  if (!normal && type === null && result > 2.0) return make(normal);

  return { hash, result };
}

module.exports = { make, makeHash, makeResult, randomString, SEED_SOURCE, ALPHABET };
