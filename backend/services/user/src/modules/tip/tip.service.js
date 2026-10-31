'use strict';

const { money, withdrawBlock, defaultCurrencyOf } = require('@ibitplay/common');
const { assertPlayerCapability, isAgentPlayer } = require('@ibitplay/auth');
const { Op } = require('@ibitplay/db');

const errors = require('./tip.errors');
const { minimumFor, RATE_LIMIT, SEARCH_LIMIT } = require('./tip.constants');
const { WalletService } = require('../wallet/wallet.service');
const { REASON } = require('../wallet/wallet.constants');
const { visibleUserIds, CHANNEL_SQL } = require('../directory/playerScope');
const { notifyPlayer } = require('../notifications/notifyPlayer');
const { createRewardMoney } = require('../../lib/rewardMoney');
const { createTipLimitsResolver } = require('./tipLimits');
const { createWithdrawRequirements } = require('../withdraw-requirements/withdrawRequirements');

/** `%`, `_` and the escape character itself, made literal for `LIKE … ESCAPE '\'`. */
const escapeLike = (value) => String(value).replace(/[\\%_]/g, (c) => `\\${c}`);

/** Same rule as the loader's `requireActive`: not locked, and status `active` (or unset). */
const isActiveAccount = (u) =>
  Boolean(u) && !u.system_locked && !u.is_locked && (u.status == null || u.status === 'active');

const amountOut = (value) => money.fromStored(String(value ?? '0'));

/** Exact 8-dp decimal string. */
const dec = (value) => money.toDecimalString(money.toMinor(String(value ?? '0')));

/** The operator's limits are rolling: the last 24 hours, not the calendar day. */
const DAY_MS = 24 * 60 * 60 * 1000;

/** `userwager.wager` is TEXT and legacy wrote thousands separators — the VIP service's parse. */
const parseWager = (value) => {
  const cleaned = value == null ? '0' : String(value).replace(/,/g, '').trim();
  const match = /^(\d+)(?:\.(\d+))?$/.exec(cleaned);
  // Beyond 8 dp is dropped (a hair under the stored figure, never above it).
  return match ? dec(match[2] ? `${match[1]}.${match[2].slice(0, 8)}` : match[1]) : dec('0');
};

/**
 * Peer-to-peer tips.
 *
 * Every tip is ONE transaction: the two wallet rows are locked in ascending
 * user-id order (so A→B racing B→A cannot deadlock), the sender's tips in the
 * last hour are counted under that lock (so the rate limit cannot be raced),
 * then the `tips` row, the `TIP_SENT` debit and the `TIP_RECEIVED` credit are
 * written. Either all of it commits or none of it does.
 *
 * The operator's limits (USD, `siteconfig` via `tipLimits.js`) are checked
 * under that same lock, next to the rate limit, so two tips racing cannot both
 * fit under the daily cap. A replayed `requestId` returns before any of it.
 */
class TipService {
  constructor(deps) {
    const { models, db, config, logger, clients } = deps;
    this.deps = deps;
    this.models = models;
    this.db = db;
    this.config = config;
    this.logger = logger;
    this.clients = clients;
    this.wallet = new WalletService(deps);
    this.tipLimits = deps.tipLimits ?? createTipLimitsResolver(deps);
    this.rewardMoney = deps.rewardMoney ?? createRewardMoney(deps);
    // A tip is money out like a withdrawal: same KYC / wagering / cap / daily-limit rules.
    this.requirements = deps.withdrawRequirements ?? createWithdrawRequirements(deps);
  }

  // ══ Player ══════════════════════════════════════════════════════════

