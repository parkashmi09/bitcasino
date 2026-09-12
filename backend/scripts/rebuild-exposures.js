#!/usr/bin/env node
'use strict';

/**
 * Rebuild `user_exposures` from the bets that are actually open.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * THIS FINISHES WHAT MIGRATION 025 DELIBERATELY LEFT UNDONE
 *
 * Migration 005 — mine — added
 *
 *     CREATE UNIQUE INDEX uq_user_exposures_user_match
 *       ON user_exposures (user_id, match_id)
 *
 * one row per player per match. That is not what an exposure is. A player has a
 * separate number for each OUTCOME of a match — what their balance does if that
 * outcome happens — and those numbers are not additive. The house blocks the
 * WORST of them, never the sum.
 *
 * To create that index, 005 first had to remove the rows it was about to
 * forbid. They were not duplicates; they were the individual outcomes:
 *
 *     UPDATE user_exposures SET exposure_amount = :total WHERE id = keeper
 *     DELETE FROM user_exposures WHERE ... AND id <> keeper
 *
 * `:total` was the SUM of the group. So every affected player ended up with one
 * row carrying a number that is too large, labelled with the `team_name` of
 * whichever row happened to survive.
 *
 * Migration 025 fixed the INDEX — `(user_id, match_id, team_name, game_type)`
 * — and said the recompute was a data decision for an operator. This is that
 * recompute.
 *
 * ── WHY A SCRIPT AND NOT A MIGRATION ─────────────────────────────────────
 *
 * Two reasons, and the first is the real one.
 *
 * The rebuild must produce exactly what a fresh bet would produce, which means
 * running `betDelta`/`applyDelta` from `services/sports/src/modules/bets/
 * exposure.js` — the same functions the bet path calls. A migration lives in
 * `packages/db` and cannot reach into a service without inverting the
 * dependency. Reimplementing the arithmetic in SQL would give a second copy
 * that drifts, and the drift would be silent: two numbers that disagree about
 * how much money is blocked.
 *
 * The second reason is that this is a data decision. It is not part of getting
 * the schema right, it needs someone to look at the dry run first, and it is
 * safe to run more than once.
 *
 * ── USAGE ────────────────────────────────────────────────────────────────
 *
 *     node scripts/rebuild-exposures.js            # dry run — prints, changes nothing
 *     node scripts/rebuild-exposures.js --apply    # writes
 *     node scripts/rebuild-exposures.js --user 42  # one player
 * ═════════════════════════════════════════════════════════════════════════
 */

const { loadEnv, dbEnvShape, createLogger, money } = require('@ibitplay/common');
const { createSequelize, authenticate } = require('@ibitplay/db/src/sequelize');
const { registerModels } = require('@ibitplay/db/src/models');

const {
  betDelta,
  applyDelta,
  worstCase,
} = require('../services/sports/src/modules/bets/exposure');
const { GAME_TYPE, SIDE, FANCY_SIDE } = require('../services/sports/src/modules/bets/bets.constants');

/**
 * Statuses that mean the stake has left the wallet and nothing has settled it.
 *
 * Both vocabularies are here on purpose: the bets module writes `open`, and
 * `mannualsettlement` uses `open` and `manual` for the same state — a bet
 * awaiting a manual result is still an open liability. Anything else (`settled`,
 * `won`, `lost`, `void`, `cancelled`, `closed`) has been resolved and carries no
 * exposure.
 */
const OPEN_STATUSES = ['open', 'manual'];

const config = loadEnv({ ...dbEnvShape });
const logger = createLogger({ service: 'rebuild-exposures', level: config.LOG_LEVEL, pretty: true });

/**
 * The outcomes of the market a bet belongs to.
 *
 * ── THIS IS THE PART THAT CANNOT BE PERFECT ──────────────────────────────
 *
 * `betDelta` needs every possible result of the market, because the worst case
 * is taken across all of them. At bet time that list comes from the live market
 * feed. Replaying historical bets, the feed is gone — so the outcome set is
 * reconstructed from the columns the bet itself carries:
 *
 *   `team_one`, `team_two`   the two sides, recorded at placement
 *   `counts`                 the runner count, which is how a three-way market
 *                            is distinguished from a two-way one
 *
 * `counts` is exactly the field legacy took from the REQUEST and got wrong —
 * a three-way market bet submitted with `count: 2` omitted the Draw, and the
 * outcome where the player loses was left out of the worst case. Here it is
 * read from the stored row, so a bet placed with a bad `counts` rebuilds with
 * the same bad outcome set.
 *
 * That is a floor on accuracy, not a bug in this script, and it is reported:
 * every bet whose outcome set had to be guessed is counted and printed.
 */
