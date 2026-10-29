'use strict';

const crypto = require('node:crypto');
const { Op } = require('@ibitplay/db');
const { money } = require('@ibitplay/common');

const errors = require('./raffle.errors');
const {
  REASON,
  WEEK_MS,
  ANCHOR_DRAW,
  ANCHOR_TIME,
  DRAW_STATUS,
  TICKET_SOURCE,
  TICKET_MIN,
  TICKET_MAX,
  NAME_SHOWN,
} = require('./raffle.constants');
const { WalletService } = require('../wallet/wallet.service');
const { notifyBonus } = require('../notifications/notifyPlayer');
const { createRewardMoney } = require('../../lib/rewardMoney');
const { betUsage, wageredByPlayer } = require('../../lib/betUsage');
const { vipCardsFor } = require('../../lib/vipCards');

/** The draw due at `at` (a Sunday 00:00 UTC) — its number. */
const numberAt = (at) => ANCHOR_DRAW + Math.round((at.getTime() - ANCHOR_TIME) / WEEK_MS);
/** When draw `number` is made. */
const drawAtOf = (number) => new Date(ANCHOR_TIME + (number - ANCHOR_DRAW) * WEEK_MS);
/** The draw now running: the next Sunday 00:00 UTC strictly after `now`. */
function currentNumber(now = new Date()) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + ((7 - d.getUTCDay()) % 7 || 7));
  return numberAt(d);
}

/** "Yamu..." — enough to recognise yourself, not enough to look anyone up. */
const maskName = (name) => {
  const text = String(name ?? '');
  return text.length > NAME_SHOWN ? `${text.slice(0, NAME_SHOWN)}...` : text;
};

const dec = (minor) => money.toDecimalString(minor);
const iso = (d) => (d ? new Date(d).toISOString() : null);

/** A ticket as the player site lists it. */
const shapeTicket = (row) => ({ ticket: String(row.ticket_number), source: row.source, createdAt: iso(row.created_at) });

/**
 * The weekly raffle (rainbet) — see migration 164 for the rules.
 *
 * Wager tickets are not written per bet: they are worked out from the ledger and topped up when
 * the player looks at the raffle, and for everyone when the draw is made, so a bet path never
 * waits on the raffle.
 */
class RaffleService {
  constructor(deps) {
    this.deps = deps;
    this.models = deps.models;
    this.db = deps.db;
    this.logger = deps.logger;
    this.rewardMoney = deps.rewardMoney ?? createRewardMoney(deps);
    this.wallet = deps.wallet ?? new WalletService(deps);
  }

  // ══ Player ══════════════════════════════════════════════════════════

