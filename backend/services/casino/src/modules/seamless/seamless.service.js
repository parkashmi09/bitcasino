'use strict';

const crypto = require('crypto');

const { money } = require('@ibitplay/common');

const {
  RESPONSE_CODES,
  ACTION,
  THOUSANDS_CURRENCIES,
  THOUSANDS_FACTOR,
  VALID_CURRENCIES,
  SETTLEMENT_CURRENCY,
} = require('./seamless.constants');

/**
 * The casino provider's seamless wallet.
 *
 * The provider holds no balance of its own: every bet and every win is an HTTP
 * call to us. These seven endpoints are therefore the busiest money surface on
 * the platform, and the legacy implementation had four independent defects.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 1. THE SIGNATURE COVERS ONLY THE ACTION NAME
 *
 *      md5(operator_code + request_time + action + SECRET_KEY)
 *
 *    Not the member. Not the amount. Not the transactions. So one captured
 *    `deposit` signature was valid for ANY deposit, of ANY amount, for ANY
 *    member — and `request_time` is a caller-supplied field that was never
 *    checked, so it never expired. The key itself was hard-coded in the source.
 *
 *    This is the provider's protocol and cannot be fixed from here. What CAN be
 *    done, and is done below, is to stop a captured signature being useful:
 *
 *      - `request_time` must be recent (SEAMLESS_MAX_SKEW_SECONDS). A captured
 *        signature dies with its timestamp instead of lasting forever.
 *      - Every transaction id is recorded under a unique index, so a replay has
 *        to invent ids — and an invented id has no bet behind it to settle.
 *      - A stronger signature scheme is used instead when the provider supports
 *        one (SEAMLESS_SIGN_MODE=full), covering member, amount and ids.
 *
 * 2. DUPLICATE DETECTION WAS A STUB
 *
 *      const checkDuplicateTransaction = async (id) => false;  // Mock response
 *
 *    Providers retry. Every retried win was paid again.
 *
 * 3. THE BALANCE WAS WRITTEN AS AN ABSOLUTE VALUE
 *
 *      let balance = await getPlayerBalance(...)   // read
 *      balance -= amount                           // compute in JavaScript
 *      UPDATE credits SET usdt = $1                // write the whole figure
 *
 *    Two concurrent requests both read 100; one writes 90, the other writes
 *    150, and one of them is simply lost. A bet settling while a deposit landed
 *    erased the deposit. Every movement here goes through the wallet, which
 *    applies a guarded delta the database arbitrates.
 *
 * 4. THE THOUSANDS CONVERSION WAS APPLIED TO THE WHOLE BALANCE
 *
 *      balance -= amount;
 *      if (isThousandsCurrency) balance /= 1000;
 *      updatePlayerBalance(member, balance);
 *
 *    So any withdraw or deposit in IDR2/KRW2/MMK2/VND2/LAK2/KHR2 divided the
 *    player's ENTIRE STORED BALANCE by a thousand. It scales the amount here,
 *    and nothing else.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Every method returns the provider's response shape — `{code, message, ...}`
 * with the codes it expects. A thrown error would produce our envelope, which
 * the provider's client cannot read, and it retries on anything it cannot read.
 */
class SeamlessService {
  constructor({ models, db, config, logger, wallet }) {
    this.models = models;
    this.db = db;
    this.config = config;
    this.logger = logger;
    this.wallet = wallet;
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Reads
  // ══════════════════════════════════════════════════════════════════════

  /** @legacy POST /api/seamless/balance */
  async getBalance(body) {
    const check = this.#verify(body, ACTION.BALANCE);
    if (check) return check;

    const { member_account: member, currency } = body;
    if (!VALID_CURRENCIES.has(currency)) {
      return { code: RESPONSE_CODES.INCORRECT_AGENT_KEY, message: 'Invalid currency' };
    }

    const userId = await this.#resolveUser(member);
    if (userId == null) return { code: RESPONSE_CODES.MEMBER_NOT_EXISTS, message: 'Member not exists' };

    const balance = await this.#balanceOf(userId);

    return {
      code: RESPONSE_CODES.SUCCESS,
      message: 'Success',
      // Quoted in the provider's units — a display conversion, which is the
      // one place legacy applied it correctly.
      balance: this.#toProviderUnits(balance, currency),
    };
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Money
  // ══════════════════════════════════════════════════════════════════════

  /**
   * @legacy POST /api/seamless/withdraw
   *
   * A bet. Money leaves the player.
   */
  async withdraw(body) {
    return this.#move(body, {
      action: ACTION.WITHDRAW,
      direction: 'debit',
      reason: 'BET_STAKE',
      insufficientIsAnError: true,
    });
  }