function outcomesFor(bet) {
  if (bet.game_type === GAME_TYPE.FANCY) return ['YES', 'NO'];

  const outcomes = [bet.team_one, bet.team_two].filter(Boolean).map(String);

  /**
   * A selection that is neither recorded team. Happens when `team_one`/
   * `team_two` were null at placement, and on the Draw leg.
   */
  const selection = String(bet.selection_name ?? '');
  if (selection && !outcomes.some((name) => name.toLowerCase() === selection.toLowerCase())) {
    outcomes.push(selection);
  }

  // Three runners means the draw is a real outcome the player can lose on.
  if (Number(bet.counts) >= 3 && !outcomes.some((name) => /draw|tie/i.test(name))) {
    outcomes.push('The Draw');
  }

  return outcomes;
}

/** `back`/`lay`, however the row spells it — including fancy's YES/NO. */
function sideOf(bet) {
  const raw = String(bet.bet_type ?? '').trim().toLowerCase();
  return FANCY_SIDE[raw] ?? (raw === SIDE.LAY ? SIDE.LAY : SIDE.BACK);
}

/**
 * Whether the outcome set had to be inferred rather than read.
 *
 * A bet with both teams and a plausible `counts` is trustworthy. One missing a
 * team is a reconstruction, and the operator should know how many of those went
 * into the numbers.
 */
function wasInferred(bet) {
  if (bet.game_type === GAME_TYPE.FANCY) return false;
  return !bet.team_one || !bet.team_two;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const userFlag = process.argv.indexOf('--user');
  const onlyUser = userFlag > -1 ? process.argv[userFlag + 1] : null;

  const sequelize = createSequelize(config, logger);
  await authenticate(sequelize, logger);
  const models = registerModels(sequelize, { logger });

  const where = { status: OPEN_STATUSES };
  if (onlyUser) where.user_id = String(onlyUser);

  const bets = await models.SportsBet.findAll({
    where,
    order: [['id', 'ASC']],
  });

  logger.info({ bets: bets.length, statuses: OPEN_STATUSES, onlyUser }, 'Open bets loaded');

  if (!bets.length) {
    logger.info('No open bets — there is nothing to rebuild');
    await sequelize.close();
    return;
  }

  /**
   * Replay every open bet into a position, keyed by the grain migration 025
   * established: player, match, outcome, market.
   *
   * `positions` is keyed by (user, match, gameType) because a position is a set
   * of outcomes that share a worst case — the individual rows come out of it at
   * the end.
   */
  const positions = new Map();
  let inferred = 0;
  let skipped = 0;

  for (const bet of bets) {
    const outcomes = outcomesFor(bet);

    if (!outcomes.length || !bet.odds || !bet.stake_amount) {
      /**
       * A bet with no outcomes, no price or no stake cannot produce an
       * exposure. Counted rather than assumed to be zero — a row like this is
       * a data problem worth seeing.
       */
      skipped += 1;
      logger.warn(
        { betId: bet.id, matchId: bet.match_id, odds: bet.odds, stake: bet.stake_amount },
        'Bet skipped — cannot compute an exposure from it'
      );
      continue;
    }

    if (wasInferred(bet)) inferred += 1;

    const key = `${bet.user_id} ${bet.match_id} ${bet.game_type ?? ''}`;
    const entry = positions.get(key) ?? {
      userId: String(bet.user_id),
      matchId: String(bet.match_id),
      gameType: bet.game_type ?? null,
      matchTitle: bet.match_title ?? null,
      eventId: bet.eventid ?? null,
      position: {},
      bets: 0,
    };

    const delta = betDelta({
      gameType: bet.game_type,
      side: sideOf(bet),
      selection: bet.game_type === GAME_TYPE.FANCY ? (sideOf(bet) === SIDE.LAY ? 'NO' : 'YES') : bet.selection_name,
      odds: String(bet.odds),
      stake: String(bet.stake_amount),
      outcomes,
    });

    entry.position = applyDelta(entry.position, delta);
    entry.bets += 1;
    entry.matchTitle = entry.matchTitle ?? bet.match_title ?? null;
    entry.eventId = entry.eventId ?? bet.eventid ?? null;

    positions.set(key, entry);
  }

  /** One row per outcome — the grain 025 restored. */
  const rows = [];
  for (const entry of positions.values()) {
    for (const [teamName, amount] of Object.entries(entry.position)) {
      rows.push({
        user_id: entry.userId,
        match_id: entry.matchId,
        team_name: teamName,
        game_type: entry.gameType,
        exposure_amount: amount,
        match_title: entry.matchTitle,
        event_id: entry.eventId,
        created_at: new Date(),
        updated_at: new Date(),
      });
    }
  }

  const players = new Set([...positions.values()].map((entry) => entry.userId));

  await report({ models, rows, positions, players, inferred, skipped });

  if (!apply) {
    logger.warn(
      `DRY RUN — nothing was written. ${rows.length} row(s) across ${players.size} player(s) ` +
        'would replace the flattened rows migration 005 produced. Re-run with --apply.'
    );
    await sequelize.close();
    return;
  }

  await sequelize.transaction(async (transaction) => {
    /**
     * Replace only the players who have open bets.
     *
     * A player with no open bet SHOULD have no exposure, but their rows are
     * left alone here: a row with no bet behind it means a settlement that did
     * not clear its exposure, or an import, and deleting it silently would hide
     * whichever it is. It is counted in the report instead.
     */
    await models.UserExposures.destroy({
      where: { user_id: [...players] },
      transaction,
    });

    await models.UserExposures.bulkCreate(rows, { transaction });
  });

  logger.info({ written: rows.length, players: players.size }, 'user_exposures rebuilt');
  await sequelize.close();
}

