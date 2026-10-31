'use strict';

const { Op, fn, col } = require('sequelize');
const { money } = require('@ibitplay/common');

const errors = require('./giftCards.errors');
const { STATUS, DEPOSIT_SOURCES } = require('./giftCards.constants');
const { WalletService } = require('../wallet/wallet.service');
const { REASON } = require('../wallet/wallet.constants');

/**
 * Gift cards — a promotional credit a player unlocks by depositing, wagering,
 * or both.
 *
 * The lifecycle is three states and they matter:
 *
 *   Available  the card exists and the player may take it
 *   Activated  the player has taken it; the clock on its conditions starts NOW
 *   Claimed    the conditions were met and the money has been paid
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE RACE THAT PAID TWICE
 *
 * Legacy read the row, checked `status !== 'Activated'`, and only THEN opened a
 * transaction to credit the wallet:
 *
 *     const row = ...                     // status is 'Activated'
 *     if (row.status !== 'Activated') return 400
 *     await pg.query('BEGIN')
 *     UPDATE credits SET usdt = usdt + $1 ...
 *     UPDATE user_gift_cards SET status = 'Claimed' ...
 *
 * Two requests arriving together both read 'Activated', both pass the check,
 * and both credit. The status update is inside the transaction but the DECISION
 * is not, which makes the transaction decorative. With `userId` taken from the
 * request body on an unauthenticated route, firing two was trivial.
 *
 * Here the claim is a conditional UPDATE — `SET status='Claimed' WHERE
 * status='Activated'` — and the money moves only if that update changed a row.
 * The database decides, once, and the loser gets a 409.
 * ─────────────────────────────────────────────────────────────────────────
 */
