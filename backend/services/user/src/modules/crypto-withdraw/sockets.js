'use strict';

const { EVENTS, AUDIENCE } = require('@ibitplay/socket');
const { money } = require('@ibitplay/common');
const { verifyPassword } = require('@ibitplay/auth');
const { Op, literal } = require('sequelize');

const errors = require('./cryptoWithdraw.errors');
const { SwapService } = require('../swap/swap.service');

/**
 * Withdrawals, swaps and the deposit address — the last three money events.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * A WITHDRAWAL WAS INSERTED BEFORE THE MONEY WAS TAKEN
 *
 * `Rule.newWithdrawal`, in order:
 *
 *     pg.query("INSERT INTO withdrawals(uid, amount, wallet, status, coin, chain) ...",
 *       function (err, result) {
 *         ...
 *         Rule.reduceBalance(id, fullAmount, coin, (isOk) => {
 *
 * The request row exists first and the debit follows, with no transaction
 * between them. If the debit fails, an operator is looking at a pending payout
 * for money that is still in the player's balance — and `reduceBalance` has no
 * floor, so it can also take the balance negative.
 *
 * The affordability check before it is the usual unlocked read:
 *
 *     Rule.getClientCoinCredit(id, coin, (credit) => {
 *       if (credit < fullAmount) return callback({ status: "Your Credit is not Enough." });
 *
 * so two concurrent withdrawals both pass it.
 *
 * ── WHAT LEGACY GOT RIGHT ────────────────────────────────────────────────
 *
 * It asks for the password, and verifies it against the hash before anything
 * moves. That is more than the deposit path did, and it is kept.
 * ═════════════════════════════════════════════════════════════════════════
 */

const ok = (payload) => ({ status: true, ...payload });
const refuse = (error) => ({ status: error.message, error: { code: error.code } });

/** The wallet column a coin lives on. A map, never a string in the SQL. */
const COIN_COLUMNS = Object.freeze({
  BTC: 'btc', ETH: 'eth', LTC: 'ltc', BCH: 'bch', USDT: 'usdt', TRX: 'trx',
  DOGE: 'doge', ADA: 'ada', XRP: 'xrp', BNB: 'bnb', USDC: 'usdc', BUSD: 'busd',
  SHIB: 'shib', MATIC: 'matic', INR: 'inr',
});

/** `nc` is play money — legacy refuses it here too. */
const BLOCKED = ['NC'];