  /**
   * @legacy POST /api/seamless/deposit
   *
   * A win. Money arrives.
   */
  async deposit(body) {
    return this.#move(body, { action: ACTION.DEPOSIT, direction: 'credit', reason: 'BET_PAYOUT' });
  }

  /**
   * @legacy POST /api/seamless/transfer
   *
   * A signed adjustment — the provider uses it for jackpot contributions and
   * promotional credit. Negative amounts take money; positive amounts give it.
   */
  async transfer(body) {
    return this.#move(body, { action: ACTION.TRANSFER, direction: 'signed', reason: 'BET_PAYOUT' });
  }

  /** @legacy POST /api/seamless/pushbet — a bet recorded after the fact. */
  async pushBet(body) {
    return this.#move({ ...body }, { action: ACTION.PUSHBET, direction: 'debit', reason: 'BET_STAKE' });
  }

  /**
   * @legacy POST /api/seamless/rollback
   *
   * Undo a movement we already applied.
   *
   * The amount comes from OUR record of the original transaction, never from
   * the rollback request — otherwise a rollback naming a larger figure than the
   * bet it reverses is a withdrawal.
   */
  async rollback(body) {
    return this.#reverse(body, ACTION.ROLLBACK, 'BET_ROLLBACK');
  }

  /** @legacy POST /api/seamless/cancel — the same shape as a rollback. */
  async cancel(body) {
    return this.#reverse(body, ACTION.CANCEL, 'BET_REFUND');
  }

  // ══════════════════════════════════════════════════════════════════════

  /**
   * The one implementation the three forward money actions share.
   *
   * Transactions are applied one at a time, each with its own idempotency key,
   * rather than summed and applied once. That matters on a retry: if a batch of
   * three was half-applied, replaying it must complete the other two and skip
   * the first, which a single summed movement cannot express.
   */
  async #move(body, { action, direction, reason, insufficientIsAnError = false }) {
    const check = this.#verify(body, action);
    if (check) return check;

    const { member_account: member, currency, transactions } = body;

    if (!VALID_CURRENCIES.has(currency)) {
      return { code: RESPONSE_CODES.INCORRECT_AGENT_KEY, message: 'Invalid currency' };
    }
    if (!Array.isArray(transactions) || !transactions.length) {
      return { code: RESPONSE_CODES.API_ERROR, message: 'No transactions supplied' };
    }

    const userId = await this.#resolveUser(member);
    if (userId == null) return { code: RESPONSE_CODES.MEMBER_NOT_EXISTS, message: 'Member not exists' };

    const beforeBalance = await this.#balanceOf(userId);
    let balance = beforeBalance;