class GiftCardsService {
  constructor(deps) {
    const { models, db, logger, clients, config } = deps;
    this.models = models;
    this.db = db;
    this.logger = logger;
    this.clients = clients;
    this.config = config;
    this.wallet = new WalletService(deps);
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Staff
  // ══════════════════════════════════════════════════════════════════════

  /** @legacy POST /giftCard/admin/create */
  async create(input) {
    const existing = await this.models.GiftCards.findOne({
      where: { unique_key: input.uniqueKey },
      raw: true,
    });
    if (existing) throw errors.KEY_TAKEN({ uniqueKey: input.uniqueKey });

    const card = await this.models.GiftCards.create({
      unique_key: input.uniqueKey,
      description: input.description ?? null,
      period_days: input.periodDays ?? null,
      end_date: input.endDate ?? null,
      deposit_status: input.depositRequired ?? false,
      deposit_amount: input.depositAmount ?? null,
      wager_status: input.wagerRequired ?? false,
      wager_times: input.wagerTimes ?? null,
      all_user_status: input.allUsers ?? false,
      is_active: input.isActive ?? true,
      amount: input.amount,
    });

    return this.#shape(card.get({ plain: true }));
  }

  /** @legacy GET /giftCard/admin/list */
  async list({ activeOnly, search, limit = 50, offset = 0 }) {
    const { rows, count } = await this.models.GiftCards.findAndCountAll({
      where: {
        ...(activeOnly ? { is_active: true } : {}),
        ...(search ? { unique_key: { [Op.iLike]: `%${search}%` } } : {}),
      },
      order: [['id', 'DESC']],
      limit,
      offset,
      raw: true,
    });
    return { total: count, rows: rows.map((r) => this.#shape(r)) };
  }

  /**
   * @legacy DELETE /giftCard/admin/delete/:id
   *
   * Refused once players have activated it. Legacy deleted the card outright,
   * which orphaned every `user_gift_cards` row pointing at it — those players'
   * cards then failed to load with a join returning nothing, and there was no
   * way to tell them apart from a player who never had one.
   */
  async remove({ id }) {
    const card = await this.models.GiftCards.findByPk(id, { raw: true });
    if (!card) throw errors.NOT_FOUND({ id });

    const activations = await this.models.UserGiftCards.count({ where: { gift_card_id: id } });
    if (activations > 0) throw errors.IN_USE({ id, activations });

    await this.models.GiftCards.destroy({ where: { id } });
    return { id, deleted: true };
  }

  /** @legacy POST /giftCard/search */
  async findByKey({ uniqueKey }) {
    const card = await this.models.GiftCards.findOne({ where: { unique_key: uniqueKey }, raw: true });
    if (!card) throw errors.NOT_FOUND({ uniqueKey });
    return this.#shape(card);
  }

  /** @legacy GET /giftCard/admin/analytics */
  async analytics() {
    const [cards, byStatus, byCard] = await Promise.all([
      this.models.GiftCards.count(),
      this.models.UserGiftCards.findAll({
        attributes: ['status', [fn('COUNT', col('id')), 'count']],
        group: ['status'],
        raw: true,
      }),
      /**
       * Per-card takeup, grouped in the database.
       *
       * The screen has always shown this table — which cards people actually
       * take, and how many of those turn into a claim. The four counters alone
       * say the promotion is working without saying which promotion.
       */
      this.models.UserGiftCards.findAll({
        attributes: ['gift_card_id', 'status', [fn('COUNT', col('id')), 'count']],
        group: ['gift_card_id', 'status'],
        raw: true,
      }),
    ]);

    const counts = Object.fromEntries(byStatus.map((r) => [String(r.status).toLowerCase(), Number(r.count)]));

    const takeup = new Map();
    for (const row of byCard) {
      const key = String(row.gift_card_id);
      const entry = takeup.get(key) ?? { activations: 0, claims: 0 };
      // An activation is every row that exists — a claim is one that completed,
      // so a claimed card counts towards both. Counting them as disjoint made
      // takeup fall as the promotion succeeded.
      entry.activations += Number(row.count);
      if (String(row.status) === STATUS.CLAIMED) entry.claims += Number(row.count);
      takeup.set(key, entry);
    }

    const rows = await this.models.GiftCards.findAll({
      attributes: ['id', 'unique_key', 'amount', 'created_at'],
      order: [['id', 'DESC']],
      raw: true,
    });

    return {
      totalCards: cards,
      activated: counts.activated ?? 0,
      claimed: counts.claimed ?? 0,
      expired: counts.expired ?? 0,
      cards: rows.map((r) => {
        const entry = takeup.get(String(r.id)) ?? { activations: 0, claims: 0 };
        return {
          id: r.id,
          uniqueKey: r.unique_key,
          amount: r.amount != null ? String(r.amount) : null,
          createdAt: r.created_at ?? null,
          activations: entry.activations,
          claims: entry.claims,
        };
      }),
    };
  }

  /** @legacy GET /giftCard/admin/records */
  async records({ status, userId, limit = 50, offset = 0 }) {
    const { rows, count } = await this.models.UserGiftCards.findAndCountAll({
      where: { ...(status ? { status } : {}), ...(userId ? { user_id: userId } : {}) },
      order: [['id', 'DESC']],
      limit,
      offset,
      raw: true,
    });

    const cards = await this.#cardsById(rows.map((r) => r.gift_card_id));

    return {
      total: count,
      rows: rows.map((r) => ({
        id: r.id,
        userId: r.user_id,
        status: r.status,
        startDate: r.start_date,
        card: cards.get(String(r.gift_card_id)) ?? null,
      })),
    };
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Players
  // ══════════════════════════════════════════════════════════════════════

  /**
   * @legacy GET /giftCard/user/:userId/active-with-status
   *
   * Every card this player can see, with where they stand on each.
   *
   * The `:userId` in the legacy path was the only thing identifying the player,
   * on an unauthenticated route — so anyone could read anyone's promotions by
   * changing a number.
   */
  async listForUser({ userId }) {
    const [cards, mine] = await Promise.all([
      this.models.GiftCards.findAll({ where: { is_active: true }, order: [['id', 'DESC']], raw: true }),
      this.models.UserGiftCards.findAll({ where: { user_id: userId }, raw: true }),
    ]);

    const byCardId = new Map(mine.map((m) => [String(m.gift_card_id), m]));
    const visible = cards.filter((card) => card.all_user_status || byCardId.has(String(card.id)));

    // Turnover means calling casino and sports over the network, and the rates
    // table is read by both checks. Without this, ten cards is forty round
    // trips for what is usually one or two distinct windows.
    const ctx = { rates: null, wager: new Map() };

    return Promise.all(
      visible.map(async (card) => {
        const activation = byCardId.get(String(card.id)) ?? null;
        const { from, to } = this.#evaluationWindow(card, activation);

        const [deposit, wager] = await Promise.all([
          this.#depositProgress({ userId, card, from, to, ctx }),
          this.#wagerProgress({ userId, card, from, to, ctx }),
        ]);

        return {
          giftcards: this.#shapeLegacy(card),
          usergiftcards: activation
            ? {
                id: activation.id,
                status: activation.status,
                startDate: activation.start_date,
                expired: this.#isExpired(card, activation),
              }
            : null,
          deposit,
          wager,
        };
      })
    );
  }

  /**
   * The period a deposit or bet has to fall in for THIS card, for this player.
   *
   * Before activation there is no clock, so the figures shown are the player's
   * whole history. That is a PREVIEW and not what claiming will measure —
   * activating sets `start_date` to now and the counters restart from zero. A
   * player looking at "wagered $6,902 of $40" on an untaken card is not being
   * told they have already met it.
   */
  #evaluationWindow(card, activation) {
    if (!activation) {
      return { from: null, to: card.end_date ? new Date(card.end_date) : null };
    }
    return { from: activation.start_date, to: this.#conditionEnd(card, activation) };
  }

  /**
   * A card with no deposit condition is satisfied, not unevaluated — reporting
   * `false` there would render the page as if the player had failed something
   * the card never asked for.
   */
  async #depositProgress({ userId, card, from, to, ctx }) {
    if (!card.deposit_status) return { status: true, message: 'No deposit required' };

    try {
      const result = await this.#checkDeposit({ userId, from, to, requiredUsd: card.deposit_amount, ctx });
      return result.met
        ? { status: true, message: 'Deposit requirement met', amountUSD: this.#num(result.usd) }
        : { status: false, message: 'No single deposit transaction meets the required amount' };
    } catch (error) {
      // This is a page load, not a payout. A rates outage should read as
      // "not yet", not take the player's whole promotions page down with it.
      this.logger?.error({ err: error, userId, giftCardId: card.id }, 'Deposit progress unavailable');
      return { status: false, message: 'Deposit progress is temporarily unavailable' };
    }
  }

  async #wagerProgress({ userId, card, from, to, ctx }) {
    const requiredWagerUSD = this.#num(this.#requiredWagerUsd(card));

    try {
      const totals = await this.#wagerTotals({ userId, from, to, ctx });
      if (totals.incomplete) {
        return { status: false, totalUsdWager: null, requiredWagerUSD, message: 'Wagering data is temporarily unavailable' };
      }

      const totalUsdWager = this.#num(totals.totalUsd);
      return {
        // Not `card.wager_status` — a card with no wager condition has a
        // requirement of zero, which every total clears.
        status: money.gte(totals.totalUsd, this.#requiredWagerUsd(card)),
        totalUsdWager,
        requiredWagerUSD,
      };
    } catch (error) {
      this.logger?.error({ err: error, userId, giftCardId: card.id }, 'Wager progress unavailable');
      return { status: false, totalUsdWager: null, requiredWagerUSD, message: 'Wagering data is temporarily unavailable' };
    }
  }

  /**
   * @legacy POST /giftCard/activate
   *
   * Taking the card starts its clock. Nothing is paid here.
   */
  async activate({ userId, giftCardId }) {
    const card = await this.models.GiftCards.findByPk(giftCardId, { raw: true });
    if (!card) throw errors.NOT_FOUND({ giftCardId });
    if (!card.is_active) throw errors.INACTIVE({ giftCardId });
    if (card.end_date && new Date(card.end_date) < new Date()) throw errors.EXPIRED({ giftCardId });
    if (!card.all_user_status) {
      // A targeted card has to have been assigned to this player already.
      const assigned = await this.models.UserGiftCards.findOne({
        where: { user_id: userId, gift_card_id: giftCardId }, raw: true,
      });
      if (!assigned) throw errors.NOT_ELIGIBLE({ giftCardId });
    }

    // `findOrCreate` rather than "check then insert": two taps on a slow
    // connection would otherwise both find nothing and both insert.
    const [activation, created] = await this.models.UserGiftCards.findOrCreate({
      where: { user_id: userId, gift_card_id: giftCardId },
      defaults: { user_id: userId, gift_card_id: giftCardId, status: STATUS.ACTIVATED, start_date: new Date() },
    });

    const row = activation.get({ plain: true });
    if (!created && row.status !== STATUS.AVAILABLE) {
      throw errors.ALREADY_ACTIVATED({ giftCardId, status: row.status });
    }

    if (!created) {
      await this.models.UserGiftCards.update(
        { status: STATUS.ACTIVATED, start_date: new Date() },
        { where: { id: row.id } }
      );
    }

    return { giftCardId, status: STATUS.ACTIVATED, startDate: row.start_date ?? new Date() };
  }

  /**
   * @legacy POST /giftCard/claim
   *
   * Check the conditions, then take the card in one atomic step and pay.
   */
  async claim({ userId, giftCardId }) {
    const activation = await this.models.UserGiftCards.findOne({
      where: { user_id: userId, gift_card_id: giftCardId }, raw: true,
    });
    if (!activation) throw errors.NOT_ACTIVATED({ giftCardId });
    if (activation.status === STATUS.CLAIMED) throw errors.ALREADY_CLAIMED({ giftCardId });
    if (activation.status !== STATUS.ACTIVATED) throw errors.NOT_ACTIVATED({ status: activation.status });

    const card = await this.models.GiftCards.findByPk(giftCardId, { raw: true });
    if (!card) throw errors.NOT_FOUND({ giftCardId });

    const from = activation.start_date;
    const to = this.#conditionEnd(card, activation);

    if (card.deposit_status) {
      const deposit = await this.#checkDeposit({ userId, from, to, requiredUsd: card.deposit_amount });
      if (!deposit.met) throw errors.DEPOSIT_CONDITION_UNMET({ required: String(card.deposit_amount), deposit });
    }

    if (card.wager_status) {
      const requiredUsd = this.#requiredWagerUsd(card);
      const wager = await this.#checkWager({ userId, from, to, requiredUsd });
      if (!wager.met) throw errors.WAGER_CONDITION_UNMET({ required: requiredUsd, wager });
    }

    const amount = money.toDecimalString(money.toMinor(card.amount ?? '0'));

    return this.db.transaction(async (transaction) => {
      /**
       * THE CLAIM. A conditional update, so the database decides who wins.
       *
       * `affected === 0` means someone else claimed it between our read above
       * and this write. That is not an error in our logic — it is exactly the
       * race the legacy version lost — and the correct response is to refuse
       * this one without crediting.
       */
      const [affected] = await this.models.UserGiftCards.update(
        { status: STATUS.CLAIMED },
        { where: { id: activation.id, status: STATUS.ACTIVATED }, transaction }
      );

      if (affected === 0) throw errors.ALREADY_CLAIMED({ giftCardId });

      const movement = await this.wallet.credit(
        {
          userId,
          // Gift cards are denominated in USD; the platform's USD balance is
          // `usdt`, which is what legacy credited.
          currency: 'USDT',
          amount,
          reason: REASON.BONUS,
          // Derived from the activation row, so a retry cannot pay twice even
          // if the conditional update somehow ran again.
          idempotencyKey: `giftcard:${activation.id}`,
          refType: 'GIFT_CARD',
          refId: String(giftCardId),
          description: `Gift card ${card.unique_key}`,
        },
        { sourceService: 'user-service', transaction }
      );

      this.logger?.info(
        { userId, giftCardId, amount, ledgerId: movement.ledgerId },
        'Gift card claimed'
      );

      return { giftCardId, status: STATUS.CLAIMED, amount, currency: 'USDT', newBalance: movement.newBalance };
    });
  }

  /** @legacy GET /giftCard/user/:userId/claimed */
  async listClaimed({ userId, limit = 50, offset = 0 }) {
    const { rows, count } = await this.models.UserGiftCards.findAndCountAll({
      where: { user_id: userId, status: STATUS.CLAIMED },
      order: [['id', 'DESC']],
      limit,
      offset,
      raw: true,
    });

    const cards = await this.#cardsById(rows.map((r) => r.gift_card_id));

    return {
      total: count,
      rows: rows.map((r) => ({
        id: r.id,
        status: r.status,
        startDate: r.start_date,
        card: cards.get(String(r.gift_card_id)) ?? null,
      })),
    };
  }

  // ══════════════════════════════════════════════════════════════════════

  /**
   * Did ONE deposit in the window clear the required USD amount?
   *
   * One transaction, not a total. That is the legacy rule and it is a real
   * distinction: "deposit $100" means a single $100 deposit, not ten of $10.
   * Keeping it explicit here because a future reader will otherwise "fix" it
   * into a SUM and quietly loosen every gift card on the platform.
   */
  async #checkDeposit({ userId, from, to, requiredUsd, ctx }) {
    const rates = await this.#usdRates(ctx);
    const required = money.toDecimalString(money.toMinor(requiredUsd ?? '0'));

    for (const source of DEPOSIT_SOURCES) {
      const rows = await this.models[source.model].findAll({
        where: {
          [source.userColumn]: source.userIdIsText ? String(userId) : userId,
          status: source.successValues,
          created_at: this.#window(from, to),
        },
        order: [['created_at', 'ASC']],
        raw: true,
      });

      for (const row of rows) {
        const currency = String(source.currency ?? row.currency ?? 'USDT').toUpperCase();
        const usd = this.#toUsd(row.amount ?? '0', currency, rates);
        if (usd === null) continue;

        if (money.gte(usd, required)) {
          return {
            met: true,
            source: source.provider,
            transactionId: row[source.idColumn],
            currency,
            amount: money.toDecimalString(money.toMinor(row.amount ?? '0')),
            usd,
          };
        }
      }
    }

    return { met: false, required, reason: 'No single deposit in the period met the required amount' };
  }

  /**
   * Has the player wagered enough, across casino and sports?
   *
   * Both numbers come from the services that own those tables. Legacy queried
   * `gis_transactions`, `js_game_transactions` and `SportsBet` directly from
   * here — three tables this service does not own, and three different answers
   * across the three features that asked.
   */
  async #checkWager({ userId, from, to, requiredUsd, ctx }) {
    const required = money.toDecimalString(money.toMinor(requiredUsd ?? '0'));
    const totals = await this.#wagerTotals({ userId, from, to, ctx });

    if (totals.incomplete) {
      return { met: false, required, incomplete: true, reason: 'Wagering data is temporarily unavailable' };
    }

    return {
      met: money.gte(totals.totalUsd, required),
      required,
      wagered: totals.totalUsd,
      casinoBets: totals.casinoBets,
      sportsBets: totals.sportsBets,
    };
  }

  /**
   * The requirement is a MULTIPLE of the deposit when a deposit is also
   * required, and a flat figure otherwise. `wager_times` is doing two jobs
   * depending on a different column, which is confusing but is the live
   * behaviour and changing it silently would reprice every open card.
   *
   * Shared with the listing, so what a player is shown is what they are
   * measured against — the two drifting apart is a support ticket that reads
   * "it said I'd met it".
   */
  #requiredWagerUsd(card) {
    if (!card.wager_status) return '0';
    return card.deposit_status && card.deposit_amount
      ? money.toDecimalString(money.multiply(String(card.deposit_amount), String(card.wager_times ?? 0)))
      : String(card.wager_times ?? 0);
  }

  /**
   * Turnover across casino and sports for a window, in USD.
   *
   * Memoised on `ctx` by window: the listing evaluates every card, and cards
   * that are all unactivated share one window.
   */
  async #wagerTotals({ userId, from, to, ctx }) {
    const key = `${from ? new Date(from).toISOString() : ''}|${to ? new Date(to).toISOString() : ''}`;
    // The PROMISE is cached, not the result, so cards resolving concurrently on
    // the same window make one call rather than racing to make several.
    if (ctx?.wager.has(key)) return ctx.wager.get(key);

    const pending = this.#fetchWagerTotals({ userId, from, to, ctx });
    ctx?.wager.set(key, pending);
    return pending;
  }

