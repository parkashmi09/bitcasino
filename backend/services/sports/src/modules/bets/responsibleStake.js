'use strict';

/**
 * The player's own breaks and limits (user-service responsible-gambling) before an exchange stake.
 *
 * Exchange placement debits `credits` itself, not through the wallet's `debit` (where BET_STAKE is
 * checked), so it asks first, as the casino in-house engine does. `sports: true` covers SPORTS and
 * PLATFORM breaks; the check reads the break at stake time, so a token issued before a PLATFORM
 * break does not get past it. A refusal is the wallet's own 403 RESPONSIBLE_*; an unreachable
 * user-service is an error too (fail closed), never a pass.
 *
 * Runs after `authMiddleware`. A slip with no currency or stake passes through: the handler
 * refuses it before any debit.
 */
const isBadloLeg = (l) => l?.badlo === true || String(l?.badlo) === 'true' || String(l?.market_type || '').toLowerCase() === 'badlo';

function slipStake(body) {
  const legs = Array.isArray(body?.bets) ? body.bets : null;
  if (!legs) return { currency: body?.currency ?? body?.original_currency, amount: Number(body?.stake_amount) };
  const stakes = legs.map((l) => Number(l?.stake_amount));
  // A badlo slip risks its largest leg, as placeCombinedBet counts it.
  const amount = legs.length && legs.every(isBadloLeg) ? Math.max(...stakes) : stakes.reduce((s, n) => s + n, 0);
  return { currency: legs[0]?.currency ?? legs[0]?.original_currency, amount };
}

function responsibleStake({ clients }) {
  return async function responsibleStakeMiddleware(req, _res, next) {
    try {
      const userId = req.user?.account?.id;
      const { currency, amount } = slipStake(req.body);
      if (!userId || typeof currency !== 'string' || !(amount > 0)) return next();
      await clients.user.post('/internal/user/responsible-gambling/check', {
        userId: String(userId),
        currency: currency.trim(),
        amount: String(amount),
        sports: true,
      });
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

module.exports = { responsibleStake, slipStake };