  async send({ userId, toUsername, currency, amount, fromCurrency = null, note = null, requestId = null }) {
    // A retry of a send that already went through (same sender, same requestId) gets that tip
    // back instead of moving the money again.
    if (requestId) {
      const done = await this.#byRequest(userId, requestId);
      if (done) return done;
    }
    const code = String(currency).toUpperCase();
    const minimum = minimumFor(code);
    if (money.lt(amount, minimum)) {
      throw errors.MIN_AMOUNT({ currency: code, minimum, amount });
    }

    // Agent-tree players cannot send — the route checks too; this covers any other caller.
    await assertPlayerCapability(userId, 'tips');

    const sender = await this.models.Users.findByPk(userId, {
      attributes: ['id', 'name', 'status', 'is_locked', 'system_locked', 'withdraw_locked'],
      raw: true,
    });
    if (!isActiveAccount(sender)) throw errors.SENDER_BLOCKED();
    // A tip is money leaving the account: a withdrawal-blocked sender could otherwise hand the
    // balance to a friend who withdraws it (migration 091). Covers HTTP, SEND_TIP and RAIN.
    if (sender.withdraw_locked) throw withdrawBlock.errors.BLOCKED({ reason: 'withdraw' });

    const recipient = await this.#findByUsername(toUsername);
    if (!recipient) throw errors.USER_NOT_FOUND({ toUsername });
    // An agent-tree player's money comes and goes through their agent's float; a tip from outside
    // the tree would move house money into it. Answered like an unknown name, so a probe can't
    // tell the account exists.
    if (await isAgentPlayer(Number(recipient.id))) throw errors.USER_NOT_FOUND({ toUsername });

    const senderId = Number(sender.id);
    const recipientId = Number(recipient.id);
    if (senderId === recipientId) throw errors.SELF();
    if (!isActiveAccount(recipient)) throw errors.RECIPIENT_UNAVAILABLE({ toUsername: recipient.name });
    if (!(await this.#tipsEnabled(recipientId))) throw errors.DISABLED_BY_RECIPIENT({ toUsername: recipient.name });

    const value = money.toDecimalString(money.toMinor(amount));

    // rainbet: the coin the sender pays in. Another coin than the tip's is charged the tip's worth
    // at the platform rate, no fee (`fromCurrency`); the recipient still gets `value` of `code`.
    const payCode = fromCurrency ? String(fromCurrency).toUpperCase() : code;
    let payValue = value;
    if (payCode !== code) {
      const converted = await this.rewardMoney.convert(value, code, payCode);
      if (converted == null) throw errors.NO_RATE({ currency: payCode });
      payValue = money.toDecimalString(money.toMinor(converted));
      if (!money.gt(payValue, '0')) throw errors.MIN_AMOUNT({ currency: code, minimum, amount });
    }

    // Money out of the sender: the requirements and the cap are checked on what actually leaves.
    const applied = await this.requirements.assertMet(senderId, {
      amount: payValue,
      currency: payCode,
      kycError: (status) => errors.KYC_REQUIRED({ kycStatus: status ?? null }),
    });

    // The limits and this tip's value in the limits' coin are plain reads, taken before any lock
    // is held; they are CHECKED inside the transaction, after the sender's row is locked.
    const limits = await this.#limits();
    const capped = money.gt(limits.maxPerTipUsd, '0') || money.gt(limits.maxPerDayUsd, '0');
    const tipUsd = capped ? await this.#toLimitStrict(value, code, limits.currency) : null;

    let result;
    try {
      result = await this.db.transaction(async (transaction) => {
        // ── 0. Cap / daily limit under the player lock, taken BEFORE the wallet rows (the order
        //       the withdraw rails use), so a tip and a withdrawal racing cannot deadlock.
        await this.requirements.assertCapInTransaction(senderId, { amount: payValue, currency: payCode, transaction, applied });

        // ── 1. Both wallet rows, lowest id first ────────────────────────
        // `debit` / `credit` take these same row locks themselves; taking them
        // here first fixes the ORDER, which is what prevents the deadlock.
        for (const id of [senderId, recipientId].sort((a, b) => a - b)) {
          const lockCode = id === senderId ? payCode : code;
          const locked = await this.wallet.repo.lockBalance(id, lockCode, transaction);
          if (locked) continue;
          if (id === senderId) {
            throw errors.INSUFFICIENT_BALANCE({ currency: payCode, requested: payValue, available: '0' });
          }
          await this.wallet.repo.createWallet(id, transaction);
          await this.wallet.repo.lockBalance(id, code, transaction);
        }

        // ── 2. Rate limit, counted under the sender's lock ──────────────
        const recent = await this.models.Tip.count({
          where: {
            from_user_id: senderId,
            created_at: { [Op.gte]: new Date(Date.now() - RATE_LIMIT.windowMs) },
          },
          transaction,
        });
        if (recent >= RATE_LIMIT.max) {
          throw errors.RATE_LIMITED({ limit: RATE_LIMIT.max, windowMinutes: RATE_LIMIT.windowMs / 60_000 });
        }

        // ── 2b. Operator limits (site default coin), under the same lock ──────────────
        await this.#enforceLimits({ limits, tipUsd, senderId, code, transaction });

        // ── 3. The tip, then the two ledger movements keyed on its id ───
        const tip = await this.models.Tip.create(
          { from_user_id: senderId, to_user_id: recipientId, currency: code, amount: value, note, request_id: requestId },
          { transaction }
        );
        const tipId = Number(tip.id);

        let sent;
        try {
          sent = await this.wallet.debit(
            {
              userId: senderId,
              currency: payCode,
              amount: payValue,
              reason: REASON.TIP_SENT,
              idempotencyKey: `tip:${tipId}:sent`,
              refType: 'TIP',
              refId: String(tipId),
              description: payCode === code ? `Tip to ${recipient.name}` : `Tip to ${recipient.name} (${value} ${code})`,
            },
            { sourceService: 'user-service', transaction, username: sender.name }
          );
        } catch (error) {
          if (error.code === 'WALLET_INSUFFICIENT_FUNDS') {
            throw errors.INSUFFICIENT_BALANCE({ currency: payCode, requested: payValue, available: error.details?.available });
          }
          throw error;
        }

        const received = await this.wallet.credit(
          {
            userId: recipientId,
            currency: code,
            amount: value,
            reason: REASON.TIP_RECEIVED,
            idempotencyKey: `tip:${tipId}:received`,
            refType: 'TIP',
            refId: String(tipId),
            description: `Tip from ${sender.name}`,
          },
          { sourceService: 'user-service', transaction, username: recipient.name }
        );

        await tip.update({ from_ledger_id: sent.ledgerId, to_ledger_id: received.ledgerId }, { transaction });

        return {
          tipId,
          toUsername: recipient.name,
          currency: code,
          amount: value,
          // What left the sender, and their balance in that coin afterwards.
          paidCurrency: payCode,
          paidAmount: payValue,
          balance: sent.newBalance,
        };
      });
    } catch (error) {
      // Two copies of the same request raced: the unique index let one through and rolled this
      // one back with nothing moved. Answer with the tip that went through.
      if (requestId && error?.name === 'SequelizeUniqueConstraintError') {
        const done = await this.#byRequest(senderId, requestId);
        if (done) return done;
      }
      throw error;
    }

    this.logger?.info(
      { tipId: result.tipId, from: senderId, to: recipientId, currency: code, amount: value },
      'Tip sent'
    );

    // After COMMIT, never awaited: a failed notification never fails the tip.
    // (Both balances are pushed over the socket by the wallet itself on commit.)
    // rainbet: the recipient's "Receive Tip Notifications" switch (userconfig, migration 169).
    const wantsNotice = await this.models.Userconfig.findOne({ where: { uid: recipientId }, attributes: ['tip_notifications'], raw: true })
      .then((c) => c?.tip_notifications !== false, () => true);
    try {
      if (wantsNotice) void notifyPlayer(recipientId, {
        kind: 'tip_received',
        key: `tip:${result.tipId}`,
        title: 'You got a tip',
        body: `${sender.name} sent you {amount}`,
        link: '/transactions',
        meta: { amount: value, currency: code, from: sender.name, tipId: result.tipId },
      });
    } catch (error) {
      this.logger?.warn({ err: error.message, tipId: result.tipId }, 'Could not notify the tip receiver');
    }

    return result;
  }

  /** Recipient picker: players whose name starts with `q`, who accept tips, not the caller. */
  async searchUsers({ userId, q }) {
    const rows = await this.db.sequelize.query(
      `SELECT u.id, u.name
         FROM users u
         LEFT JOIN userconfig c ON c.uid = u.id
        WHERE u.name ILIKE :prefix ESCAPE '\\'
          AND u.id <> :me
          AND COALESCE(c.tips_enabled, true)
          AND COALESCE(u.status, 'active') = 'active'
          AND NOT COALESCE(u.is_locked, false)
          AND NOT COALESCE(u.system_locked, false)
        ORDER BY lower(u.name), u.id
        LIMIT :limit`,
      {
        // Over-fetch: agent-tree players can't receive tips and are dropped below.
        replacements: { prefix: `${escapeLike(q)}%`, me: Number(userId), limit: SEARCH_LIMIT * 3 },
        type: this.db.sequelize.QueryTypes.SELECT,
      }
    );
    const agent = await Promise.all(rows.map((r) => isAgentPlayer(Number(r.id))));
    return rows
      .filter((_, i) => !agent[i])
      .slice(0, SEARCH_LIMIT)
      .map((r) => ({ id: Number(r.id), name: r.name }));
  }

  /** The receive switch, plus the operator's limits and what this player has sent in the last 24h (both in `limits.currency`). */
  async getSettings({ userId }) {
    const [enabled, limits] = await Promise.all([this.#tipsEnabled(userId), this.#limits()]);
    const usedTodayUsd = await this.#usedTodayUsd(Number(userId), { strict: false, currency: limits.currency }).catch(() => null);
    return { enabled, limits: { ...limits, usedTodayUsd } };
  }

  /** Writes only `tips_enabled` — the other preferences on the row are left as they are. */
  async updateSettings({ userId, enabled }) {
    await this.db.sequelize.query(
      `INSERT INTO userconfig (uid, tips_enabled, updatedat) VALUES (:uid, :enabled, now())
       ON CONFLICT (uid) DO UPDATE SET tips_enabled = EXCLUDED.tips_enabled, updatedat = now()`,
      { replacements: { uid: Number(userId), enabled: Boolean(enabled) } }
    );
    this.logger?.info({ userId: String(userId), enabled: Boolean(enabled) }, 'Tip receiving switched');
    return { enabled: Boolean(enabled) };
  }

  /** Sent and received, newest first. */
  async history({ userId, limit = 20, offset = 0 }) {
    const me = Number(userId);
    const { sequelize } = this.db;
    const [rows, [{ total }]] = await Promise.all([
      sequelize.query(
        `SELECT t.id, t.from_user_id, t.to_user_id, t.currency, t.amount, t.note, t.created_at,
                cp.id AS cp_id, cp.name AS cp_name
           FROM tips t
           LEFT JOIN users cp
             ON cp.id = CASE WHEN t.from_user_id = :me THEN t.to_user_id ELSE t.from_user_id END
          WHERE t.from_user_id = :me OR t.to_user_id = :me
          ORDER BY t.created_at DESC, t.id DESC
          LIMIT :limit OFFSET :offset`,
        { replacements: { me, limit, offset }, type: sequelize.QueryTypes.SELECT }
      ),
      sequelize.query(
        'SELECT COUNT(*)::int AS total FROM tips WHERE from_user_id = :me OR to_user_id = :me',
        { replacements: { me }, type: sequelize.QueryTypes.SELECT }
      ),
    ]);

    return {
      rows: rows.map((r) => {
        const sent = Number(r.from_user_id) === me;
        const cpId = Number(sent ? r.to_user_id : r.from_user_id);
        return {
          id: Number(r.id),
          direction: sent ? 'sent' : 'received',
          counterparty: { id: cpId, name: r.cp_name ?? `User #${cpId}` },
          currency: r.currency,
          amount: amountOut(r.amount),
          note: r.note ?? null,
          createdAt: r.created_at,
        };
      }),
      total: Number(total) || 0,
    };
  }

  // ══ Staff ═══════════════════════════════════════════════════════════

  async adminList({ staff, limit = 50, offset = 0, search, currency, from, to, channel }) {
    const ids = await visibleUserIds(this, staff?.id);
    if (ids && ids.length === 0) {
      return { rows: [], total: 0, summary: { totalTips: 0, byCurrency: [] } };
    }

    const where = [];
    const replacements = { limit, offset };
    if (ids) {
      where.push('(t.from_user_id IN (:ids) OR t.to_user_id IN (:ids))');
      replacements.ids = ids;
    }
    if (search) {
      where.push("(fu.name ILIKE :search ESCAPE '\\' OR tu.name ILIKE :search ESCAPE '\\')");
      replacements.search = `%${escapeLike(search)}%`;
    }
    // Channel tip PAANE wale (recipient) se: agent ke users tip bhej nahi sakte, sirf paa sakte hain.
    if (CHANNEL_SQL[channel]) where.push(`tu.${CHANNEL_SQL[channel]}`);
    if (currency) {
      where.push('t.currency = :currency');
      replacements.currency = String(currency).toUpperCase();
    }
    if (from) {
      where.push('t.created_at >= CAST(:from AS date)');
      replacements.from = from;
    }
    if (to) {
      where.push("t.created_at < CAST(:to AS date) + interval '1 day'");
      replacements.to = to;
    }

    const base = `FROM tips t
      LEFT JOIN users fu ON fu.id = t.from_user_id
      LEFT JOIN users tu ON tu.id = t.to_user_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`;

    const { sequelize } = this.db;
    const select = { replacements, type: sequelize.QueryTypes.SELECT };
    const [rows, byCurrency] = await Promise.all([
      sequelize.query(
        `SELECT t.id, t.from_user_id, t.to_user_id, t.currency, t.amount, t.note, t.created_at,
                fu.name AS from_name, tu.name AS to_name
           ${base}
          ORDER BY t.created_at DESC, t.id DESC
          LIMIT :limit OFFSET :offset`,
        select
      ),
      sequelize.query(
        `SELECT t.currency, COUNT(*)::int AS count, COALESCE(SUM(t.amount), 0)::text AS amount
           ${base}
          GROUP BY t.currency
          ORDER BY t.currency`,
        select
      ),
    ]);

    const total = byCurrency.reduce((n, r) => n + Number(r.count), 0);

    return {
      rows: rows.map((r) => ({
        id: Number(r.id),
        from: { id: Number(r.from_user_id), name: r.from_name ?? `User #${r.from_user_id}` },
        to: { id: Number(r.to_user_id), name: r.to_name ?? `User #${r.to_user_id}` },
        currency: r.currency,
        amount: amountOut(r.amount),
        note: r.note ?? null,
        createdAt: r.created_at,
      })),
      total,
      summary: {
        totalTips: total,
        byCurrency: byCurrency.map((r) => ({
          currency: r.currency,
          count: Number(r.count),
          amount: amountOut(r.amount),
        })),
      },
    };
  }

  // ══ Internals ═══════════════════════════════════════════════════════

  /**
   * The operator's limits as exact decimals, in the SITE'S DEFAULT COIN (owner panel
   * `default_currency`, e.g. INR) — user's rule, 2026-10-31. The `*Usd` names are the stored
   * fields' history (migration 081); `currency` says what the numbers are in.
   * The resolver never fails: unreadable = the defaults.
   */
  async #limits() {
    const raw = await this.tipLimits.limits();
    return {
      maxPerTipUsd: dec(raw.maxPerTipUsd),
      maxPerDayUsd: dec(raw.maxPerDayUsd),
      minWageredUsd: dec(raw.minWageredUsd),
      currency: await this.#limitCurrency(),
    };
  }

  async #limitCurrency() {
    try {
      const row = await this.models.SiteFeature?.findByPk?.('default_currency', { attributes: ['variant'], raw: true });
      return defaultCurrencyOf(row?.variant);
    } catch {
      return defaultCurrencyOf(null);
    }
  }

  /** `amount` of `currency` in the limits' coin `to`; no rate is a refusal, never a pass. */
  async #toLimitStrict(amount, currency, to) {
    const out = await this.rewardMoney.convert(amount, currency, to);
    if (out == null) throw errors.NO_RATE({ currency });
    return dec(out);
  }

  /** A figure in the limits' coin `from`, in `currency`, for the error details; null when it has no rate. */
  async #fromLimit(value, from, currency) {
    const out = await this.rewardMoney.convert(value, from, currency);
    return out == null ? null : dec(out);
  }

