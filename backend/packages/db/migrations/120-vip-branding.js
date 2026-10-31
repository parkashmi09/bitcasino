'use strict';

/**
 * VIP branding — what each level is CALLED and what each card's badge LOOKS like, set by the
 * site admin (VIP Club → Ladder). Display only: bands, thresholds, cards and reward keys stay in
 * code (`packages/common/src/vipLevels.js`), so a rename never moves a player or re-pays a reward.
 * `resolveVipLadder` lays these over the ladder for every reader.
 *
 * Names are seeded from the reference site's ladder (hash.game Rate & Rules, captured in
 * `frontend/src/data/vipConfig.js`: Beginner, Bronze I–IV, Silver I–IV, Gold I–IV, Platinum I–IV,
 * Diamond I–VII, Eternal I–X) level for level; our ladder is longer (L0–L41), so the levels past
 * the reference's last (L33 Eternal X) continue as Eternal XI–XVIII. Only missing rows are
 * inserted, so an admin's renames survive a re-run. Idempotent.
 */
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII'];
const tier = (name, count) => ROMAN.slice(0, count).map((r) => `${name} ${r}`);
const NAMES = ['Beginner', ...tier('Bronze', 4), ...tier('Silver', 4), ...tier('Gold', 4), ...tier('Platinum', 4), ...tier('Diamond', 7), ...tier('Eternal', 18)];

async function up({ sequelize, transaction }) {
  await sequelize.query(
    `CREATE TABLE IF NOT EXISTS vip_level_names (
       level      INT PRIMARY KEY,
       name       TEXT NOT NULL,
       updated_by INT,
       updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
    { transaction }
  );
  await sequelize.query(
    `CREATE TABLE IF NOT EXISTS vip_badges (
       card         TEXT PRIMARY KEY,
       image_data   BYTEA NOT NULL,
       content_type TEXT NOT NULL,
       byte_size    INT NOT NULL,
       version      TEXT NOT NULL,
       updated_by   INT,
       updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
    { transaction }
  );
  for (const [level, name] of NAMES.entries()) {
    await sequelize.query('INSERT INTO vip_level_names (level, name) VALUES (:level, :name) ON CONFLICT (level) DO NOTHING', {
      replacements: { level, name },
      transaction,
    });
  }
}

async function down({ sequelize, transaction }) {
  await sequelize.query('DROP TABLE IF EXISTS vip_badges', { transaction });
  await sequelize.query('DROP TABLE IF EXISTS vip_level_names', { transaction });
}

module.exports = { up, down, NAMES };
