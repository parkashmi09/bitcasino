'use strict';

/**
 * Wager contribution — how much of a bet counts toward unlocking a locked bonus
 * (hash.game footer "Wager Contribution for Bonus Balance Details":
 * "Wager amount = Bet Amount × Contribution Rate").
 *
 * One row per rule, most specific wins: a `game_ref` row, then a `provider` row, then a
 * `category` row. Seeded from hash.game (18 Oct 2026): each provider at the rate most of its
 * games carry, the BC Originals by game, and category defaults (sports 50% — and only at odds
 * of 1.5 or more, applied in code). Edited in the site admin. VIP, commission and rakeback count
 * the full wager; only the bonus unlock reads this.
 */
const PROVIDERS = {
  '1spin4win': 70, advantplay: 90, 'amigo gaming': 80, amusnet: 80, avatarux: 100, bgaming: 100,
  backseat: 80, belatra: 100, betsoft: 80, 'big time gaming': 80, booongo: 100, bullshark: 100,
  'caleta gaming': 100, 'clutch gaming': 100, 'croco gaming': 80, endorphina: 80, 'fa chai': 80,
  foxi: 80, 'funta gaming': 90, galaxsys: 80, habanero: 80, hacksaw: 100, 'happy duck': 100,
  inout: 100, jdb: 100, jili: 70, microgaming: 80, 'neko games': 90, netent: 80, nolimitcity: 80,
  novomatic: 100, 'nownow gaming': 100, onlyplay: 90, 'pg soft': 80, pegasus: 100,
  'penguin king': 90, platipus: 100, playngo: 100, playtech: 100,
};
const ORIGINALS = {
  bingo: 100, dice: 80, classic_dice: 80, limbo: 80, mines: 80, mine: 80, plinko: 80,
  beauties: 60, savior_sword: 60, blackjack: 50, crash: 50,
};
const CATEGORIES = { originals: 80, slots: 100, live: 10, sports: 50 };

async function up({ sequelize, transaction }) {
  const q = (sql, replacements) => sequelize.query(sql, { transaction, replacements });
  await q(`CREATE TABLE IF NOT EXISTS wager_contribution (
    id         SERIAL PRIMARY KEY,
    category   TEXT,
    provider   TEXT,
    game_ref   TEXT,
    percent    NUMERIC(5, 2) NOT NULL CHECK (percent >= 0 AND percent <= 100),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (num_nonnulls(category, provider, game_ref) = 1)
  )`);
  await q(`CREATE UNIQUE INDEX IF NOT EXISTS uq_wager_contribution_rule
             ON wager_contribution (COALESCE(category, ''), COALESCE(provider, ''), COALESCE(game_ref, ''))`);
  const [[{ n }]] = await q('SELECT COUNT(*)::int AS n FROM wager_contribution');
  if (n > 0) return; // an admin's edits survive a re-run
  for (const [category, percent] of Object.entries(CATEGORIES)) {
    await q('INSERT INTO wager_contribution (category, percent) VALUES (:category, :percent)', { category, percent });
  }
  for (const [provider, percent] of Object.entries(PROVIDERS)) {
    await q('INSERT INTO wager_contribution (provider, percent) VALUES (:provider, :percent)', { provider, percent });
  }
  for (const [gameRef, percent] of Object.entries(ORIGINALS)) {
    await q('INSERT INTO wager_contribution (game_ref, percent) VALUES (:gameRef, :percent)', { gameRef, percent });
  }
}

async function down({ sequelize, transaction }) {
  await sequelize.query('DROP TABLE IF EXISTS wager_contribution', { transaction });
}

module.exports = { up, down };