  async #fetchWagerTotals({ userId, from, to, ctx }) {
    const query = { query: { ...(from ? { from: new Date(from).toISOString() } : {}), ...(to ? { to: new Date(to).toISOString() } : {}) } };

    const [casino, sports] = await Promise.all([
      this.clients.casino.get(`/internal/casino/wager/turnover/${userId}`, query).catch((error) => {
        this.logger?.error({ err: error, userId }, 'Casino turnover unavailable');
        return null;
      }),
      this.clients.sports.get(`/internal/sports/wager/turnover/${userId}`, query).catch((error) => {
        this.logger?.error({ err: error, userId }, 'Sports turnover unavailable');
        return null;
      }),
    ]);

    /**
     * A service that did not answer makes the total an UNDERCOUNT, so the
     * condition is reported unmet rather than met.
     *
     * That is the safe direction: a player told "not yet" can try again in a
     * minute, where one paid on an incomplete total cannot be un-paid.
     */
    if (!casino || !sports) {
      return { incomplete: true, totalUsd: '0', casinoBets: 0, sportsBets: 0 };
    }

    const rates = await this.#usdRates(ctx);
    let totalUsd = money.toDecimalString(money.toMinor(sports.usd ?? '0'));

    for (const [currency, amount] of Object.entries(casino.byCurrency ?? {})) {
      const usd = this.#toUsd(amount, currency, rates);
      if (usd === null) {
        this.logger?.warn({ currency, userId }, 'No rate for a wagered currency — excluded from the total');
        continue;
      }
      totalUsd = money.toDecimalString(money.add(totalUsd, usd));
    }

