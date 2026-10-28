'use strict';

const { EVENTS, AUDIENCE } = require('@ibitplay/socket');
const { sitePolicy, currencyRegistry, assertCurrencySupportedFor } = require('@ibitplay/common');
const { verifyPassword, assertPlayerCapability } = require('@ibitplay/auth');

const errors = require('./cryptoWithdraw.errors');
const { COIN_COLUMNS } = require('./cryptoWithdraw.constants');
const { CryptoWithdrawService } = require('./cryptoWithdraw.service');
const { networksFor } = require('../crypto/crypto.networks');
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
/** The wagering refusal carries what is left to wager, as the HTTP rails do (`details`). */
const refuseWithDetails = (error) => ({ status: error.message, error: { code: error.code, details: error.details ?? null } });

function register({ on, deps }) {
  const { models, logger } = deps;
  const swapService = new SwapService(deps);
  const withdrawals = new CryptoWithdrawService(deps);

  /**
   * @legacy SOCKET 7c0b37955cf21c7f2f3773c1268edc08
   *
   * `C.SUBMIT_NEW_WITHDRAWL` — request a payout.
   *
   * ─────────────────────────────────────────────────────────────────────
   * THE MONEY MOVES IN `CryptoWithdrawService.request`, NOT HERE
   *
   * This handler used to debit `credits` with its own raw UPDATE — no ledger
   * row, so `reconcile` drifted for every player who withdrew — and insert
   * the row as `'pending'`, which the queue's state machine does not know,
   * so staff could never approve or reject it. It now runs the cheap refusals
   * (agent player, withdraw block, system lock, site policy), then checks the
   * password (the socket's own gate, kept from legacy) and hands the request to the
   * service: the guarded `WalletService.debit` WITHDRAWAL hold, the `In Queue`
   * row, KYC and wagering (the owner's withdrawal requirements), minimum, cooldown and
   * idempotency the fiat rail already has.
   * ─────────────────────────────────────────────────────────────────────
   */
  on(EVENTS.SUBMIT_NEW_WITHDRAWL, {
    audience: AUDIENCE.USER,
    // Money leaving the platform. Legacy metered nothing.
    limit: { windowMs: 60 * 60_000, max: 10 },
    handle: async (payload, context) => {
      const { wallet, amount, coin, password, chain, forfeitBonus } = payload ?? {};

      try {
        // Agent-tree players are refused before anything else, the password included.
        await assertPlayerCapability(context.userId, 'withdraw');
        // Then the other cheap refusals — a withdraw block, a system lock, the site's policy
        // closed — so a blocked player is told why, not first that their password is wrong.
        await withdrawals.assertMayRequest(context.userId);

        const user = await models.Users.findOne({
          where: { id: context.userId },
          attributes: ['id', 'password'],
          raw: true,
        });
        if (!user) throw errors.PLAYER_NOT_FOUND();

        /**
         * The password check, kept from legacy — it is the one thing that path
         * did well. Verified before anything moves.
         */
        const verified = user.password ? await verifyPassword(String(password ?? ''), user.password) : false;
        if (!verified) throw errors.PASSWORD_INCORRECT();

        const result = await withdrawals.request({
          userId: context.userId,
          coin,
          amount,
          wallet,
          chain,
          forfeitBonus: forfeitBonus === true,
        });

        // The shape this event has always answered with. `state` stays
        // 'pending' (awaiting review); `queueStatus` is the row's real status.
        return ok({
          id: String(result.id),
          amount: result.amount,
          coin: result.coin,
          state: 'pending',
          queueStatus: result.status,
        });
      } catch (error) {
        // The site's own policy refusal is an answer for the player, not a server fault.
        if (
          error.code?.startsWith('CRYPTO_WITHDRAW_') ||
          error.code?.startsWith('SITE_POLICY_') ||
          error.code === 'WITHDRAW_NOT_FOR_AGENT_USERS' ||
          error.code === 'WITHDRAW_BLOCKED' ||
          error.code === 'BONUS_FORFEIT_REQUIRED' ||
          error.code === 'BONUS_WAGER_REQUIRED'
        ) {
          return refuse(error);
        }
        // Wagering left, or over the deposit cap (its figures), or the cap could not be checked.
        if (['WITHDRAW_WAGER_REQUIRED', 'WITHDRAW_CAP_EXCEEDED', 'WITHDRAW_CAP_CHECK_FAILED'].includes(error.code)) return refuseWithDetails(error);
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
   *
   * ─────────────────────────────────────────────────────────────────────
   * `wallets` HAS NO `chain` COLUMN
   *
   *   CREATE TABLE public.wallets (address text, uid bigint, coin text, date …)
   *
   * That is the whole table, in the baseline schema and after every migration.
   * This handler used to put `chain` in the WHERE and read `row.chain` back
   * out, so any caller that supplied one produced
   * `42703 column "chain" does not exist`, the handler threw, and the client
   * got a bare `SOCKET_HANDLER_FAILED` — "That action could not be completed"
   * — with nothing anywhere naming the column.
   *
   * Nothing had ever called the event, so nothing had ever hit it. Found on
   * 3 Sep 2026 wiring the cashier's deposit panel (gap report §3.1), which is
   * the first caller and passes a chain because a USDT address is only
   * meaningful with one.
   *
   * Allocation on this schema is per (uid, coin), so that is what is looked
   * up. The requested chain is echoed back for the client to label the address
   * with — it is the caller's own value, not a fact from the row, and saying
   * so is better than dropping it and letting the panel print an address under
   * whichever network happens to be selected. `chain` belongs to
   * `withdrawals`, which does have the column; it was borrowed here in error.
   * ─────────────────────────────────────────────────────────────────────
   */
  on(EVENTS.GET_ADDRESS, {
    audience: AUDIENCE.USER,
    handle: async (payload, context) => {
      const currency = String(payload?.coin ?? '').toUpperCase();
      const chain = payload?.chain ? String(payload.chain) : null;

      // A deposit address is the gateway route: the provider credits it by callback.
      try {
        // Agent-tree players are funded by their agent only — no deposit rail.
        await assertPlayerCapability(context.userId, 'deposit');
        await sitePolicy.assertAllowed(models, 'deposit_mode', 'automatic', logger);
        // An owner-created coin has no deposit address: CURRENCY_NOT_SUPPORTED_FOR_DEPOSIT.
        assertCurrencySupportedFor('DEPOSIT', currency);
      } catch (error) {
        return refuse(error);
      }

      if (!COIN_COLUMNS[currency]) return refuse(errors.UNSUPPORTED_COIN({ coin: currency }));
      // The coin registry (migration 061): a switched-off coin or network gets no address.
      try {
        await currencyRegistry.assertRegistryReadable();
      } catch (error) {
        return refuse(error);
      }
      if (!(await currencyRegistry.isEnabled(currency))) return refuse(errors.UNSUPPORTED_COIN({ coin: currency }));
      if (chain) {
        const offered = await networksFor(currency);
        if (!offered.some((n) => n.key === chain)) {
          return refuse(errors.NETWORK_UNAVAILABLE({ coin: currency, chain: chain.slice(0, 20), offered: offered.map((n) => n.key) }));
        }
      }

      const row = await models.Wallets.findOne({
        where: { uid: context.userId, coin: currency.toLowerCase() },
        raw: true,
      });

      if (!row) return ok({ coin: currency, chain, address: null, allocated: false });

      return ok({ coin: currency, chain, address: row.address, allocated: true });
    },
  });

  logger?.debug('Withdrawal, swap and address socket events registered');
}

module.exports = { register };
