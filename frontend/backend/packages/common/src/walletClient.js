'use strict';

/**
 * The money contract, as a typed client.
 *
 * Casino and sports both need to debit stakes and credit payouts, and both need
 * to do it with the same idempotency discipline. Left to raw `ServiceClient`
 * calls, each service ends up with its own spelling of the path, its own key
 * format, and its own idea of whether a rollback is required — and the one that
 * gets it subtly wrong pays a player twice.
 *
 * This lives in `@ibitplay/common` rather than a service because it is a
 * platform contract with more than one consumer. It knows the SHAPE of the
 * money API and nothing about what the money is for.
 *
 *   const wallet = new WalletClient({ client: deps.clients.user, service: 'casino-service' });
 *
 *   const { ledgerId } = await wallet.debit({
 *     userId, currency: 'INR', amount: '20.00',
 *     reason: 'BET_STAKE', ref: { type: 'BET', id: betId },
 *   });
 */

class WalletClient {
  /**
   * @param {object} opts
   * @param {object} opts.client   ServiceClient pointed at user-service.
   * @param {string} opts.service  This service's name, used to build idempotency keys.
   * @param {object} [opts.logger]
   */
  constructor({ client, service, logger }) {
    if (!client) throw new Error('WalletClient requires a ServiceClient for user-service');
    this.client = client;
    this.service = service;
    this.logger = logger;
  }

  /**
   * Build the idempotency key for a movement.
   *
   * Derived from what the movement IS — service, reason, and the thing it
   * refers to — rather than generated per attempt. A key that changes on retry
   * is not an idempotency key; it is a second payment.
   *
   * `BET_STAKE` on bet 91 is always `casino-service:BET_STAKE:BET:91`, so a
   * retry after a timeout collapses onto the original no matter how many times
   * it is attempted or which instance attempts it.
   */
  key(reason, ref) {
    if (!ref?.type || ref.id === undefined || ref.id === null) {
      throw new Error(
        `WalletClient.${reason}: a ref { type, id } is required to derive an idempotency key. ` +
          `Without one, a retry becomes a second movement.`
      );
    }
    return `${this.service}:${reason}:${ref.type}:${ref.id}`;
  }

  /**
   * Take money from a player.
   *
   * Throws `INSUFFICIENT_FUNDS` (402) when the balance will not cover it —
   * `ServiceClient` preserves the upstream code, so that reaches the player as
   * "insufficient funds" rather than a generic 503.
   */
  async debit({ userId, currency, amount, reason, ref, description, ...context }) {
    return this.client.post('/internal/user/wallet/debit', {
      body: {
        userId, currency, amount, reason, description,
        idempotencyKey: this.key(reason, ref),
        refType: ref.type,
        refId: String(ref.id),
        ...context,
      },
    });
  }

  /** Give money to a player. */
  async credit({ userId, currency, amount, reason, ref, description, ...context }) {
    return this.client.post('/internal/user/wallet/credit', {
      body: {
        userId, currency, amount, reason, description,
        idempotencyKey: this.key(reason, ref),
        refType: ref.type,
        refId: String(ref.id),
        ...context,
      },
    });
  }

  /**
   * Undo a movement whose caller failed afterwards.
   *
   * The compensating half of the stake protocol: debit, write the bet, and if
   * the write fails, put the stake back. Never let this throw out of the
   * failure path it is compensating for — see `debitThen`.
   */
  async rollback({ ledgerId, reason = 'Compensating rollback' }) {
    return this.client.post('/internal/user/wallet/rollback', {
      body: {
        ledgerId,
        reason,
        idempotencyKey: `${this.service}:ROLLBACK:LEDGER:${ledgerId}`,
      },
    });
  }

  async balance(userId, currency) {
    return this.client.get(`/internal/user/wallet/balance/${userId}`, {
      query: currency ? { currency } : undefined,
    });
  }

  /**
   * Debit, run `work`, and refund automatically if `work` fails.
   *
   * This is the shape every stake should use, because the dangerous window is
   * between "money has left the wallet" and "the bet exists". Written by hand,
   * that window ends up guarded in some code paths and not others.
   *
   *   const bet = await wallet.debitThen(
   *     { userId, currency, amount, reason: 'BET_STAKE', ref: { type: 'BET', id } },
   *     async (movement) => BetRepository.create({ ..., ledgerId: movement.ledgerId })
   *   );
   *
   * A refund that itself fails is logged at `fatal` with everything needed to
   * reconcile by hand, and the ORIGINAL error is rethrown — the caller needs to
   * know the bet failed, not that the cleanup did.
   */
  async debitThen(movementInput, work) {
    const movement = await this.debit(movementInput);

    try {
      return await work(movement);
    } catch (error) {
      try {
        await this.rollback({
          ledgerId: movement.ledgerId,
          reason: `Automatic refund: ${error.code || error.message}`,
        });
        this.logger?.warn(
          { ledgerId: movement.ledgerId, userId: movementInput.userId, err: error },
          'Work failed after debit — stake refunded'
        );
      } catch (refundError) {
        this.logger?.fatal(
          {
            err: refundError,
            originalError: error,
            ledgerId: movement.ledgerId,
            userId: movementInput.userId,
            currency: movementInput.currency,
            amount: movementInput.amount,
          },
          'REFUND FAILED after a failed debit — money has left a wallet with nothing to show for it. ' +
            'This needs manual reconciliation.'
        );
      }
      throw error;
    }
  }
}

module.exports = { WalletClient };