  /** The running draw and the rules, for everyone. */
  async current() {
    const config = await this.#config();
    const draw = await this.#ensureDraw(currentNumber());
    // Drawn early (admin): the closed draw keeps its figures, but the rules shown are the
    // settings the next draw opens with.
    const shown =
      draw.status === DRAW_STATUS.DRAWN
        ? { ...draw, prize_pool_usd: config.prize_pool_usd, winners: config.winners, wager_per_ticket_usd: config.wager_per_ticket_usd }
        : draw;
    return {
      enabled: config.enabled,
      ...this.#shapeDraw(shown),
      latestDrawn: (await this.#latestDrawn())?.number ?? null,
    };
  }

  /** The player's tickets in the running draw (wager tickets topped up first). */
  async mine(userId) {
    const draw = await this.#ensureDraw(currentNumber());
    await this.#topUpWagerTickets(draw, userId);
    const tickets = await this.models.RaffleTicket.findAll({
      where: { draw_number: draw.number, user_id: userId },
      order: [['created_at', 'ASC']],
      raw: true,
    });
    const wagered = await this.#wagered(draw, userId);
    return {
      number: draw.number,
      tickets: tickets.map(shapeTicket),
      freeClaimed: tickets.some((t) => t.source === TICKET_SOURCE.FREE),
      wageredUsd: wagered,
      nextTicketInUsd: dec(money.subtract(String(draw.wager_per_ticket_usd), dec(money.toMinor(this.#remainder(wagered, draw))))),
    };
  }

  /** The free ticket — one per player per draw. */
  async claimFree(userId) {
    const config = await this.#config();
    if (!config.enabled) throw errors.DISABLED();
    const draw = await this.#ensureDraw(currentNumber());
    // Made early by the site admin: the next draw opens on Sunday.
    if (draw.status === DRAW_STATUS.DRAWN) throw errors.DRAW_CLOSED({ number: draw.number });
    const had = await this.models.RaffleTicket.count({
      where: { draw_number: draw.number, user_id: userId, source: TICKET_SOURCE.FREE },
    });
    if (had) throw errors.ALREADY_CLAIMED({ number: draw.number });
    try {
      const row = await this.#issue(draw.number, userId, TICKET_SOURCE.FREE);
      return shapeTicket(row);
    } catch (error) {
      // Two claims raced: the partial unique index let one through.
      if (error?.name === 'SequelizeUniqueConstraintError') throw errors.ALREADY_CLAIMED({ number: draw.number });
      throw error;
    }
  }

  /**
   * A drawn draw's winning tickets — masked names, VIP medals, how many tickets each winner held —
   * and, for a signed-in player, their own tickets in it.
   */
  async results(number, userId = null) {
    const draw = await this.models.RaffleDraw.findByPk(number, { raw: true });
    if (!draw) throw errors.DRAW_NOT_FOUND({ number });
    const [winners, mine] = await Promise.all([
      this.models.RaffleWinner.findAll({ where: { draw_number: number }, order: [['id', 'ASC']], raw: true }),
      userId
        ? this.models.RaffleTicket.findAll({ where: { draw_number: number, user_id: userId }, order: [['created_at', 'ASC']], raw: true })
        : [],
    ]);
    return { ...this.#shapeDraw(draw), winners: await this.#shapeWinners(winners), myTickets: mine.map(shapeTicket) };
  }

  // ══ The draw ════════════════════════════════════════════════════════

  /**
   * Make draw `number`: top up every player's wager tickets, pick the winning tickets at random
   * (`crypto.randomInt`), record them and close the draw — in one transaction holding the draw
   * row, so it is made once. The prizes are credited afterwards (`payUnpaid`), each idempotent on
   * its winner row, so a failed credit is retried rather than lost or paid twice.
   *
   * `force` lets the site admin close the running draw early; the job only makes a draw once its
   * time has come.
   */
  async runDraw(number, { force = false } = {}) {
    const draw = await this.#ensureDraw(number);
    if (draw.status === DRAW_STATUS.DRAWN) throw errors.ALREADY_DRAWN({ number });
    if (!force && new Date(draw.draw_at) > new Date()) return null;

    await this.#topUpWagerTickets(draw);

    await this.db.transaction(async (transaction) => {
      const locked = await this.models.RaffleDraw.findByPk(number, { transaction, lock: transaction.LOCK.UPDATE, raw: true });
      if (locked.status === DRAW_STATUS.DRAWN) throw errors.ALREADY_DRAWN({ number });

      const tickets = await this.models.RaffleTicket.findAll({
        where: { draw_number: number },
        attributes: ['id', 'user_id'],
        transaction,
        raw: true,
      });
      const count = Math.min(Number(locked.winners), tickets.length);
      const prize = count ? dec(money.divide(String(locked.prize_pool_usd), Number(locked.winners))) : '0';

      // A partial Fisher-Yates over the ticket list: `count` distinct tickets, each equally likely.
      const pool = tickets.slice();
      for (let i = 0; i < count; i += 1) {
        const j = i + crypto.randomInt(pool.length - i);
        [pool[i], pool[j]] = [pool[j], pool[i]];
      }
      if (count) {
        await this.models.RaffleWinner.bulkCreate(
          pool.slice(0, count).map((t) => ({
            draw_number: number,
            ticket_id: t.id,
            user_id: t.user_id,
            prize_usd: prize,
            created_at: new Date(),
          })),
          { transaction }
        );
      }
      await this.models.RaffleDraw.update(
        { status: DRAW_STATUS.DRAWN, ticket_count: tickets.length, drawn_at: new Date() },
        { where: { number }, transaction }
      );
    });

    this.logger?.info({ number }, 'Raffle draw made');
    await this.payUnpaid();
    return this.results(number);
  }

  /** Credit every winner not yet paid, in the reward coin. Safe to repeat. */
  async payUnpaid() {
    const unpaid = await this.models.RaffleWinner.findAll({ where: { ledger_id: null }, order: [['id', 'ASC']], limit: 500, raw: true });
    for (const row of unpaid) {
      try {
        const payout = await this.rewardMoney.fromUsd(String(row.prize_usd));
        if (!money.gt(String(payout.amount), '0')) continue;
        const movement = await this.wallet.credit(
          {
            userId: row.user_id,
            currency: payout.currency,
            amount: payout.amount,
            reason: REASON.PRIZE,
            idempotencyKey: `raffle-winner:${row.id}`,
            refType: 'RAFFLE_WIN',
            refId: String(row.id),
            description: `Weekly raffle draw #${row.draw_number} — winning ticket`,
          },
          { sourceService: 'user-service' }
        );
        await this.models.RaffleWinner.update(
          { currency: payout.currency, amount: payout.amount, ledger_id: movement.ledgerId },
          { where: { id: row.id } }
        );
        void notifyBonus(row.user_id, {
          key: `raffle-winner:${row.id}`,
          title: `You won in raffle draw #${row.draw_number}`,
          amount: payout.amount,
          currency: payout.currency,
          link: '/raffle',
        }).catch(() => {});
      } catch (error) {
        this.logger?.error({ err: error, winnerId: String(row.id) }, 'Raffle prize could not be credited; the next tick retries');
      }
    }
  }

  /** The job: make every draw whose time has come, then pay anything left unpaid. */
  async runDue() {
    const due = await this.models.RaffleDraw.findAll({
      where: { status: DRAW_STATUS.OPEN, draw_at: { [Op.lte]: new Date() } },
      order: [['number', 'ASC']],
      raw: true,
    });
    for (const draw of due) {
      try {
        await this.runDraw(draw.number);
      } catch (error) {
        if (error?.code !== 'RAFFLE_ALREADY_DRAWN') this.logger?.error({ err: error, number: draw.number }, 'Raffle draw failed');
      }
    }
    await this.payUnpaid();
  }

  // ══ Staff ═══════════════════════════════════════════════════════════

  async getConfig() {
    return this.#shapeConfig(await this.#config());
  }

  /**
   * Applies to the open draw too, so the site shows what the admin set. Wager tickets already
   * issued stay; new ones follow the new wager per ticket.
   */
  async updateConfig(patch) {
    const fields = {};
    if (patch.enabled !== undefined) fields.enabled = patch.enabled;
    if (patch.prizePoolUsd !== undefined) fields.prize_pool_usd = String(patch.prizePoolUsd);
    if (patch.winners !== undefined) fields.winners = patch.winners;
    if (patch.wagerPerTicketUsd !== undefined) fields.wager_per_ticket_usd = String(patch.wagerPerTicketUsd);
    await this.#config();
    await this.models.RaffleConfig.update({ ...fields, updated_at: new Date() }, { where: { id: 1 } });
    const { enabled: _enabled, ...drawFields } = fields;
    if (Object.keys(drawFields).length) await this.models.RaffleDraw.update(drawFields, { where: { status: DRAW_STATUS.OPEN } });
    return this.getConfig();
  }

  /** Recent draws, newest first, with ticket and winner counts. */
  async listDraws({ limit = 20 } = {}) {
    await this.#ensureDraw(currentNumber());
    const draws = await this.models.RaffleDraw.findAll({ order: [['number', 'DESC']], limit, raw: true });
    const numbers = draws.map((d) => d.number);
    const [tickets, paid] = await Promise.all([
      this.models.RaffleTicket.count({ where: { draw_number: numbers }, group: ['draw_number'] }),
      this.models.RaffleWinner.count({ where: { draw_number: numbers, ledger_id: { [Op.ne]: null } }, group: ['draw_number'] }),
    ]);
    const by = (list) => new Map(list.map((r) => [Number(r.draw_number), Number(r.count)]));
    const ticketCount = by(tickets);
    const paidCount = by(paid);
    return draws.map((d) => ({
      ...this.#shapeDraw(d),
      tickets: d.ticket_count ?? ticketCount.get(d.number) ?? 0,
      paidWinners: paidCount.get(d.number) ?? 0,
    }));
  }

  /** One draw's winners for staff — full names and the credited amounts. */
  async drawForStaff(number) {
    const draw = await this.models.RaffleDraw.findByPk(number, { raw: true });
    if (!draw) throw errors.DRAW_NOT_FOUND({ number });
    const winners = await this.models.RaffleWinner.findAll({ where: { draw_number: number }, order: [['id', 'ASC']], raw: true });
    const [names, tickets] = await Promise.all([
      this.#names(winners.map((w) => w.user_id)),
      this.models.RaffleTicket.findAll({ where: { id: winners.map((w) => w.ticket_id) }, attributes: ['id', 'ticket_number'], raw: true }),
    ]);
    const number_ = new Map(tickets.map((t) => [String(t.id), String(t.ticket_number)]));
    return {
      ...this.#shapeDraw(draw),
      winners: winners.map((w) => ({
        userId: String(w.user_id),
        player: names.get(String(w.user_id)) ?? null,
        ticket: number_.get(String(w.ticket_id)) ?? null,
        prizeUsd: String(w.prize_usd),
        currency: w.currency,
        amount: w.amount == null ? null : String(w.amount),
        paid: w.ledger_id != null,
      })),
    };
  }

  // ══ Internals ═══════════════════════════════════════════════════════

  async #config() {
    const [row] = await this.models.RaffleConfig.findOrCreate({ where: { id: 1 }, defaults: { id: 1, enabled: true, prize_pool_usd: '20000', winners: 50, wager_per_ticket_usd: '500', updated_at: new Date() } });
    return row.get({ plain: true });
  }

  #shapeConfig(c) {
    return {
      enabled: Boolean(c.enabled),
      prizePoolUsd: String(c.prize_pool_usd),
      winners: Number(c.winners),
      wagerPerTicketUsd: String(c.wager_per_ticket_usd),
      updatedAt: iso(c.updated_at),
    };
  }

  #shapeDraw(d) {
    return {
      number: d.number,
      startsAt: iso(d.starts_at),
      drawAt: iso(d.draw_at),
      status: d.status,
      prizePoolUsd: String(d.prize_pool_usd),
      winners: Number(d.winners),
      prizeUsd: dec(money.divide(String(d.prize_pool_usd), Number(d.winners) || 1)),
      wagerPerTicketUsd: String(d.wager_per_ticket_usd),
      ticketCount: d.ticket_count ?? null,
    };
  }

  /** The draw's row, opened with the current settings the first time anyone asks for it. */
  async #ensureDraw(number) {
    const existing = await this.models.RaffleDraw.findByPk(number, { raw: true });
    if (existing) return existing;
    const config = await this.#config();
    const drawAt = drawAtOf(number);
    const [row] = await this.models.RaffleDraw.findOrCreate({
      where: { number },
      defaults: {
        number,
        starts_at: new Date(drawAt.getTime() - WEEK_MS),
        draw_at: drawAt,
        status: DRAW_STATUS.OPEN,
        prize_pool_usd: config.prize_pool_usd,
        winners: config.winners,
        wager_per_ticket_usd: config.wager_per_ticket_usd,
      },
    });
    return row.get({ plain: true });
  }

  #latestDrawn() {
    return this.models.RaffleDraw.findOne({ where: { status: DRAW_STATUS.DRAWN }, order: [['number', 'DESC']], raw: true });
  }

  async #wagered(draw, userId) {
    const used = await betUsage(
      { db: this.db, toUsd: this.rewardMoney.toUsd },
      { userId, since: new Date(draw.starts_at), until: new Date(draw.draw_at) }
    );
    return used.wagered;
  }

