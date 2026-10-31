'use strict';

const { PLATFORM_EVENTS, roomForUser, encode } = require('@ibitplay/socket');
const { sendSuccessEmail } = require('./successEmail');

/**
 * Tell a player something happened to their account.
 *
 *     notifyPlayer(userId, {
 *       kind: 'deposit_approved',               // the bell picks the icon on this
 *       key: `fiat-deposit:approved:${id}`,     // names the EVENT — idempotency
 *       title: 'Deposit approved',
 *       body: '{amount} has been added to your wallet.',
 *       link: '/transactions',
 *       meta: { amount: '500.00', currency: 'INR' },
 *     });
 *
 * ── RULES FOR CALLERS ────────────────────────────────────────────────────
 *
 *   - Call it AFTER the money moved (after COMMIT), and do not await it. It
 *     returns a promise that never rejects, so `void notifyPlayer(…)` is the
 *     whole call. A notification is a courtesy; the money is the truth.
 *   - The `key` names the event, not the call: the same event reported twice
 *     (a PSP retry, a replayed hook, a double-click) lands on one row.
 *   - `{amount}` in `body` is replaced with `meta.amount meta.currency` for
 *     the stored text (push, fallback); the template itself travels in the
 *     row's data so the bell can format the figure in the player's style.
 *
 * ── WHERE IT GOES ────────────────────────────────────────────────────────
 *
 * The row is written by admin-service — it owns `user_notifications` — over
 * `PUT /internal/admin/notifications/player`, the same seam the inbox reads
 * use. A NEW row is then pushed to the player's open sockets as
 * `notificationsUnread` (`{ status, unread, notification }`), the event the
 * header bell already asks with, so the badge moves without waiting for the
 * next poll.
 *
 * `deps` (`{ clients, io, logger }`) is the user-service container. It is
 * registered once at boot by `configureNotifier`, so a call site needs no
 * plumbing; a test passes its own as the third argument or configures one.
 */

let defaultDeps = null;

/** Register the container this process notifies through. Called at boot. */
function configureNotifier(deps) {
  defaultDeps = deps ?? null;
}

/* Keys this process already delivered, so a hot path (affiliate commission on
   every wager) does not pay an internal hop per call. Bounded; a restart
   forgets, and the unique index is still the real guard. */
const SENT = new Set();
const SENT_MAX = 5000;

/* In-flight sends, so a test (or a graceful shutdown) can wait for them. */
const PENDING = new Set();

/** "500" + "INR" → "500.00 INR"; 8-dp crypto keeps up to 8, trimmed. */
function amountText(amount, currency) {
  const n = Number.parseFloat(String(amount ?? '0'));
  if (!Number.isFinite(n)) return `${amount} ${currency ?? ''}`.trim();
  const code = String(currency ?? '').toUpperCase();
  const fixed = n.toFixed(Math.abs(n) >= 1 ? 2 : 8).replace(/(\.\d{2}\d*?)0+$/, '$1');
  return code ? `${fixed} ${code}` : fixed;
}

function render(template, meta) {
  if (!template) return null;
  if (!template.includes('{amount}')) return template;
  return template.replaceAll('{amount}', amountText(meta?.amount, meta?.currency));
}

async function sendOne(deps, userId, n) {
  const key = String(n.key);
  const memo = `${userId}|${key}`;
  if (SENT.has(memo)) return { created: false, skipped: 'ALREADY_SENT' };

  const meta = n.meta ?? null;
  const data = {
    kind: n.kind,
    ...(n.link ? { link: n.link } : {}),
    ...(meta ? { meta } : {}),
    ...(n.body && n.body.includes('{amount}') ? { template: n.body } : {}),
  };

  const result = await deps.clients.admin.request('PUT', '/internal/admin/notifications/player', {
    body: {
      userId: Number(userId),
      kind: n.kind,
      title: n.title,
      body: render(n.body, meta),
      key,
      data,
    },
  });

  SENT.add(memo);
  if (SENT.size > SENT_MAX) SENT.delete(SENT.values().next().value);

  // The deposit / withdrawal success email, once per event (a replay finds the row already there).
  if (result?.created) void sendSuccessEmail(deps, userId, n, amountText(meta?.amount, meta?.currency));

  if (result?.created && deps.io) {
    deps.io.to(roomForUser(String(userId))).emit(
      PLATFORM_EVENTS.NOTIFICATIONS_UNREAD,
      encode({
        status: true,
        unread: Number(result.unread ?? 0),
        notification: { id: result.id, kind: n.kind, title: n.title, link: n.link ?? null },
      })
    );
  }
  return result;
}

/**
 * @param {number|string} userId
 * @param {object|object[]} input  one notification, or several for one event
 * @param {object} [deps]          overrides the configured container
 * @returns {Promise<object[]>}    never rejects
 */
function notifyPlayer(userId, input, deps = defaultDeps) {
  const list = (Array.isArray(input) ? input : [input]).filter((n) => n && n.kind && n.key && n.title);
  const run = (async () => {
    if (!userId || !list.length || !deps?.clients?.admin) return [];
    const out = [];
    for (const n of list) {
      try {
        out.push(await sendOne(deps, userId, n));
      } catch (error) {
        deps.logger?.warn(
          { err: error?.message, userId: String(userId), kind: n.kind, key: n.key },
          'Player notification not sent — the action itself is unaffected'
        );
        out.push({ created: false, error: error?.message ?? 'ERROR' });
      }
    }
    return out;
  })();
  PENDING.add(run);
  run.finally(() => PENDING.delete(run));
  return run;
}

/**
 * A bonus / reward that just landed in the wallet: one `bonus_credited` row, the bell's Promotions
 * tab. `n` is `{ key, title, amount, currency, link? }`; a zero amount tells nobody.
 */
function notifyBonus(userId, n) {
  if (!n || !(Number(n.amount) > 0)) return Promise.resolve([]);
  return notifyPlayer(userId, {
    kind: 'bonus_credited',
    key: n.key,
    title: n.title,
    body: '{amount} has been added to your wallet.',
    link: n.link ?? '/bonus',
    meta: { amount: String(n.amount), currency: n.currency },
  });
}

/** `notifyBonus` as a `.then()` after the COMMIT: `describe(result)` names the notice, the result passes through. */
const afterBonus = (userId, describe) => (result) => {
  void notifyBonus(userId, describe(result));
  return result;
};

/** Wait for every notification this process has in flight. */
async function settleNotifications() {
  while (PENDING.size) await Promise.allSettled([...PENDING]);
}

/** Tests: forget what was sent, so a fresh run talks to its own fake. */
function resetNotifierMemo() {
  SENT.clear();
}

module.exports = { notifyPlayer, notifyBonus, afterBonus, configureNotifier, settleNotifications, resetNotifierMemo, amountText };