    for (const tx of transactions) {
      if (!tx?.id) return { code: RESPONSE_CODES.API_ERROR, message: 'Transaction id is required' };

      // THE THOUSANDS SCALE APPLIES HERE, TO THE AMOUNT, AND NOWHERE ELSE.
      const providerAmount = String(tx.amount ?? '0');
      const amount = this.#toSettlementUnits(providerAmount, currency);

      const signed = direction === 'signed';
      const isCredit = signed ? !money.lt(amount, '0') : direction === 'credit';
      const magnitude = money.toDecimalString(money.abs(amount));

      if (money.isZero(magnitude)) continue;

      const outcome = await this.#applyOnce({
        userId, member, body, tx, action, reason,
        isCredit, magnitude, providerAmount, currency,
      });

      if (outcome.duplicate) {
        // Already applied. The provider is retrying; tell it so and keep the
        // balance we have rather than applying anything again.
        this.logger?.info({ member, transactionId: tx.id, action }, 'Duplicate seamless transaction ignored');
        continue;
      }

      if (outcome.insufficient) {
        if (insufficientIsAnError) {
          return {
            code: RESPONSE_CODES.INSUFFICIENT_BALANCE,
            message: 'Insufficient balance',
            before_balance: this.#toProviderUnits(beforeBalance, currency),
            balance: this.#toProviderUnits(balance, currency),
          };
        }
        continue;
      }

      if (outcome.error) {
        return { code: RESPONSE_CODES.INTERNAL_SERVER_ERROR, message: 'Internal server error' };
      }

      balance = outcome.balance ?? balance;
    }

    return {
      code: RESPONSE_CODES.SUCCESS,
      message: '',
      before_balance: this.#toProviderUnits(beforeBalance, currency),
      balance: this.#toProviderUnits(balance, currency),
    };
  }

  /**
   * Apply one transaction, exactly once.
   *
   * The record is written FIRST, inside the same transaction as the money. If
   * the unique index rejects it we have seen this transaction id before, the
   * whole thing rolls back, and nothing moves. That ordering is what makes the
   * guard a guard rather than a race.
   */
  async #applyOnce({ userId, member, body, tx, action, reason, isCredit, magnitude, providerAmount, currency }) {
    try {
      return await this.db.transaction(async (transaction) => {
        await this.models.SeamlessTransaction.create(
          {
            transaction_id: String(tx.id),
            action,
            member_account: String(member),
            user_id: userId,
            operator_code: body.operator_code ?? null,
            product_code: body.product_code ?? null,
            game_code: tx.game_code ?? null,
            round_id: tx.round_id ?? null,
            currency,
            provider_amount: providerAmount,
            amount: isCredit ? magnitude : money.toDecimalString(money.negate(magnitude)),
            payload: tx,
          },
          { transaction }
        );

        const movement = await this.wallet[isCredit ? 'credit' : 'debit']({
          userId,
          currency: SETTLEMENT_CURRENCY,
          amount: magnitude,
          reason,
          ref: { type: 'SEAMLESS', id: String(tx.id) },
          description: `${action} ${tx.id}`,
        });

        await this.models.SeamlessTransaction.update(
          { ledger_id: movement.ledgerId ?? null },
          { where: { transaction_id: String(tx.id), action }, transaction }
        );

        return { balance: movement.newBalance };
      });
    } catch (error) {
      if (error?.name === 'SequelizeUniqueConstraintError') return { duplicate: true };
      if (error?.code === 'WALLET_INSUFFICIENT_FUNDS') return { insufficient: true };

      this.logger?.error({ err: error, member, transactionId: tx.id, action }, 'Seamless transaction failed');
      return { error };
    }
  }

  /**
   * Reverse a movement we already made.
   *
   * The figure comes from our stored record of the original — legacy reversed
   * whatever the request named, so a rollback quoting a bigger number than the
   * bet it reverses was a withdrawal with extra steps.
   */
  async #reverse(body, action, reason) {
    const check = this.#verify(body, action);
    if (check) return check;

    const { member_account: member, currency, transactions } = body;
    const userId = await this.#resolveUser(member);
    if (userId == null) return { code: RESPONSE_CODES.MEMBER_NOT_EXISTS, message: 'Member not exists' };

    const beforeBalance = await this.#balanceOf(userId);
    let balance = beforeBalance;

    for (const tx of transactions ?? []) {
      const originalId = String(tx?.id ?? '');
      if (!originalId) return { code: RESPONSE_CODES.API_ERROR, message: 'Transaction id is required' };

      const original = await this.models.SeamlessTransaction.findOne({
        where: { transaction_id: originalId },
        order: [['id', 'ASC']],
        raw: true,
      });

      // Nothing to reverse. Reported as the provider's own "bet not exist"
      // rather than as a success, so a rollback for something we never applied
      // does not look like it worked.
      if (!original) return { code: RESPONSE_CODES.BET_NOT_EXIST, message: 'Transaction not found' };

      // OUR figure. The sign is flipped: reversing a debit credits.
      const originalAmount = String(original.amount ?? '0');
      const magnitude = money.toDecimalString(money.abs(originalAmount));
      const isCredit = money.lt(originalAmount, '0');

      if (money.isZero(magnitude)) continue;

      const outcome = await this.#applyOnce({
        userId,
        member,
        body,
        // A distinct id for the reversal itself, derived from the original so
        // a retried rollback is recognised. `${action}:${id}` is stable and
        // cannot collide with a provider id, which never contains a colon.
        tx: { ...tx, id: `${action}:${originalId}`, round_id: original.round_id },
        action,
        reason,
        isCredit,
        magnitude,
        providerAmount: String(original.provider_amount ?? '0'),
        currency: currency ?? original.currency,
      });

      if (outcome.duplicate) continue;
      if (outcome.error) return { code: RESPONSE_CODES.INTERNAL_SERVER_ERROR, message: 'Internal server error' };
      if (outcome.insufficient) {
        return { code: RESPONSE_CODES.INSUFFICIENT_BALANCE, message: 'Insufficient balance' };
      }

      balance = outcome.balance ?? balance;

      await this.models.SeamlessTransaction.update(
        { reverses_id: originalId },
        { where: { transaction_id: `${action}:${originalId}`, action } }
      );
    }

    return {
      code: RESPONSE_CODES.SUCCESS,
      message: '',
      before_balance: this.#toProviderUnits(beforeBalance, currency ?? SETTLEMENT_CURRENCY),
      balance: this.#toProviderUnits(balance, currency ?? SETTLEMENT_CURRENCY),
    };
  }

  // ── Verification ──────────────────────────────────────────────────────

  /**
   * Is this request genuine and current?
   *
   * Returns null when it is, or the provider-shaped refusal when it is not.
   */
  #verify(body, action) {
    if (!this.config.SEAMLESS_SECRET_KEY) {
      // An unconfigured integration must refuse, not fall through to a
      // signature check against `undefined`.
      this.logger?.error('SEAMLESS_SECRET_KEY is not configured — refusing casino callbacks');
      return { code: RESPONSE_CODES.PRODUCT_UNDER_MAINTENANCE, message: 'Product under maintenance' };
    }

    const { operator_code: operatorCode, request_time: requestTime, sign } = body ?? {};
    if (!operatorCode || !requestTime || !sign) {
      return { code: RESPONSE_CODES.API_ERROR, message: 'Invalid request parameters' };
    }

    if (operatorCode !== this.config.SEAMLESS_OPERATOR_CODE) {
      return { code: RESPONSE_CODES.INCORRECT_AGENT_KEY, message: 'Incorrect operator code' };
    }

    /**
     * FRESHNESS. This is the single most useful thing that can be done about
     * the weak signature without the provider changing anything.
     *
     * Because the signature covers only the action name, a captured one is
     * valid for every future request of that action — forever, since
     * `request_time` is supplied by the caller and legacy never looked at it.
     * Requiring it to be recent turns "forever" into a few minutes.
     */
    if (!this.#isFresh(requestTime)) {
      this.logger?.warn({ operatorCode, action, requestTime }, 'REJECTED seamless callback: stale request_time');
      return { code: RESPONSE_CODES.INVALID_SIGN, message: 'Invalid sign' };
    }

    const expected = this.#expectedSign(body, action);
    if (!this.#safeEqual(sign, expected)) {
      this.logger?.warn({ operatorCode, action }, 'REJECTED seamless callback: signature mismatch');
      return { code: RESPONSE_CODES.INVALID_SIGN, message: 'Invalid sign' };
    }

    return null;
  }

  /**
   * The signature the provider should have sent.
   *
   * `legacy` mode is the provider's documented scheme, kept because it is what
   * the integration currently speaks. `full` additionally covers the member and
   * every transaction id and amount — use it if the provider supports it, and
   * the replay problem disappears rather than being narrowed.
   */
  #expectedSign(body, action) {
    const base = `${body.operator_code}${body.request_time}${action}${this.config.SEAMLESS_SECRET_KEY}`;

    if (this.config.SEAMLESS_SIGN_MODE !== 'full') {
      return crypto.createHash('md5').update(base).digest('hex');
    }

    const details = (body.transactions ?? [])
      .map((t) => `${t.id}:${t.amount}`)
      .sort()
      .join('|');

    return crypto
      .createHash('sha256')
      .update(`${body.operator_code}${body.request_time}${action}${body.member_account}${details}${this.config.SEAMLESS_SECRET_KEY}`)
      .digest('hex');
  }

  /**
   * Within the allowed clock skew?
   *
   * The provider sends `request_time` as `YYYY-MM-DD HH:mm:ss` in UTC. A value
   * that does not parse is treated as stale — failing closed, because an
   * unparseable timestamp is exactly what a forged request would carry.
   */
  #isFresh(requestTime) {
    const skew = Number(this.config.SEAMLESS_MAX_SKEW_SECONDS ?? 300);
    if (skew <= 0) return true; // Explicitly disabled.

    const raw = String(requestTime).trim();
    const normalised = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw) ? `${raw.replace(' ', 'T')}Z` : raw;
    const at = Date.parse(normalised);
    if (!Number.isFinite(at)) return false;

    return Math.abs(Date.now() - at) <= skew * 1000;
  }

  /** Constant-time compare over digests, so length differences leak nothing. */
  #safeEqual(a, b) {
    const bufA = crypto.createHash('sha256').update(String(a ?? '')).digest();
    const bufB = crypto.createHash('sha256').update(String(b ?? '')).digest();
    return crypto.timingSafeEqual(bufA, bufB);
  }

  // ── Units ─────────────────────────────────────────────────────────────

  /** Provider units → ours. `IDR2` sends 5 meaning 5,000. */
  #toSettlementUnits(amount, currency) {
    return THOUSANDS_CURRENCIES.has(currency)
      ? money.toDecimalString(money.multiply(amount, THOUSANDS_FACTOR))
      : money.toDecimalString(money.toMinor(amount));
  }

  /** Ours → provider units, for display in a response. */
  #toProviderUnits(amount, currency) {
    const value = THOUSANDS_CURRENCIES.has(currency)
      ? money.toDecimalString(money.divide(amount, THOUSANDS_FACTOR))
      : money.toDecimalString(money.toMinor(amount));

    // The provider's field is a JSON number with four decimal places.
    return Number(Number(value).toFixed(4));
  }

  // ── Lookups ───────────────────────────────────────────────────────────

  /**
   * `member_account` is the player id, as legacy treated it
   * (`WHERE uid = $1`). Resolved through user-service rather than by reading
   * `credits` directly — casino-service does not own that table.
   */
  async #resolveUser(member) {
    const id = Number(member);
    if (!Number.isInteger(id) || id <= 0) return null;

    try {
      /**
       * A missing player is `{ balance: null }`, not a null response.
       *
       * Checking the envelope rather than the figure inside it made every
       * unknown member look like a real one with a zero balance — a bet would
       * then be refused for insufficient funds instead of "member not exists",
       * and the provider would keep retrying a player that does not exist.
       */
      const balance = this.#unwrapBalance(await this.wallet.balance(id, SETTLEMENT_CURRENCY));
      return balance == null ? null : id;
    } catch (error) {
      if (error?.status === 404) return null;
      throw error;
    }
  }

  async #balanceOf(userId) {
    const balance = this.#unwrapBalance(await this.wallet.balance(userId, SETTLEMENT_CURRENCY));
    return money.fromStored(balance ?? '0');
  }

  /** The wallet answers `{balance}`; older callers expect the bare value. */
  #unwrapBalance(response) {
    if (response == null) return null;
    if (typeof response === 'object') return response.balance ?? null;
    return response;
  }
}

module.exports = { SeamlessService };
