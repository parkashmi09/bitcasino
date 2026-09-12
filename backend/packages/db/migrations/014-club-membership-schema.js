'use strict';

/**
 * `club_memberships` and `club_earnings_log` — RECONSTRUCTED.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE CLUB FEATURE COULD NOT WORK
 *
 * `legacy/clubmembership/` is mounted (`server.use('/clubmembership', …)`) and
 * its controller references `club_memberships` fourteen times and
 * `club_earnings_log` once. Neither table exists. The database has exactly
 * three club tables:
 *
 *     clubs                          club_hierarchy                          club_earnings_configurations
 *
 * So every endpoint that touches membership — joining a club, changing a role,
 * counting members, deleting a club, listing memberships — has been failing
 * with "relation does not exist" on every call since it was deployed. This is
 * the same finding as the fiat deposits: live routes, live clients, and a table
 * that was never created.
 *
 * ── WHAT THE SHAPE COMES FROM ────────────────────────────────────────────
 * Every column below is named by a legacy query. Nothing is invented:
 *
 *   INSERT INTO club_memberships (user_id, club_id, role, unique_agent_code, joined_at)
 *   INSERT INTO club_memberships (user_id, club_id, role, agent_id, parent_club_id, joined_at)
 *   SELECT ... WHERE club_id = $1 AND role != 'owner'
 *   SELECT ... WHERE cm.unique_agent_code = $1 AND cm.role = 'agent'
 *   UPDATE club_memberships SET role = ...
 *   DELETE FROM club_memberships WHERE club_id = $1
 *
 * Two INSERTs with different column lists is why `unique_agent_code`,
 * `agent_id` and `parent_club_id` are all nullable — the owner path sets one,
 * the member path sets the others.
 *
 * `club_earnings_log` is referenced only by the generic table-fetch endpoint,
 * which tells us it has a `club_id` and nothing else. The rest of its shape is
 * inferred from `club_earnings_configurations` (the percentages it must be
 * applying) and is the weakest guesswork in this migration — treat it as a
 * starting point, not as settled.
 * ─────────────────────────────────────────────────────────────────────────
 */

async function up({ sequelize, transaction, logger }) {
  await sequelize.query(
    `CREATE TABLE IF NOT EXISTS club_memberships (
       id              BIGSERIAL PRIMARY KEY,
       user_id         BIGINT       NOT NULL,
       club_id         BIGINT       NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,

       -- owner | agent | member. Not an enum: the legacy code compares it as
       -- text in several places and an enum would make those comparisons fail
       -- during a cutover.
       role            VARCHAR(20)  NOT NULL DEFAULT 'member',

       -- An agent's own referral code, set on the agent/owner path only.
       unique_agent_code VARCHAR(50),

       -- Which agent recruited this member, and which club they sit under.
       -- Both null for an owner, who was recruited by nobody.
       agent_id        BIGINT,
       parent_club_id  BIGINT REFERENCES clubs(id) ON DELETE SET NULL,

       joined_at       TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
       created_at      TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
       updated_at      TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP
     )`,
    { transaction }
  );

  /**
   * ONE membership per player.
   *
   * The legacy join checked `SELECT * FROM club_memberships WHERE user_id AND
   * club_id` and refused a duplicate — but only for the SAME club, and only
   * with a check that a concurrent request could slip past. A player in two
   * clubs would earn commission for two owners on the same wagering, so the
   * constraint is on `user_id` alone.
   */
  await sequelize.query(
    'CREATE UNIQUE INDEX IF NOT EXISTS uq_club_memberships_user ON club_memberships (user_id)',
    { transaction }
  );

  // An agent code identifies exactly one agent, or "find the agent by code"
  // has no answer.
  await sequelize.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_club_memberships_agent_code
       ON club_memberships (unique_agent_code) WHERE unique_agent_code IS NOT NULL`,
    { transaction }
  );

  for (const sql of [
    'CREATE INDEX IF NOT EXISTS idx_club_memberships_club ON club_memberships (club_id, role)',
    'CREATE INDEX IF NOT EXISTS idx_club_memberships_agent ON club_memberships (agent_id)',
  ]) {
    await sequelize.query(sql, { transaction });
  }

  // ── club_earnings_log ────────────────────────────────────────────────
  await sequelize.query(
    `CREATE TABLE IF NOT EXISTS club_earnings_log (
       id              BIGSERIAL PRIMARY KEY,
       club_id         BIGINT       NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,

       -- Who earned it, and from whose play.
       beneficiary_id  BIGINT       NOT NULL,
       source_user_id  BIGINT,
       -- owner | agent | member, matching the percentage that produced it.
       beneficiary_role VARCHAR(20) NOT NULL,

       -- NUMERIC, not float. Every money column on this platform that was
       -- created as a float has since had to be corrected.
       wager_amount    NUMERIC(30,8) NOT NULL DEFAULT 0,
       percentage      NUMERIC(5,2)  NOT NULL DEFAULT 0,
       amount          NUMERIC(30,8) NOT NULL DEFAULT 0,
       currency        VARCHAR(10)   NOT NULL DEFAULT 'BJB',

       -- The period this line covers, so a rerun can be recognised.
       period_start    TIMESTAMPTZ,
       period_end      TIMESTAMPTZ,

       paid            BOOLEAN      NOT NULL DEFAULT FALSE,
       paid_at         TIMESTAMPTZ,

       created_at      TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP
     )`,
    { transaction }
  );

  for (const sql of [
    'CREATE INDEX IF NOT EXISTS idx_club_earnings_club ON club_earnings_log (club_id, created_at DESC)',
    'CREATE INDEX IF NOT EXISTS idx_club_earnings_beneficiary ON club_earnings_log (beneficiary_id, paid)',
  ]) {
    await sequelize.query(sql, { transaction });
  }

  logger?.warn(
    'Created club_memberships and club_earnings_log — RECONSTRUCTED from legacy queries. ' +
      'These tables never existed, so every club membership endpoint has been erroring in production.'
  );
}

async function down({ sequelize, transaction, logger }) {
  if (process.env.ALLOW_DESTRUCTIVE_MIGRATION !== 'true') {
    throw new Error(
      'Dropping club_memberships destroys every club membership and the earnings derived from them. ' +
        'Re-run with ALLOW_DESTRUCTIVE_MIGRATION=true if that is really intended.'
    );
  }
  await sequelize.query('DROP TABLE IF EXISTS club_earnings_log', { transaction });
  await sequelize.query('DROP TABLE IF EXISTS club_memberships', { transaction });
  logger?.warn('Dropped the club membership tables');
}

module.exports = { up, down };
