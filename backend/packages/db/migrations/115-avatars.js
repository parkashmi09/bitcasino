'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

/**
 * Avatars a player may pick, each unlocked from a VIP level — Admin → Avatars uploads them and
 * sets the level; the player site's Edit Avatar grid lists them (`GET /admin/avatars/public`)
 * and `POST /user/profile/avatar` refuses one above the player's computed VIP level.
 *
 * The bytes live in the row, as banners do (migration 027): local disk is not shared between
 * replicas. `version` is a short sha256 of the bytes, the `?v=` that makes an image URL
 * immutable.
 *
 * Seeded with the reference site's twelve default heads (packages/db/assets/avatars/head1..12),
 * only into an empty table so a re-run never brings back one an operator deleted. Levels on the
 * platform ladder (0 = Unranked, 1 = Bronze 1, …): head1–4 → 0, head5–6 → 1, head7–8 → 2,
 * head9–10 → 3, head11 → 4, head12 → 5.
 */
const SEED_LEVELS = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 5];
const ASSETS = path.join(__dirname, '..', 'assets', 'avatars');

async function up({ sequelize, transaction }) {
  await sequelize.query(
    `CREATE TABLE IF NOT EXISTS avatars (
       id            SERIAL PRIMARY KEY,
       image_data    BYTEA NOT NULL,
       content_type  TEXT NOT NULL,
       byte_size     INT NOT NULL,
       version       TEXT NOT NULL,
       min_level     INT NOT NULL DEFAULT 0,
       sort          INT NOT NULL DEFAULT 0,
       enabled       BOOLEAN NOT NULL DEFAULT true,
       created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
       updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
       updated_by    INT NULL
     )`,
    { transaction }
  );
  await sequelize.query('CREATE INDEX IF NOT EXISTS avatars_sort_idx ON avatars (sort, id)', { transaction });

  const [[{ n }]] = await sequelize.query('SELECT COUNT(*)::int AS n FROM avatars', { transaction });
  if (n > 0) return;

  for (let i = 0; i < SEED_LEVELS.length; i += 1) {
    const file = path.join(ASSETS, `head${i + 1}.png`);
    if (!fs.existsSync(file)) continue;
    const data = fs.readFileSync(file);
    const version = crypto.createHash('sha256').update(data).digest('hex').slice(0, 12);
    await sequelize.query(
      `INSERT INTO avatars (image_data, content_type, byte_size, version, min_level, sort)
       VALUES (:data, 'image/png', :size, :version, :level, :sort)`,
      { transaction, replacements: { data, size: data.length, version, level: SEED_LEVELS[i], sort: i + 1 } }
    );
  }
}

async function down({ sequelize, transaction }) {
  await sequelize.query('DROP TABLE IF EXISTS avatars', { transaction });
}

module.exports = { up, down };
