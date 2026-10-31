'use strict';

const { money, resolveVipLadder } = require('@ibitplay/common');

const { MedalsRepository } = require('./medals.repository');
const { MEDALS, SOURCE, COMPLETED_TARGET, DAY_MS } = require('./medals.constants');
const errors = require('./medals.errors');
/**
 * The play totals (bets, casino net, best multiplier) come from the profile's
 * own stats service: one place folds casino- and sports-service into USD, and
 * its 60 s per-player cache is shared rather than duplicated. Same service, so
 * imported directly — the precedent is `profile/routes/user.routes.js`
 * importing the email module.
 */
const { ProfileStatsService } = require('../profile/profileStats.service');

/**
 * Profile medals — gap 9.
 *
 * ── EVALUATED ON READ ──────────────────────────────────────────────────────
 *
 * A read gathers the facts each rule measures (a handful of one-player SQL
 * reads, plus the cached play totals for the three `remote` rules), decides
 * which medals are met, and writes a `user_medals` row for any met medal not
 * yet held. So a medal appears the first time the player (or anyone looking at
 * their profile) reads after crossing the line — there is no hook on the
 * wager or deposit paths, and none is needed: nothing is paid, so nothing is
 * late.
 *
 * ── HELD IS FOREVER ────────────────────────────────────────────────────────
 *
 * A held medal stays held even if its figure later drops below the line
 * (someone else passes a "highest wager ever" record; a casino profit turns
 * back into a loss). That is the reference's meaning of "earned on".
 *
 * ── NOTHING IS GUESSED ─────────────────────────────────────────────────────
 *
 * A medal with no rule (see the constants) is always locked. A `remote` rule
 * whose source could not be read answers `available: false` with no progress
 * and does not unlock — the play totals failing must not 500 the dialog, and
 * must not read as "0 bets".
 *
 * ── THE PUBLIC VIEW DOES NOT FAN OUT ───────────────────────────────────────
 *
 * `forPublic` runs only the `db` rules: an unauthenticated visitor should not
 * be able to drive casino- and sports-service reads for any id. The `remote`
 * medals still show there once the player's own read has recorded them.
 */
class MedalsService {
  constructor(deps) {
    this.repo = new MedalsRepository(deps);
    this.models = deps.models;
    this.logger = deps.logger;
    this.now = deps.now ?? (() => Date.now());
    this.stats = deps.profileStats ?? new ProfileStatsService(deps);
  }

  /** `GET /user/medals` — the caller's full catalogue, locked and unlocked, with progress. */
  async forPlayer(userId) {
    const { rows, medalCount } = await this.#evaluate(userId, { remote: true });
    return { userId: String(userId), medalCount, completedTarget: COMPLETED_TARGET, total: rows.length, medals: rows };
  }

  /** `GET /user/profile/:userId/medals` — another player's UNLOCKED medals, no figures. */
  async forPublic(userId) {
    const { rows, medalCount } = await this.#evaluate(userId, { remote: false });
    return {
      userId: String(userId),
      medalCount,
      medals: rows
        .filter((m) => m.unlocked)
        .map(({ type, subType, key, title, unlockedAt, holders }) => ({ type, subType, key, title, unlockedAt, holders })),
    };
  }

  async #evaluate(userId, { remote }) {
    const user = await this.repo.findUser(userId);
    if (!user) throw errors.USER_NOT_FOUND({ userId: String(userId) });

    const facts = await this.#facts(userId, user, { remote });
    const nowMs = this.now();
    const results = evaluateMedals(facts, nowMs);

    const held = await this.repo.held(userId);
    const fresh = results.filter((r) => r.met && !held.has(r.medal.key));
    if (fresh.length) {
      await this.repo.unlock(userId, fresh.map((r) => ({ type: r.medal.type, subType: r.medal.subType, at: r.achievedAt ?? new Date(nowMs) })));
      this.logger?.info({ userId: String(userId), medals: fresh.map((r) => r.medal.key) }, 'medals unlocked');
    }
    const [heldNow, holders] = await Promise.all([fresh.length ? this.repo.held(userId) : held, this.repo.holderCounts()]);

    const rows = results.map((r) => toRow(r, heldNow.get(r.medal.key) ?? null, holders.get(r.medal.key) ?? 0));
    return { rows, medalCount: rows.filter((m) => m.unlocked).length };
  }

  async #facts(userId, user, { remote }) {
    const [wagerUsd, topOtherWager, chatDays, tipRecipients, raceDays, ladder, play] = await Promise.all([
      this.repo.wagerUsd(userId),
      this.repo.topOtherWager(userId),
      this.repo.chatDays(userId),
      this.repo.tipRecipients(userId),
      this.repo.dailyRaceTop3Days(userId),
      resolveVipLadder(this.models, { logger: this.logger }),
      remote ? this.#play(userId) : Promise.resolve(undefined),
    ]);
    const vip = ladder.levelFor(wagerUsd);
    return {
      createdAt: user.created ? new Date(user.created) : null,
      wagerUsd: quantise(wagerUsd),
      topOtherWager: quantise(topOtherWager),
      vipLevel: Number(vip.level ?? 0),
      vipTopLevel: Number(ladder.top?.level ?? 0),
      chatDays,
      tipRecipients,
      raceStreak: longestDayStreak(raceDays),
      /* undefined = not asked (public view); null = asked and unavailable. */
      play,
    };
  }

  /** Bets, casino net and best multiplier, or null when neither play source answered. */
  async #play(userId) {
    try {
      const s = await this.stats.forPlayer(userId);
      return {
        bets: Number(s.bets ?? 0),
        casinoNetUsd: s.casinoNetUsd == null ? null : quantise(s.casinoNetUsd),
        maxMultiplier: s.maxMultiplier == null ? null : quantise(s.maxMultiplier),
        /* A source that was down is named; its half of the figures is missing. */
        partial: Array.isArray(s.unavailable) && s.unavailable.length > 0,
        casinoDown: Array.isArray(s.unavailable) && s.unavailable.includes('casino'),
      };
    } catch (error) {
      this.logger?.warn({ err: error, userId: String(userId) }, 'medals: play totals unavailable');
      return null;
    }
  }
}