  /**
   * The sender's tips in the last rolling 24 hours, summed in the limits' coin. `strict` (the
   * send path) refuses a coin with no rate; the settings read skips it rather than failing the screen.
   */
  async #usedTodayUsd(senderId, { strict, transaction, currency } = {}) {
    const rows = await this.db.sequelize.query(
      `SELECT currency, COALESCE(SUM(amount), 0)::text AS amount
         FROM tips
        WHERE from_user_id = :senderId AND created_at >= :since
        GROUP BY currency`,
      {
        replacements: { senderId, since: new Date(Date.now() - DAY_MS) },
        type: this.db.sequelize.QueryTypes.SELECT,
        transaction,
      }
    );
    let total = dec('0');
    for (const row of rows) {
      const amount = money.fromStored(String(row.amount));
      const value = strict
        ? await this.#toLimitStrict(amount, row.currency, currency)
        : await this.rewardMoney.convert(amount, row.currency, currency);
      if (value != null) total = money.toDecimalString(money.add(total, value));
    }
    return total;
  }

  /** Lifetime wager — `userwager.wager` (USD, the VIP ladder's counter) — in the limits' coin. */
  async #wageredUsd(userId, transaction, currency) {
    const row = await this.models.Userwager.findOne({ where: { uid: userId }, attributes: ['wager'], raw: true, transaction });
    return this.#toLimitStrict(parseWager(row?.wager), 'USD', currency);
  }

  /** Wager requirement, then the per-tip cap, then the rolling daily cap. "0" switches each off. */
  async #enforceLimits({ limits, tipUsd, senderId, code, transaction }) {
    const { maxPerTipUsd, maxPerDayUsd, minWageredUsd, currency: limitCode } = limits;

    if (money.gt(minWageredUsd, '0')) {
      const wageredUsd = await this.#wageredUsd(senderId, transaction, limitCode);
      if (money.lt(wageredUsd, minWageredUsd)) {
        throw errors.WAGER_REQUIRED({ requiredUsd: minWageredUsd, wageredUsd });
      }
    }

    if (money.gt(maxPerTipUsd, '0') && money.gt(tipUsd, maxPerTipUsd)) {
      throw errors.OVER_PER_TIP_LIMIT({
        maxUsd: maxPerTipUsd,
        maxInCurrency: await this.#fromLimit(maxPerTipUsd, limitCode, code),
        currency: code,
      });
    }

    if (money.gt(maxPerDayUsd, '0')) {
      const usedUsd = await this.#usedTodayUsd(senderId, { strict: true, transaction, currency: limitCode });
      if (money.gt(money.add(usedUsd, tipUsd), maxPerDayUsd)) {
        const left = money.max(money.subtract(maxPerDayUsd, usedUsd), 0n);
        throw errors.OVER_DAILY_LIMIT({
          maxUsd: maxPerDayUsd,
          usedUsd,
          remainingInCurrency: await this.#fromLimit(money.toDecimalString(left), limitCode, code),
          currency: code,
        });
      }
    }
  }

  /** Case-insensitive; an exact-case match wins if two names differ only by case. */
  /** The tip this sender already sent under `requestId`, in send()'s answer shape, or null. */
  async #byRequest(senderId, requestId) {
    const tip = await this.models.Tip.findOne({ where: { from_user_id: senderId, request_id: requestId }, raw: true });
    if (!tip) return null;
    const [to, balance] = await Promise.all([
      this.models.Users.findByPk(tip.to_user_id, { attributes: ['name'], raw: true }),
      this.wallet.getBalance(senderId, tip.currency).catch(() => null),
    ]);
    return {
      tipId: Number(tip.id),
      toUsername: to?.name ?? null,
      currency: tip.currency,
      amount: money.fromStored(tip.amount),
      balance,
      replayed: true,
    };
  }

  async #findByUsername(username) {
    const name = String(username).trim();
    const [row] = await this.db.sequelize.query(
      `SELECT id, name, status, is_locked, system_locked
         FROM users
        WHERE lower(name) = lower(:name)
        ORDER BY (name = :name) DESC, id ASC
        LIMIT 1`,
      { replacements: { name }, type: this.db.sequelize.QueryTypes.SELECT }
    );
    return row ?? null;
  }

  /** No `userconfig` row = the column default: tips on. */
  async #tipsEnabled(userId) {
    const row = await this.models.Userconfig.findOne({
      where: { uid: userId },
      attributes: ['tips_enabled'],
      raw: true,
    });
    return row ? row.tips_enabled !== false : true;
  }
}

module.exports = { TipService, escapeLike };