  /** What has been wagered past the last whole ticket. */
  #remainder(wagered, draw) {
    const per = Number(draw.wager_per_ticket_usd);
    return per > 0 ? String((Number(wagered) % per).toFixed(2)) : '0';
  }

  /**
   * Write the wager tickets earned so far: one per `wager_per_ticket_usd` staked in the draw's
   * week. One player when `userId` is given, everyone who bet otherwise (at draw time).
   */
  async #topUpWagerTickets(draw, userId = null) {
    if (draw.status === DRAW_STATUS.DRAWN) return;
    const per = Number(draw.wager_per_ticket_usd);
    if (!(per > 0)) return;
    const window = { since: new Date(draw.starts_at), until: new Date(draw.draw_at) };
    const wagers = userId
      ? new Map([[String(userId), await this.#wagered(draw, userId)]])
      : await wageredByPlayer({ db: this.db, toUsd: this.rewardMoney.toUsd }, window);

    for (const [id, wagered] of wagers) {
      const earned = Math.floor(Number(wagered) / per);
      if (!earned) continue;
      const held = await this.models.RaffleTicket.count({ where: { draw_number: draw.number, user_id: id, source: TICKET_SOURCE.WAGER } });
      for (let i = held; i < earned; i += 1) await this.#issue(draw.number, id, TICKET_SOURCE.WAGER);
    }
  }

  /** A new ticket with a fresh seven-digit number (retried on the rare clash). */
  async #issue(drawNumber, userId, source) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        const row = await this.models.RaffleTicket.create({
          draw_number: drawNumber,
          user_id: userId,
          ticket_number: crypto.randomInt(TICKET_MIN, TICKET_MAX + 1),
          source,
          created_at: new Date(),
        });
        return row.get({ plain: true });
      } catch (error) {
        const clash = error?.name === 'SequelizeUniqueConstraintError' && /ticket_number/.test(JSON.stringify(error.fields ?? error.parent?.detail ?? ''));
        if (!clash) throw error;
      }
    }
    throw new Error('Could not find a free ticket number');
  }

  async #names(userIds) {
    if (!userIds.length) return new Map();
    const rows = await this.models.Users.findAll({ where: { id: [...new Set(userIds.map(String))] }, attributes: ['id', 'name'], raw: true });
    return new Map(rows.map((r) => [String(r.id), r.name]));
  }

  /** Public winners: masked name, VIP medal, the winner's ticket count in the draw, the prize. */
  async #shapeWinners(winners) {
    if (!winners.length) return [];
    const ids = winners.map((w) => w.user_id);
    const drawNumber = winners[0].draw_number;
    const [names, cards, tickets, counts] = await Promise.all([
      this.#names(ids),
      vipCardsFor(this, ids),
      this.models.RaffleTicket.findAll({ where: { id: winners.map((w) => w.ticket_id) }, attributes: ['id', 'ticket_number'], raw: true }),
      this.models.RaffleTicket.count({ where: { draw_number: drawNumber, user_id: [...new Set(ids.map(String))] }, group: ['user_id'] }),
    ]);
    const number_ = new Map(tickets.map((t) => [String(t.id), String(t.ticket_number)]));
    const held = new Map(counts.map((r) => [String(r.user_id), Number(r.count)]));
    return winners.map((w) => {
      const id = String(w.user_id);
      return {
        ticket: number_.get(String(w.ticket_id)) ?? null,
        player: maskName(names.get(id)),
        card: cards.get(id)?.card ?? null,
        badgeUrl: cards.get(id)?.badgeUrl ?? null,
        count: held.get(id) ?? 1,
        prizeUsd: String(w.prize_usd),
      };
    });
  }
}

module.exports = { RaffleService, currentNumber, numberAt, drawAtOf, maskName };