    return {
      incomplete: false,
      totalUsd,
      casinoBets: casino.bets ?? 0,
      sportsBets: sports.bets ?? 0,
    };
  }

  /** `usd_rate` is USD per 1 unit of the currency. */
  async #usdRates(ctx) {
    if (ctx?.rates) return ctx.rates;
    const pending = this.#loadUsdRates();
    if (ctx) ctx.rates = pending;
    return pending;
  }

  async #loadUsdRates() {
    const rows = await this.models.Exchangerate.findAll({ raw: true });
    const rates = new Map();
    for (const row of rows) {
      const rate = Number(row.usd_rate);
      if (Number.isFinite(rate) && rate > 0) rates.set(String(row.currency).toUpperCase(), String(row.usd_rate));
    }
    if (!rates.size) throw errors.RATE_UNAVAILABLE();
    return rates;
  }

  /** Null when the currency has no rate — the caller decides what that means. */
  #toUsd(amount, currency, rates) {
    const upper = String(currency).toUpperCase();
    // USDT is treated as USD, which is what the legacy comment said and what
    // every stablecoin balance on the platform assumes.
    if (upper === 'USD' || upper === 'USDT') return money.toDecimalString(money.toMinor(amount));

    const rate = rates.get(upper);
    if (!rate) return null;
    return money.toDecimalString(money.multiply(amount, rate));
  }

  /**
   * The window a qualifying deposit or bet must fall in.
   *
   * Half-open — `>= from`, `< to`. `BETWEEN` is inclusive at both ends, so a
   * transaction landing on the exact boundary counted towards two adjacent
   * periods.
   *
   * A null `to` means NO upper bound, and that is deliberate rather than a
   * missing case. An open-ended card's conditions run until it is claimed, so
   * clamping the window to `< now` at claim time excludes a deposit made in the
   * same millisecond as the claim — which is not a hypothetical, it is what a
   * player does when they deposit and immediately press claim.
   */
  #window(from, to) {
    const range = {};
    if (from) range[Op.gte] = new Date(from);
    if (to) range[Op.lt] = new Date(to);
    return range;
  }

  /**
   * When the conditions stop counting, or null if they do not.
   *
   * `period_days` from activation if set, otherwise `end_date`, otherwise open.
   * Legacy used `row.end_date || new Date()` and ignored `period_days` entirely
   * — so a "deposit within 7 days" card actually accepted a deposit made any
   * time up to the card's global end date, which for a card with no end date
   * meant forever.
   */
  #conditionEnd(card, activation) {
    const start = activation.start_date ? new Date(activation.start_date) : new Date();

    if (card.period_days) {
      const byPeriod = new Date(start);
      byPeriod.setUTCDate(byPeriod.getUTCDate() + Number(card.period_days));
      const byEndDate = card.end_date ? new Date(card.end_date) : null;
      // Whichever comes first — a card cannot outlive its own end date.
      return byEndDate && byEndDate < byPeriod ? byEndDate : byPeriod;
    }

    return card.end_date ? new Date(card.end_date) : null;
  }

  #isExpired(card, activation) {
    if (card.end_date && new Date(card.end_date) < new Date()) return true;
    if (!activation || !card.period_days) return false;

    const end = this.#conditionEnd(card, activation);
    return end != null && end < new Date();
  }

  async #cardsById(ids) {
    if (!ids.length) return new Map();
    const cards = await this.models.GiftCards.findAll({ where: { id: [...new Set(ids)] }, raw: true });
    return new Map(cards.map((c) => [String(c.id), this.#shape(c)]));
  }

  /**
   * The card as the player-facing page reads it: legacy column names, and
   * amounts as NUMBERS.
   *
   * The number matters — the page does `amount * wagerTimes` and sums balances
   * with `+`, and a string turns that second one into "030.00000000". These are
   * display figures under a few thousand dollars, so the float is safe here;
   * anything that moves money still goes through `money` and `#shape`.
   */
  #shapeLegacy(card) {
    return {
      id: card.id,
      uniqueKey: card.unique_key,
      description: card.description,
      periodDays: card.period_days,
      endDate: card.end_date,
      depositStatus: Boolean(card.deposit_status),
      depositAmount: card.deposit_amount != null ? this.#num(card.deposit_amount) : null,
      wagerStatus: Boolean(card.wager_status),
      wagerTimes: card.wager_times,
      allUserStatus: Boolean(card.all_user_status),
      isActive: Boolean(card.is_active),
      amount: this.#num(card.amount ?? '0'),
    };
  }

  #num(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  #shape(card) {
    return {
      id: card.id,
      uniqueKey: card.unique_key,
      description: card.description,
      amount: money.toDecimalString(money.toMinor(card.amount ?? '0')),
      currency: 'USDT',
      periodDays: card.period_days,
      endDate: card.end_date,
      depositRequired: Boolean(card.deposit_status),
      depositAmount: card.deposit_amount != null ? money.toDecimalString(money.toMinor(card.deposit_amount)) : null,
      wagerRequired: Boolean(card.wager_status),
      wagerTimes: card.wager_times,
      allUsers: Boolean(card.all_user_status),
      isActive: Boolean(card.is_active),
    };
  }
}

module.exports = { GiftCardsService };