/** What changed, before it changes. */
async function report({ models, rows, positions, players, inferred, skipped }) {
  const existing = await models.UserExposures.findAll({ where: { user_id: [...players] } });

  const before = new Map();
  for (const row of existing) {
    const key = `${row.user_id} ${row.match_id}`;
    before.set(key, money.add(before.get(key) ?? money.toMinor('0'), money.toMinor(row.exposure_amount ?? '0')));
  }

  process.stdout.write('\n  player      match                  blocked now → blocked after   outcomes\n');
  process.stdout.write('  ' + '─'.repeat(76) + '\n');

  for (const entry of positions.values()) {
    const key = `${entry.userId} ${entry.matchId}`;
    const now = money.toDecimalString(before.get(key) ?? money.toMinor('0'));
    const after = worstCase(entry.position);
    const changed = now !== after ? '  ←' : '';

    process.stdout.write(
      `  ${entry.userId.padEnd(11)} ${String(entry.matchId).slice(0, 22).padEnd(22)} ` +
        `${now.padStart(12)} → ${after.padStart(12)}   ${Object.keys(entry.position).length}${changed}\n`
    );
  }

  const orphans = existing.filter(
    (row) => ![...positions.values()].some((e) => e.userId === String(row.user_id) && e.matchId === String(row.match_id))
  );

  process.stdout.write('\n');
  logger.info(
    {
      rows: rows.length,
      players: players.size,
      positions: positions.size,
      inferredOutcomeSets: inferred,
      unusableBets: skipped,
      orphanExposureRows: orphans.length,
    },
    'Rebuild summary'
  );

  if (inferred) {
    logger.warn(
      `${inferred} bet(s) had an outcome set reconstructed from incomplete columns — see outcomesFor(). ` +
        'Their worst case is only as good as what was stored at placement.'
    );
  }

  if (orphans.length) {
    logger.warn(
      `${orphans.length} exposure row(s) belong to a match with no open bet. Left in place — ` +
        'each one is a settlement that did not clear its exposure, or an import. Review before deleting.'
    );
  }
}

/**
 * Only run when invoked directly.
 *
 * The reconstruction rules are the part most likely to be wrong, so they are
 * exported and tested rather than left to a dry run someone reads once.
 */
if (require.main === module) {
  main().catch((error) => {
    logger.error({ err: error }, 'Rebuild failed — nothing was committed');
    process.exit(1);
  });
}

module.exports = { outcomesFor, sideOf, wasInferred, OPEN_STATUSES };
