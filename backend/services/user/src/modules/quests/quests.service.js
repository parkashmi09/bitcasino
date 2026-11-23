'use strict';

const { money, operatorSettings } = require('@ibitplay/common');
const { promotionsBlocked } = require('@ibitplay/auth');

const errors = require('./quests.errors');
const { RaceService } = require('../race/race.service');
const { createRewardMoney } = require('../../lib/rewardMoney');
const { PlayerBonusService } = require('../player-bonuses/playerBonus.service');
const { SOURCE } = require('../player-bonuses/playerBonus.constants');

/* shortcut: fixed targets — add a quest config table when the owner wants to set targets.
   Wager in USD (the board's unit). Rewards are the Super Admin's settings (`rewardSetting`,
   site admin → Site config), in USD, paid in the reward currency. */
const DAILY_QUESTS = [
  { key: 'dailyWager', title: 'Daily Wager', description: 'Wager today to complete', unit: 'usd', target: '50', rewardSetting: 'quest_daily_wager_reward' },
  { key: 'dailyBets', title: 'Daily Bets', description: 'Place bets today to complete', unit: 'count', target: '20', rewardSetting: 'quest_daily_bets_reward' },
];

/** Once per quest, player and day: the day is the daily race's window, named by its end. */
const grantKeyOf = (key, userId, endsAt) => `quest:${key}:${userId}:${new Date(endsAt).toISOString()}`;

class QuestsService {
  constructor(deps) {
    this.deps = deps;
    this.db = deps.db;
    this.models = deps.models;
    this.logger = deps.logger;
    this.race = deps.race ?? new RaceService(deps);
    this.settings = deps.operatorSettings ?? operatorSettings(deps);
    this.rewardMoney = deps.rewardMoney ?? createRewardMoney(deps);
    this.promotionsBlocked = deps.promotionsBlocked ?? promotionsBlocked;
    this.playerBonuses = deps.playerBonuses ?? null;
  }

  /** Today's quests with the caller's progress, reward (USD) and whether today's reward was claimed. */
  async forPlayer(userId) {
    const board = await this.#board(userId);
    const keys = board.endsAt ? DAILY_QUESTS.map((q) => grantKeyOf(q.key, userId, board.endsAt)) : [];
    const [rewards, claimedRows] = await Promise.all([
      Promise.all(DAILY_QUESTS.map((q) => this.#rewardUsd(q))),
      keys.length && this.models?.PlayerBonus
        ? this.models.PlayerBonus.findAll({ where: { grant_key: keys }, attributes: ['grant_key'], raw: true })
        : [],
    ]);
    const claimed = new Set(claimedRows.map((r) => r.grant_key));
    return {
      dailyQuest: {
        second: 'dailyquest',
        first: {
          endsAt: board.endsAt,
          quests: DAILY_QUESTS.map(({ rewardSetting, ...q }, i) => ({
            ...q,
            progress: board.done[q.unit],
            completed: !money.lt(board.done[q.unit], q.target),
            rewardUsd: rewards[i],
            claimed: claimed.has(keys[i]),
          })),
        },
      },
    };
  }

  /**
   * Pay a completed quest's reward, once per day. The grant key (unique on `player_bonuses` and
   * the ledger's idempotency key) makes it exactly-once; the advisory lock makes a concurrent
   * second claim wait and then see the first, rather than race it.
   */
  async claim(userId, key) {
    const quest = DAILY_QUESTS.find((q) => q.key === key);
    if (!quest) throw errors.NOT_FOUND({ key });
    if (await this.promotionsBlocked(userId)) throw errors.NOT_ELIGIBLE();

    const rewardUsd = await this.#rewardUsd(quest);
    if (!money.gt(rewardUsd, '0')) throw errors.NO_REWARD({ key });

    const board = await this.#board(userId);
    const progress = board.done[quest.unit];
    if (!board.endsAt || money.lt(progress, quest.target)) throw errors.NOT_COMPLETED({ key, progress, target: quest.target });

    const grantKey = grantKeyOf(key, userId, board.endsAt);
    const { currency, amount } = await this.rewardMoney.fromUsd(rewardUsd);
    const result = await this.db.transaction(async (transaction) => {
      await this.db.sequelize.query('SELECT pg_advisory_xact_lock(hashtext(:grantKey))', { replacements: { grantKey }, transaction });
      return this.#bonuses().grant(
        {
          userId,
          source: SOURCE.QUEST,
          grantKey,
          ref: grantKey,
          currency,
          amount,
          wagerMultiplier: 0, // cash at once, through the wallet's credit (reason BONUS, ref QUEST_REWARD)
          description: `Quest reward: ${quest.title}`,
        },
        { transaction }
      );
    });
    if (!result.paid) {
      if (result.reason === 'ALREADY_PAID') throw errors.ALREADY_CLAIMED({ key });
      throw errors.NOT_ELIGIBLE({ reason: result.reason });
    }
    this.logger?.info({ userId: String(userId), key, rewardUsd, amount: result.amount, currency: result.currency }, 'Quest reward claimed');
    return { key, claimed: true, rewardUsd, amount: result.amount, currency: result.currency, endsAt: board.endsAt };
  }

  async #board(userId) {
    const board = await this.race.leaderboard({ type: 'daily', userId, live: true });
    return { endsAt: board.endsAt, done: { usd: board.me?.usdWagered ?? '0', count: String(board.me?.bets ?? 0) } };
  }

  /** The Super Admin's reward for `quest`, a USD decimal string; '0' when unset or unreadable. */
  async #rewardUsd(quest) {
    const value = String(await this.settings.read(quest.rewardSetting, '0'));
    return /^\d+(\.\d+)?$/.test(value) ? money.toDecimalString(money.toMinor(value)) : '0';
  }

  /** Built on first claim: the read path does not need the wallet. */
  #bonuses() {
    this.playerBonuses ??= new PlayerBonusService({ ...this.deps, rewardMoney: this.rewardMoney });
    return this.playerBonuses;
  }
}

module.exports = { QuestsService, DAILY_QUESTS, grantKeyOf };
