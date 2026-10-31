'use strict';

const { Op } = require('@ibitplay/db');
const { money } = require('@ibitplay/common');

const errors = require('./challenges.errors');
const { STATUS, IN_HOUSE_GAMES, RATES_TTL_MS, NAME_SHOWN } = require('./challenges.constants');

const dec = (minor) => money.toDecimalString(minor);
const iso = (d) => (d ? new Date(d).toISOString() : null);
const maskName = (name) => {
  const text = String(name ?? '');
  return text.length > NAME_SHOWN ? `${text.slice(0, NAME_SHOWN)}...` : text;
};

/** The price table, shared by every instance and re-read once a minute. */
let rates = { at: 0, byCode: new Map() };

/**
 * Casino challenges (rainbet) — see migration 166. A settled in-house round is checked against
 * the open challenges on its game; the first players to qualify win the prize, paid through the
 * wallet in the coin they bet in.
 */
class ChallengeService {
  constructor(deps) {
    this.models = deps.models;
    this.logger = deps.logger;
    this.clients = deps.clients;
    this.wallet = deps.wallet;
  }

  // ══ Players ═════════════════════════════════════════════════════════

  /**
   * Running challenges (not cancelled, in their dates, winners still to find) and completed ones
   * (winners found or time up) — newest first, with the winners' masked names.
   */
  async list() {
    const rows = await this.models.CasinoChallenge.findAll({
      where: { status: STATUS.ACTIVE, starts_at: { [Op.lte]: new Date() } },
      order: [['created_at', 'DESC']],
      limit: 200,
      raw: true,
    });
    const winners = await this.#winnersOf(rows.map((r) => r.id));
    const now = new Date();
    const active = [];
    const completed = [];
    for (const row of rows) {
      const won = winners.get(String(row.id)) ?? [];
      const shaped = { ...this.#shape(row), winnersFound: won.length, winnerNames: won.map((w) => maskName(w.name)) };
      if (won.length >= Number(row.winners) || new Date(row.ends_at) <= now) completed.push(shaped);
      else active.push(shaped);
    }
    return { active, completed: completed.slice(0, 50) };
  }

  /**
   * A round settled (in-house engine). Never throws: a challenge problem must not touch the round.
   */
  async onSettled({ userId, game, coin, amount, profit, betId }) {
    try {
      if (!userId || !(Number(amount) > 0)) return;
      const now = new Date();
      const open = await this.models.CasinoChallenge.findAll({
        where: { game, status: STATUS.ACTIVE, starts_at: { [Op.lte]: now }, ends_at: { [Op.gt]: now } },
        raw: true,
      });
      if (!open.length) return;

      const multiplier = dec(money.divide(dec(money.add(String(amount), String(profit ?? '0'))), String(amount)));
      const betUsd = await this.#toUsd(String(amount), coin);
      if (betUsd == null) return;

      for (const challenge of open) {
        if (money.lt(multiplier, String(challenge.min_multiplier)) || money.lt(betUsd, String(challenge.min_bet_usd))) continue;
        const found = await this.models.CasinoChallengeWinner.count({ where: { challenge_id: challenge.id } });
        if (found >= Number(challenge.winners)) continue;
        await this.#award(challenge, { userId, coin, betId, multiplier, betUsd });
      }
    } catch (error) {
      this.logger?.warn({ err: error, game, betId: String(betId ?? '') }, 'Challenge check failed');
    }
  }

  // ══ Staff ═══════════════════════════════════════════════════════════

  games() {
    return IN_HOUSE_GAMES;
  }

  async listForStaff() {
    const rows = await this.models.CasinoChallenge.findAll({ order: [['created_at', 'DESC']], limit: 200, raw: true });
    const winners = await this.#winnersOf(rows.map((r) => r.id));
    return rows.map((r) => ({
      ...this.#shape(r),
      winnersList: (winners.get(String(r.id)) ?? []).map((w) => ({
        userId: String(w.user_id),
        player: w.name,
        multiplier: String(w.multiplier),
        currency: w.currency,
        amount: w.amount == null ? null : String(w.amount),
        paid: w.ledger_id != null,
        at: iso(w.created_at),
      })),
    }));
  }

  /**
   * `game` is a catalogue game's id (`game_uid`, from the admin's catalogue search) or an in-house
   * key; a catalogue game needs its name, an in-house one has a default.
   */
  async create(body) {
    const inHouse = IN_HOUSE_GAMES.find((g) => g.key === body.game);
    const game = inHouse ?? (body.gameName?.trim() ? { key: body.game, name: body.gameName.trim() } : null);
    if (!game) throw errors.UNKNOWN_GAME({ game: body.game });
    const startsAt = body.startsAt ? new Date(body.startsAt) : new Date();
    const endsAt = new Date(body.endsAt);
    if (!(endsAt > startsAt)) throw errors.BAD_DATES();
    const row = await this.models.CasinoChallenge.create({
      game: game.key,
      game_name: body.gameName?.trim() || game.name,
      image_url: body.imageUrl?.trim() || null,
      min_multiplier: String(body.minMultiplier),
      min_bet_usd: String(body.minBetUsd),
      prize_usd: String(body.prizeUsd),
      winners: body.winners ?? 1,
      starts_at: startsAt,
      ends_at: endsAt,
      status: STATUS.ACTIVE,
      created_at: new Date(),
    });
    return this.#shape(row.get({ plain: true }));
  }

  async cancel(id) {
    const [count] = await this.models.CasinoChallenge.update({ status: STATUS.CANCELLED }, { where: { id, status: STATUS.ACTIVE } });
    if (!count) throw errors.NOT_FOUND({ id });
    return { id: String(id), status: STATUS.CANCELLED };
  }

  // ══ Internals ═══════════════════════════════════════════════════════

  #shape(r) {
    return {
      id: String(r.id),
      game: r.game,
      gameName: r.game_name,
      imageUrl: r.image_url,
      minMultiplier: String(r.min_multiplier),
      minBetUsd: String(r.min_bet_usd),
      prizeUsd: String(r.prize_usd),
      winners: Number(r.winners),
      startsAt: iso(r.starts_at),
      endsAt: iso(r.ends_at),
      status: r.status,
    };
  }

