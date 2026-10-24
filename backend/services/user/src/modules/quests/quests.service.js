'use strict';

const { money } = require('@ibitplay/common');
const { RaceService } = require('../race/race.service');

/* shortcut: fixed targets, no admin config and no reward — add a quest config table when the
   owner wants to set targets or pay for them. Wager in USD (the board's unit). */
const DAILY_QUESTS = [
  { key: 'dailyWager', title: 'Daily Wager', description: 'Wager today to complete', unit: 'usd', target: '50' },
  { key: 'dailyBets', title: 'Daily Bets', description: 'Place bets today to complete', unit: 'count', target: '20' },
];

class QuestsService {
  constructor(deps) {
    this.race = deps.race ?? new RaceService(deps);
  }

  /** Today's quests with the caller's progress, and when today ends. */
  async forPlayer(userId) {
    const board = await this.race.leaderboard({ type: 'daily', userId, live: true });
    const done = { usd: board.me?.usdWagered ?? '0', count: String(board.me?.bets ?? 0) };
    return {
      dailyQuest: {
        second: 'dailyquest',
        first: {
          endsAt: board.endsAt,
          quests: DAILY_QUESTS.map((q) => ({
            ...q,
            progress: done[q.unit],
            completed: !money.lt(done[q.unit], q.target),
          })),
        },
      },
    };
  }
}

module.exports = { QuestsService, DAILY_QUESTS };
