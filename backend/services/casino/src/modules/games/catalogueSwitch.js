'use strict';

const { sitePolicy } = require('@ibitplay/common');

/**
 * The casino aggregator switch — the owner's `casino_aggregator` policy, applied to the catalogue.
 *
 * `gisgamesnew` (what the lobby reads) holds ONE aggregator's games at a time. The other's rows
 * wait in `gisgamesnew_parked` (migration 097), ids and all, so switching back brings the same
 * games, favourites and artwork back without a re-fetch — JSGames V2 refuses its list endpoints
 * to our key, so a deleted JSGames catalogue could not be fetched again.
 *
 * Stateless: "is the switch applied?" is answered from the rows themselves (anything of the
 * other aggregator live, or anything of the chosen one parked), so a crash half way is finished
 * by the next run. One transaction under an advisory lock, so two instances never interleave.
 *
 * Run at boot and every `INTERVAL_MS` by casino-service (`index.js`), and before a sync writes.
 *
 * THE EXCEPTION: `JS_ALWAYS_LIVE`. Studios Slotegrator does not carry for us (Evolution, Jili,
 * Pragmatic Live, Mac88, AE Sexy…) keep their JSGames rows in the lobby under the Slotegrator
 * policy too, so the lobby is Slotegrator's games PLUS these. Each row still says whose it is
 * (`aggregator`), so `gameLauncher` opens these through JSGames V2 and their money settles in
 * `game_transactions` + the point ledger like any JSGames game. Under the JSGames policy the
 * list changes nothing (every JSGames row is live then anyway).
 */

const POLICY = 'casino_aggregator';
const AGGREGATORS = Object.freeze(['js_games', 'slotegrator']);
const LIVE = 'gisgamesnew';
const PARKED = 'gisgamesnew_parked';
/** pg_advisory_xact_lock key — "casino_aggregator" in short. */
const LOCK_KEY = 940_094;
const INTERVAL_MS = 15_000;

/**
 * JSGames `provider` keys (lowercase, as the JSGames rows spell them) that stay in the lobby
 * whatever aggregator the owner chose — the studios the Slotegrator catalogue has no games of.
 * NetEnt, BGaming, Hacksaw, PGSoft, Ezugi and Spribe are NOT here: Slotegrator serves those.
 * `lobby`, `sports`, `esports` are not here either: they are entry points, not studios, and the
 * books launch by uid whether or not their row is live.
 */
const JS_ALWAYS_LIVE = Object.freeze([
  'evolution',
  'jili',
  'mac88',
  'sexy',
  'aura',
  'aggaming',
  'rsg',
  'playtechlive',
]);

/** SQL: "this row stays in the lobby under any policy". Uses the `:keep` replacement. */
const KEPT = `(aggregator = 'js_games' AND LOWER(BTRIM(provider)) = ANY(ARRAY[:keep]::text[]))`;

/** The aggregator the owner chose; the default for an unknown or unset value. */
async function chosenAggregator(models) {
  const variant = await sitePolicy.readPolicy(models, POLICY);
  return AGGREGATORS.includes(variant) ? variant : sitePolicy.POLICY_DEFAULTS[POLICY];
}

/**
 * Make the catalogue match the policy. Returns what moved: `{ aggregator, parked, restored }`.
 * A database without migration 097 is left alone (`skipped: true`).
 */
async function applyAggregator({ db, models, logger }) {
  const aggregator = await chosenAggregator(models);
  const sequelize = db.sequelize;

  const [[ready]] = await sequelize.query(`SELECT to_regclass('${PARKED}') IS NOT NULL AS ok`);
  if (!ready?.ok) return { aggregator, skipped: true };

  const [[pending]] = await sequelize.query(
    `SELECT EXISTS (SELECT 1 FROM ${LIVE} WHERE aggregator <> :aggregator AND NOT ${KEPT})
         OR EXISTS (SELECT 1 FROM ${PARKED} WHERE aggregator = :aggregator OR ${KEPT}) AS due`,
    { replacements: { aggregator, keep: JS_ALWAYS_LIVE } }
  );
  if (!pending?.due) return { aggregator, parked: 0, restored: 0 };

  const result = await sequelize.transaction(async (transaction) => {
    await sequelize.query(`SELECT pg_advisory_xact_lock(${LOCK_KEY})`, { transaction });
    const opts = { replacements: { aggregator, keep: JS_ALWAYS_LIVE }, transaction };

    // Out of the lobby: every row not of the chosen aggregator, except the always-live studios.
    const [, parkedResult] = await sequelize.query(
      `WITH moved AS (DELETE FROM ${LIVE} WHERE aggregator <> :aggregator AND NOT ${KEPT} RETURNING *)
       INSERT INTO ${PARKED} SELECT * FROM moved
       ON CONFLICT (uuid) DO NOTHING`,
      opts
    );
    // Back in: the chosen aggregator's parked rows, and the always-live studios'.
    const [, restoredResult] = await sequelize.query(
      `WITH moved AS (DELETE FROM ${PARKED} WHERE aggregator = :aggregator OR ${KEPT} RETURNING *)
       INSERT INTO ${LIVE} SELECT * FROM moved
       ON CONFLICT (uuid) DO NOTHING`,
      opts
    );
    return { aggregator, parked: rowCount(parkedResult), restored: rowCount(restoredResult) };
  });

  logger?.info(result, 'Casino catalogue switched to the owner\'s aggregator');
  return result;
}

const rowCount = (meta) => (typeof meta === 'number' ? meta : meta?.rowCount ?? 0);

/** Apply now, then keep applying. Returns `stop()`. Failures are logged, never thrown. */
function startAggregatorSwitch(deps) {
  const run = () =>
    applyAggregator(deps).catch((error) => deps.logger?.error({ err: error }, 'Casino aggregator switch failed'));
  run();
  const handle = setInterval(run, INTERVAL_MS);
  handle.unref?.();
  return () => clearInterval(handle);
}

module.exports = { POLICY, AGGREGATORS, JS_ALWAYS_LIVE, LIVE, PARKED, chosenAggregator, applyAggregator, startAggregatorSwitch };
