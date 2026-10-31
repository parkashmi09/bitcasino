'use strict';

/**
 * hash.game's locked deposit bonus ("Monthly Deposit Bonus" + Deposit Rakeback):
 *
 *   "Get 4 deposit bonuses every month. Each bonus is locked and unlocks as you wager."
 *   unlock per bet = wagered × house edge × 1%  ("Every wager unlocks your rakeback in real time")
 *   "Claim your unlocked rewards from the Bonus page anytime - no expiration."
 *
 * player_bonuses
 *   unlock_mode     'rollover' (the old rule: wager bonus × multiplier, then all at once) or
 *                   'gradual' (above). For 'gradual', required_wager = the bonus amount and
 *                   `wagered` is the amount UNLOCKED so far (so reversals reuse the same column).
 *   unlock_rate     fraction (0.01 = 1%) applied to wager × contribution × house edge.
 *   claimed_amount  how much of the unlocked part the player has already moved to cash.
 *
 * siteconfig.deposit_bonus_program — the site admin's choice (Welcome bonuses):
 *   mode 'first' (the first-deposit tiers, as before) or 'monthly' (the schedule below, the Nth
 *   deposit of the calendar month UTC gets schedule[N-1]); unlockMode; unlockRate (percent).
 *   Defaults to the old behaviour; the hash.game schedule is seeded ready to switch on.
 */
const PROGRAM = JSON.stringify({
  mode: 'first',
  unlockMode: 'rollover',
  unlockRate: '1',
  schedule: [
    { percent: '180', minDeposit: '5', maxBonus: '0' },
    { percent: '240', minDeposit: '10', maxBonus: '0' },
    { percent: '300', minDeposit: '20', maxBonus: '0' },
    { percent: '360', minDeposit: '30', maxBonus: '0' },
  ],
});

async function up({ sequelize, transaction }) {
  const q = (sql) => sequelize.query(sql, { transaction });
  await q("ALTER TABLE player_bonuses ADD COLUMN IF NOT EXISTS unlock_mode TEXT NOT NULL DEFAULT 'rollover'");
  await q('ALTER TABLE player_bonuses ADD COLUMN IF NOT EXISTS unlock_rate NUMERIC(10, 6)');
  await q('ALTER TABLE player_bonuses ADD COLUMN IF NOT EXISTS claimed_amount NUMERIC(30, 8) NOT NULL DEFAULT 0');
  await q(`ALTER TABLE siteconfig ADD COLUMN IF NOT EXISTS deposit_bonus_program JSONB NOT NULL DEFAULT '${PROGRAM}'::jsonb`);
}

async function down({ sequelize, transaction }) {
  const q = (sql) => sequelize.query(sql, { transaction });
  await q('ALTER TABLE siteconfig DROP COLUMN IF EXISTS deposit_bonus_program');
  await q('ALTER TABLE player_bonuses DROP COLUMN IF EXISTS claimed_amount');
  await q('ALTER TABLE player_bonuses DROP COLUMN IF EXISTS unlock_rate');
  await q('ALTER TABLE player_bonuses DROP COLUMN IF EXISTS unlock_mode');
}

module.exports = { up, down };
