'use strict';

const crypto = require('node:crypto');

/**
 * `branches.referral_code` — a branch's own sign-up code (user, 2026-11-24).
 *
 * The branch panel shows `${PUBLIC_SITE_URL}/referal/<code>`. A visitor who signs up on the site
 * with that link or code becomes this branch's player (`users.branch_id`), a direct user exactly
 * as one the branch creates itself; no player is the referrer. Any other code is a player's, as
 * before. The code is the branch's login name in capitals plus four digits, never one a player
 * holds as a code or a username (user-service `resolveBranchByCode` reads it first).
 *
 * Every existing branch gets one here; new ones get theirs on creation (admin `branches`).
 */
async function up({ sequelize, transaction, logger }) {
  await sequelize.query('ALTER TABLE branches ADD COLUMN IF NOT EXISTS referral_code VARCHAR(24)', { transaction });
  await sequelize.query(
    'CREATE UNIQUE INDEX IF NOT EXISTS branches_referral_code_upper ON branches (UPPER(referral_code)) WHERE referral_code IS NOT NULL',
    { transaction }
  );

  const [branches] = await sequelize.query('SELECT id, username FROM branches WHERE referral_code IS NULL ORDER BY id', { transaction });
  for (const branch of branches) {
    const base = String(branch.username).replace(/[^A-Za-z0-9]/g, '').slice(0, 12).toUpperCase() || 'BRANCH';
    let code = null;
    for (let attempt = 0; attempt < 20 && !code; attempt += 1) {
      const candidate = `${base}${crypto.randomInt(1000, 10000)}`;
      const [taken] = await sequelize.query(
        `SELECT 1 FROM branches WHERE UPPER(referral_code) = :code
         UNION ALL SELECT 1 FROM users WHERE UPPER(referalcode) = :code OR UPPER(name) = :code LIMIT 1`,
        { replacements: { code: candidate }, transaction }
      );
      if (!taken.length) code = candidate;
    }
    if (!code) throw new Error(`could not allocate a referral code for branch ${branch.id}`);
    await sequelize.query('UPDATE branches SET referral_code = :code WHERE id = :id', { replacements: { code, id: branch.id }, transaction });
  }
  logger?.info({ branches: branches.length }, 'Added branches.referral_code');
}

async function down({ sequelize, transaction }) {
  await sequelize.query('DROP INDEX IF EXISTS branches_referral_code_upper', { transaction });
  await sequelize.query('ALTER TABLE branches DROP COLUMN IF EXISTS referral_code', { transaction });
}

module.exports = { up, down };