/** Longest run of consecutive UTC days in an ascending list of 'YYYY-MM-DD'. */
function longestDayStreak(days) {
  let best = 0;
  let run = 0;
  let prev = null;
  for (const day of days) {
    const t = Date.parse(`${day}T00:00:00Z`);
    run = prev !== null && t - prev === DAY_MS ? run + 1 : 1;
    if (run > best) best = run;
    prev = t;
  }
  return best;
}

/* To money's 8 places, so a comparison never throws on a longer decimal. */
const quantise = (v) => money.toDecimalString(money.toMinorQuantised(String(v ?? '0')));

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
/** Money and multipliers to two places for display; counts stay integers. */
const round2 = (v) => Math.round(num(v) * 100) / 100;

/**
 * Decide each medal against the facts. Pure, for the tests.
 *
 * @returns {Array<{medal, available, met, current, target, achievedAt?}>}
 *   `current` is null when there is no progress to show (no rule, a record
 *   medal, or a source that did not answer).
 */
function evaluateMedals(facts, nowMs) {
  return MEDALS.map((medal) => {
    const rule = medal.rule;
    if (!rule) return { medal, available: false, met: false, current: null, target: null };

    const play = facts.play;
    if (rule.source === SOURCE.REMOTE && !play) {
      return { medal, available: false, met: false, current: null, target: rule.target };
    }

    switch (rule.metric) {
      case 'chatDays':
        return measured(medal, facts.chatDays, rule.target);
      case 'tipRecipients':
        return measured(medal, facts.tipRecipients, rule.target);
      case 'dailyRaceTop3Streak':
        return measured(medal, facts.raceStreak, rule.target);
      case 'accountDays': {
        if (!facts.createdAt) return { medal, available: false, met: false, current: null, target: rule.target };
        const days = Math.max(0, Math.floor((nowMs - facts.createdAt.getTime()) / DAY_MS));
        const result = measured(medal, days, rule.target);
        /* The anniversary itself, not the day a read noticed it. */
        if (result.met) result.achievedAt = new Date(facts.createdAt.getTime() + rule.target * DAY_MS);
        return result;
      }
      case 'vipLevel': {
        const top = facts.vipTopLevel;
        if (!top) return { medal, available: false, met: false, current: null, target: null };
        return measured(medal, facts.vipLevel, top);
      }
      case 'wagerUsd':
        return { medal, available: true, met: money.gte(facts.wagerUsd, String(rule.target)), current: round2(facts.wagerUsd), target: rule.target };
      case 'wagerRecord': {
        /* Strictly above every other player, and above zero: a tie is nobody's record. */
        const met = money.gt(facts.wagerUsd, '0') && money.gt(facts.wagerUsd, facts.topOtherWager);
        return { medal, available: true, met, current: null, target: null };
      }
      case 'bets':
        if (play.partial) return { medal, available: false, met: false, current: null, target: rule.target };
        return measured(medal, play.bets, rule.target);
      case 'casinoNetUsd':
        if (play.casinoDown || play.casinoNetUsd === null) return { medal, available: false, met: false, current: null, target: rule.target };
        return { medal, available: true, met: money.gte(play.casinoNetUsd, String(rule.target)), current: Math.max(0, round2(play.casinoNetUsd)), target: rule.target };
      case 'maxMultiplier': {
        if (play.casinoDown) return { medal, available: false, met: false, current: null, target: rule.target };
        const best = play.maxMultiplier ?? '0';
        return { medal, available: true, met: money.gte(best, String(rule.target)), current: round2(best), target: rule.target };
      }
      default:
        return { medal, available: false, met: false, current: null, target: null };
    }
  });
}

function measured(medal, value, target) {
  return { medal, available: true, met: num(value) >= target, current: num(value), target };
}

/** The wire shape of one medal. */
function toRow(result, unlockedAt, holders) {
  const { medal, available, current, target } = result;
  const unlocked = unlockedAt !== null;
  return {
    type: medal.type,
    subType: medal.subType,
    key: medal.key,
    title: medal.title,
    rule: medal.rule
      ? { metric: medal.rule.metric, description: medal.rule.description, target: target ?? medal.rule.target, unit: medal.rule.unit }
      : null,
    available,
    ...(medal.rule ? {} : { unavailableReason: medal.unavailableReason }),
    unlocked,
    unlockedAt: unlocked ? new Date(unlockedAt).toISOString() : null,
    /* Clamped to the target, as the reference's detail dialog clamps it. */
    progress: current === null || !target ? null : { current: Math.min(current, target), target },
    holders,
  };
}

module.exports = { MedalsService, evaluateMedals, longestDayStreak };
