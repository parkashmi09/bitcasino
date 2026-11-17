'use strict';

/**
 * Whitelabel code updates (user, 2026-11-15): a copy is built from `git archive HEAD` of this
 * site, and until now only a delete + create brought it new code. The setup script now also runs
 * `update` jobs — new code, packages, migrations, builds and a restart, keeping the copy's
 * database, env files and ports — and queues one by itself for every live copy whose
 * `code_commit` is not this site's HEAD (scripts/whitelabel/worker.mjs).
 *
 *   whitelabels.code_commit   the commit the copy runs (NULL = built before this; updated once)
 *   whitelabel_jobs.commit    the commit an update job is for, so a failed one is not retried in a loop
 */
async function up({ sequelize, transaction }) {
  await sequelize.query('ALTER TABLE whitelabel_jobs DROP CONSTRAINT IF EXISTS whitelabel_jobs_kind_check', { transaction });
  await sequelize.query(
    "ALTER TABLE whitelabel_jobs ADD CONSTRAINT whitelabel_jobs_kind_check CHECK (kind IN ('create', 'delete', 'update'))",
    { transaction }
  );
  await sequelize.query('ALTER TABLE whitelabel_jobs ADD COLUMN IF NOT EXISTS commit VARCHAR(40)', { transaction });
  await sequelize.query('ALTER TABLE whitelabels ADD COLUMN IF NOT EXISTS code_commit VARCHAR(40)', { transaction });
}

async function down({ sequelize, transaction }) {
  await sequelize.query("DELETE FROM whitelabel_jobs WHERE kind = 'update'", { transaction });
  await sequelize.query('ALTER TABLE whitelabel_jobs DROP CONSTRAINT IF EXISTS whitelabel_jobs_kind_check', { transaction });
  await sequelize.query(
    "ALTER TABLE whitelabel_jobs ADD CONSTRAINT whitelabel_jobs_kind_check CHECK (kind IN ('create', 'delete'))",
    { transaction }
  );
  await sequelize.query('ALTER TABLE whitelabel_jobs DROP COLUMN IF EXISTS commit', { transaction });
  await sequelize.query('ALTER TABLE whitelabels DROP COLUMN IF EXISTS code_commit', { transaction });
}

module.exports = { up, down };