function register({ on, deps }) {
  const { models, db, logger } = deps;
  const swapService = new SwapService(deps);

  /**
   * @legacy SOCKET 7c0b37955cf21c7f2f3773c1268edc08
   *
   * `C.SUBMIT_NEW_WITHDRAWL` — request a payout.
   */
  on(EVENTS.SUBMIT_NEW_WITHDRAWL, {
    audience: AUDIENCE.USER,
    // Money leaving the platform. Legacy metered nothing.
    limit: { windowMs: 60 * 60_000, max: 10 },
    handle: async (payload, context) => {
      const { wallet, amount, coin, password, chain } = payload ?? {};
      const currency = String(coin ?? '').toUpperCase();

      try {
        if (BLOCKED.includes(currency)) throw errors.UNSUPPORTED_COIN({ coin: currency });

        const column = COIN_COLUMNS[currency];
        if (!column) throw errors.UNSUPPORTED_COIN({ coin: currency });

        const requested = money.toMinor(String(amount ?? '0'));
        if (requested <= 0n) throw errors.INVALID_AMOUNT({ amount });

        const address = String(wallet ?? '').trim();
        if (!address) throw errors.INVALID_ADDRESS();

        const user = await models.Users.findOne({
          where: { id: context.userId },
          attributes: ['id', 'password', 'status', 'system_locked'],
          raw: true,
        });
        if (!user) throw errors.PLAYER_NOT_FOUND();

        /**
         * The password check, kept from legacy — it is the one thing that path
         * did well. Verified before anything moves.
         */
        const verified = user.password ? await verifyPassword(String(password ?? ''), user.password) : false;
        if (!verified) throw errors.PASSWORD_INCORRECT();

        // A locked account cannot withdraw. Legacy checked nothing here, so a
        // lock applied because money was going missing did not stop the payout.
        if (user.system_locked || user.status === 'closed') throw errors.ACCOUNT_LOCKED();

        const decimal = money.toDecimalString(requested);

        /**
         * ONE transaction: the guarded debit and the request row together. The
         * row cannot exist without the money having moved, and the money
         * cannot move without a row to account for it.
         */
        const result = await db.transaction(async (transaction) => {
          const [affected] = await models.Credits.update(
            { [column]: literal(`"${column}" - ${decimal}`) },
            { where: { uid: context.userId, [column]: { [Op.gte]: decimal } }, transaction }
          );

          if (!affected) throw errors.INSUFFICIENT_BALANCE({ coin: currency });

          const row = await models.Withdrawals.create(
            {
              uid: context.userId,
              amount: decimal,
              wallet: address,
              // Every withdrawal is reviewed. Legacy inserted `'pending'` too.
              status: 'pending',
              coin: currency.toLowerCase(),
              chain: chain ? String(chain) : null,
              date: new Date(),
            },
            { transaction }
          );

          return { id: String(row.id) };
        });

        logger?.warn(
          {
            userId: String(context.userId),
            amount: decimal,
            coin: currency,
            withdrawalId: result.id,
            // The address is NOT logged in full — it is a payment destination.
            address: `${address.slice(0, 6)}…${address.slice(-4)}`,
          },
          'Withdrawal requested'
        );

        return ok({ id: result.id, amount: decimal, coin: currency, state: 'pending' });
      } catch (error) {
        if (error.code?.startsWith('CRYPTOWITHDRAW_')) return refuse(error);
        throw error;
      }
    },
  });

  /**
   * @legacy SOCKET f2ca6e08d1e7d76f6ddcbcdubci73bd3
   *
   * `C.SUBMIT_NEW_SWAP` — exchange one balance for another.
   *
   * ─────────────────────────────────────────────────────────────────────
   * LEGACY TOOK BOTH SIDES FROM THE CLIENT
   *
   *     Rule.swapCoins(id, amount, amount1, coin, coin1, immed, callback)
   *
   * `amount` is what leaves and `amount1` is what arrives — so the client
   * supplied the RATE by supplying both numbers. Nothing on the server priced
   * the swap.
   *
   * `SwapService` quotes it from `exchangerate` and moves both sides in one
   * transaction. The client says what it wants to swap, not what it gets.
   * ─────────────────────────────────────────────────────────────────────
   */
  on(EVENTS.SUBMIT_NEW_SWAP, {
    audience: AUDIENCE.USER,
    limit: { windowMs: 60_000, max: 20 },
    handle: async (payload, context) => {
      const { coin, coin1, amount } = payload ?? {};

      try {
        const result = await swapService.swap({
          userId: String(context.userId),
          fromCurrency: String(coin ?? '').toUpperCase(),
          toCurrency: String(coin1 ?? '').toUpperCase(),
          amount: String(amount ?? '0'),
        });
        return ok(result);
      } catch (error) {
        if (error.code?.startsWith('SWAP_') || error.code?.startsWith('WALLET_')) return refuse(error);
        throw error;
      }
    },
  });

  /**
   * @legacy SOCKET 396bbdcf7c16c3f3795d932b698ef78f
   *
   * `C.GET_ADDRESS` — the player's deposit address for a coin and chain.
   *
   * A read of an address already allocated. Legacy's `getWalletAddress` is a
   * `SELECT` too — it does not call out to a wallet daemon, so there is no
   * generation path here and an unallocated coin answers plainly rather than
   * inventing one.
   */
  on(EVENTS.GET_ADDRESS, {
    audience: AUDIENCE.USER,
    handle: async (payload, context) => {
      const currency = String(payload?.coin ?? '').toUpperCase();
      const chain = payload?.chain ? String(payload.chain) : null;

      if (!COIN_COLUMNS[currency]) return refuse(errors.UNSUPPORTED_COIN({ coin: currency }));

      const row = await models.Wallets.findOne({
        where: {
          uid: context.userId,
          coin: currency.toLowerCase(),
          ...(chain ? { chain } : {}),
        },
        raw: true,
      });

      if (!row) return ok({ coin: currency, chain, address: null, allocated: false });

      return ok({ coin: currency, chain: row.chain ?? chain, address: row.address, allocated: true });
    },
  });

  logger?.debug('Withdrawal, swap and address socket events registered');
}

module.exports = { register };
