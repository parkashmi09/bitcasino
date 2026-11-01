'use strict';

const { QueryTypes } = require('sequelize');
const { money } = require('@ibitplay/common');

const { whitelabelById, callCopy } = require('./hubCredentials');

/**
 * Parent side: a provider wallet callback for a whitelabel copy's player (player id
 * `wl<whitelabel>_<player>`, which only the parent writes, at launch). The parent has already
 * verified the provider's signature; the copy settles it on its own wallet — the same code as its
 * own callbacks — and its answer goes back to the provider unchanged. An accepted money callback
 * is recorded in `whitelabel_casino_rounds` (the GGR report).
 *
 * No answer from the copy = the provider is told it failed (a bet is then not placed; a win or
 * refund is retried by the provider, and the copy applies each transaction once).
 */

const WL_PLAYER = /^wl(\d{1,9})_(\d{1,20})$/;

/** `{ whitelabelId, playerId }` for a copy's player id, else null. */
function whitelabelPlayer(playerId) {
  const m = WL_PLAYER.exec(String(playerId ?? ''));
  return m ? { whitelabelId: Number(m[1]), playerId: m[2] } : null;
}

const decimal = (v) => {
  try {
    return money.toDecimalString(money.toMinorQuantised(String(v ?? '0')));
  } catch {
    return '0.00000000';
  }
};

/**
 * Record a money callback the copy accepted. One row per provider transaction and kind.
 * `rows` = [{ kind, transactionId, amount }].
 */
async function recordRounds(db, { whitelabelId, product, provider, playerId, game, currency }, rows) {
  for (const r of rows) {
    if (!r.transactionId) continue;
    await db.sequelize.query(
      `INSERT INTO whitelabel_casino_rounds (whitelabel_id, product, provider, kind, transaction_id, player_id, game, currency, amount)
       VALUES (:whitelabelId, :product, :provider, :kind, :transactionId, :playerId, :game, :currency, :amount)
       ON CONFLICT (provider, transaction_id, kind) DO NOTHING RETURNING id`,
      {
        replacements: {
          whitelabelId,
          product,
          provider,
          kind: r.kind,
          transactionId: String(r.transactionId).slice(0, 128),
          playerId: String(playerId).slice(0, 40),
          game: game ? String(game).slice(0, 128) : null,
          currency: String(currency ?? '').toUpperCase().slice(0, 10) || 'INR',
          amount: decimal(r.amount),
        },
        type: QueryTypes.SELECT,
      }
    );
  }
}

/** Slotegrator's rounds in one callback: bet / win / refund, or what a rollback reversed (bets − wins). */
function gisRounds(body) {
  const action = String(body.action ?? '');
  if (['bet', 'win', 'refund'].includes(action)) return [{ kind: action, transactionId: body.transaction_id, amount: body.amount }];
  if (action === 'rollback') {
    const entries = Array.isArray(body.rollback_transactions) ? body.rollback_transactions : [];
    let reversed = 0n;
    for (const t of entries) {
      const minor = money.toMinorQuantised(decimal(t?.amount));
      if (t?.action === 'bet') reversed += minor;
      else if (t?.action === 'win') reversed -= minor;
    }
    return [{ kind: 'rollback', transactionId: body.transaction_id, amount: money.toDecimalString(reversed) }];
  }
  return [];
}

/**
 * Pass a verified Slotegrator callback to the copy and answer with the copy's answer.
 * `fail(description)` builds Slotegrator's error answer (GisService's own).
 */
async function forwardGis(deps, { whitelabelId, playerId, body }, fail) {
  const wl = await whitelabelById(deps, whitelabelId);
  if (!wl || wl.status !== 'live' || !wl.secret) return fail('Player not found');
  let answer;
  try {
    answer = await callCopy(wl, 'POST', '/in/gis', { ...body, player_id: playerId }, { timeoutMs: 8_000 });
  } catch (error) {
    deps.logger?.error({ err: error.message, whitelabelId, action: body?.action }, 'Whitelabel did not settle a Slotegrator callback');
    return fail('Whitelabel unavailable');
  }
  if (answer && !answer.error_code) {
    try {
      await recordRounds(
        deps.db,
        { whitelabelId, product: 'casino', provider: 'gis', playerId, game: body.game_uuid, currency: body.currency },
        gisRounds(body)
      );
    } catch (error) {
      // The round stands on the copy; only the report row is missing — loud, never a failed callback.
      deps.logger?.error({ err: error.message, whitelabelId, transactionId: body?.transaction_id }, 'Could not record a whitelabel casino round');
    }
  }
  return answer;
}

/** Original games' amounts are integer minor units at the coin's exponent (INR 2, USDT 6). */
function ogDecimal(value, currency) {
  const exponent = { INR: 2, USDT: 6 }[String(currency).toUpperCase()];
  if (!exponent || !Number.isSafeInteger(value) || value < 0) return '0.00000000';
  return money.toDecimalString(BigInt(value) * 10n ** BigInt(8 - exponent));
}

/**
 * Pass a verified original-games callback (`action` balance | bet | win | rollback) to the copy and
 * answer with the copy's `{ status, body }`. A rollback names the transaction it reverses, not an
 * amount: the report row takes that round's amount (a reversed bet counts back, a reversed win too).
 * `error(code, { currency })` builds the provider's refusal (OriginalGamesService's own).
 */
async function forwardOg(deps, { whitelabelId, playerId, action, body }, error) {
  const currency = body?.currency;
  const wl = await whitelabelById(deps, whitelabelId);
  if (!wl || wl.status !== 'live' || !wl.secret) return error('PLAYER_NOT_FOUND', { currency });
  let answer;
  try {
    answer = await callCopy(wl, 'POST', '/in/og', { action, body: { ...body, player_id: playerId } }, { timeoutMs: 8_000 });
  } catch (err) {
    deps.logger?.error({ err: err.message, whitelabelId, action }, 'Whitelabel did not settle an original-games callback');
    return error('INTERNAL_ERROR', { currency });
  }
  if (answer?.body?.status === 'OK' && ['bet', 'win', 'rollback'].includes(action)) {
    try {
      let rows = [{ kind: action, transactionId: body.transaction_id, amount: ogDecimal(body.amount, currency) }];
      if (action === 'rollback') {
        const [reversed] = await deps.db.sequelize.query(
          `SELECT kind, amount FROM whitelabel_casino_rounds WHERE provider = 'og' AND transaction_id = :ref AND kind IN ('bet', 'win') LIMIT 1`,
          { replacements: { ref: String(body.reference_transaction_id ?? '') }, type: QueryTypes.SELECT }
        );
        const amount = reversed ? (reversed.kind === 'bet' ? money.fromStored(reversed.amount) : money.toDecimalString(-money.toMinorQuantised(reversed.amount))) : '0';
        rows = [{ kind: 'rollback', transactionId: body.transaction_id, amount }];
      }
      await recordRounds(deps.db, { whitelabelId, product: 'originals', provider: 'og', playerId, game: body.game_code, currency }, rows);
    } catch (err) {
      deps.logger?.error({ err: err.message, whitelabelId, transactionId: body?.transaction_id }, 'Could not record a whitelabel originals round');
    }
  }
  return answer ?? error('INTERNAL_ERROR', { currency });
}

module.exports = { whitelabelPlayer, forwardGis, forwardOg, recordRounds, gisRounds };