  /** `Map<challengeId, [{ user_id, name, … }]>` in winning order. */
  async #winnersOf(ids) {
    if (!ids.length) return new Map();
    const rows = await this.models.CasinoChallengeWinner.findAll({ where: { challenge_id: ids }, order: [['id', 'ASC']], raw: true });
    const users = rows.length
      ? await this.models.Users.findAll({ where: { id: [...new Set(rows.map((r) => String(r.user_id)))] }, attributes: ['id', 'name'], raw: true })
      : [];
    const names = new Map(users.map((u) => [String(u.id), u.name]));
    const out = new Map();
    for (const r of rows) {
      const key = String(r.challenge_id);
      if (!out.has(key)) out.set(key, []);
      out.get(key).push({ ...r, name: names.get(String(r.user_id)) ?? null });
    }
    return out;
  }

  /** Record the win (unique per player per challenge), then pay the prize in the bet's coin. */
  async #award(challenge, { userId, coin, betId, multiplier, betUsd }) {
    let row;
    try {
      row = await this.models.CasinoChallengeWinner.create({
        challenge_id: challenge.id,
        user_id: userId,
        bet_id: String(betId ?? ''),
        multiplier,
        bet_usd: betUsd,
        created_at: new Date(),
      });
    } catch (error) {
      if (error?.name === 'SequelizeUniqueConstraintError') return; // already won this one
      throw error;
    }
    const currency = String(coin).toUpperCase();
    const amount = await this.#fromUsd(String(challenge.prize_usd), currency);
    if (amount == null) {
      this.logger?.error({ challengeId: String(challenge.id), currency }, 'Challenge prize unpriced; left unpaid');
      return;
    }
    const movement = await this.wallet.credit({
      userId: String(userId),
      currency,
      amount,
      reason: 'BONUS',
      ref: { type: 'CHALLENGE_WIN', id: row.id },
      description: `Challenge won — ${challenge.game_name} ${Number(challenge.min_multiplier)}x`,
    });
    await this.models.CasinoChallengeWinner.update({ currency, amount, ledger_id: movement?.ledgerId ?? null }, { where: { id: row.id } });
    this.logger?.info({ challengeId: String(challenge.id), userId: String(userId) }, 'Challenge won');
  }

  async #rates() {
    if (Date.now() - rates.at > RATES_TTL_MS) {
      const list = (await this.clients.user.get('/internal/user/exchange-rate/rates')) ?? [];
      rates = { at: Date.now(), byCode: new Map(list.map((r) => [String(r.currency).toUpperCase(), String(r.usdRate)])) };
    }
    return rates.byCode;
  }

  /** USD per unit; USD-pegged coins are 1 without a row. */
  async #usdRate(code) {
    const upper = String(code).toUpperCase();
    const rate = (await this.#rates()).get(upper);
    if (rate && money.gt(rate, '0')) return rate;
    return ['USD', 'USDT', 'USDC', 'BUSD', 'TUSD', 'USDP'].includes(upper) ? '1' : null;
  }

  async #toUsd(amount, coin) {
    const rate = await this.#usdRate(coin);
    return rate == null ? null : dec(money.multiply(amount, rate));
  }

  async #fromUsd(usd, coin) {
    const rate = await this.#usdRate(coin);
    return rate == null ? null : dec(money.divide(usd, rate));
  }
}

module.exports = { ChallengeService, maskName };
