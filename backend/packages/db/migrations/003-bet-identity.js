'use strict';

/**
 * Give `bets` a real identity column.
 *
 * The baseline defines `bets.id BIGINT` with no sequence and no primary key —
 * the legacy app generated ids in JavaScript. That is a problem for two
 * reasons: two application processes can generate the same id, and without a
 * primary key nothing stops a duplicate from being inserted.
 *
 * This attaches a sequence, backfills any existing rows, and adds the primary
 * key. Every step is conditional, so the migration is safe on a database where
 * some of it was already done by hand.
 */

async function up({ sequelize, transaction, logger }) {
  const { QueryTypes } = require('sequelize');

  // ── 1. Sequence ──────────────────────────────────────────────────────
  await sequelize.query('CREATE SEQUENCE IF NOT EXISTS bets_id_seq', { transaction });

  // ── 2. Backfill rows that never got an id ────────────────────────────
  const [{ missing }] = await sequelize.query(
    'SELECT COUNT(*)::int AS missing FROM bets WHERE id IS NULL',
    { type: QueryTypes.SELECT, transaction }
  );

  if (missing > 0) {
    logger?.warn(`Backfilling ${missing} bets row(s) with a null id`);
    await sequelize.query("UPDATE bets SET id = nextval('bets_id_seq') WHERE id IS NULL", { transaction });
  }

  // ── 3. Duplicates would make the primary key impossible ──────────────
  const duplicates = await sequelize.query(
    'SELECT id, COUNT(*)::int AS count FROM bets GROUP BY id HAVING COUNT(*) > 1 LIMIT 5',
    { type: QueryTypes.SELECT, transaction }
  );

  if (duplicates.length) {
    throw new Error(
      `Cannot add a primary key: bets contains duplicate ids (e.g. ${duplicates
        .map((d) => `${d.id} x${d.count}`)
        .join(', ')}). Resolve these before migrating.`
    );
  }

  // ── 4. Push the sequence past every id already in use ────────────────
  await sequelize.query(
    "SELECT setval('bets_id_seq', GREATEST((SELECT COALESCE(MAX(id), 0) FROM bets), 1))",
    { transaction }
  );

  // ── 5. Wire the default and ownership ────────────────────────────────
  await sequelize.query("ALTER TABLE bets ALTER COLUMN id SET DEFAULT nextval('bets_id_seq')", { transaction });
  await sequelize.query('ALTER TABLE bets ALTER COLUMN id SET NOT NULL', { transaction });
  // Ownership means dropping the table drops the sequence with it.
  await sequelize.query('ALTER SEQUENCE bets_id_seq OWNED BY bets.id', { transaction });

  // ── 6. Primary key ───────────────────────────────────────────────────
  const [existingPk] = await sequelize.query(
    `SELECT conname FROM pg_constraint
      WHERE conrelid = 'bets'::regclass AND contype = 'p'
      LIMIT 1`,
    { type: QueryTypes.SELECT, transaction }
  );

  if (!existingPk) {
    await sequelize.query('ALTER TABLE bets ADD CONSTRAINT bets_pkey PRIMARY KEY (id)', { transaction });
    logger?.info('Added primary key bets_pkey');
  }

  // ── 7. Indexes the casino service reads on every request ─────────────
  // "my recent bets" and "settle this round" are the two hot paths.
  await sequelize.query('CREATE INDEX IF NOT EXISTS idx_bets_uid_created ON bets (uid, created DESC)', { transaction });
  await sequelize.query('CREATE INDEX IF NOT EXISTS idx_bets_gid ON bets (gid)', { transaction });
  await sequelize.query('CREATE INDEX IF NOT EXISTS idx_bets_game ON bets (game)', { transaction });

  // Provably-fair verification looks a bet up by its hash; a duplicate hash
  // would make that ambiguous, so the index is unique.
  await sequelize.query(
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_bets_hash ON bets (hash) WHERE hash IS NOT NULL',
    { transaction }
  );

  logger?.info('bets identity and indexes are in place');
}

async function down({ sequelize, transaction }) {
  await sequelize.query('DROP INDEX IF EXISTS idx_bets_hash', { transaction });
  await sequelize.query('DROP INDEX IF EXISTS idx_bets_game', { transaction });
  await sequelize.query('DROP INDEX IF EXISTS idx_bets_gid', { transaction });
  await sequelize.query('DROP INDEX IF EXISTS idx_bets_uid_created', { transaction });
  await sequelize.query('ALTER TABLE bets DROP CONSTRAINT IF EXISTS bets_pkey', { transaction });
  await sequelize.query('ALTER TABLE bets ALTER COLUMN id DROP DEFAULT', { transaction });
  await sequelize.query('DROP SEQUENCE IF EXISTS bets_id_seq', { transaction });
}

module.exports = { up, down };
