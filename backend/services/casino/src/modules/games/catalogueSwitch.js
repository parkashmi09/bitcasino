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
 */

const POLICY = 'casino_aggregator';
const AGGREGATORS = Object.freeze(['js_games', 'slotegrator']);
const LIVE = 'gisgamesnew';
const PARKED = 'gisgamesnew_parked';
/** pg_advisory_xact_lock key — "casino_aggregator" in short. */
const LOCK_KEY = 940_094;
const INTERVAL_MS = 15_000;

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
    `SELECT EXISTS (SELECT 1 FROM ${LIVE} WHERE aggregator <> :aggregator)
         OR EXISTS (SELECT 1 FROM ${PARKED} WHERE aggregator = :aggregator) AS due`,
    { replacements: { aggregator } }
  );
  if (!pending?.due) return { aggregator, parked: 0, restored: 0 };

  const result = await sequelize.transaction(async (transaction) => {
    await sequelize.query(`SELECT pg_advisory_xact_lock(${LOCK_KEY})`, { transaction });
    const opts = { replacements: { aggregator }, transaction };

    // Out of the lobby: every row not of the chosen aggregator.
    const [, parkedResult] = await sequelize.query(
      `WITH moved AS (DELETE FROM ${LIVE} WHERE aggregator <> :aggregator RETURNING *)
       INSERT INTO ${PARKED} SELECT * FROM moved
       ON CONFLICT (uuid) DO NOTHING`,
      opts
    );
    // Back in: the chosen aggregator's parked rows.
    const [, restoredResult] = await sequelize.query(
      `WITH moved AS (DELETE FROM ${PARKED} WHERE aggregator = :aggregator RETURNING *)
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

module.exports = { POLICY, AGGREGATORS, LIVE, PARKED, chosenAggregator, applyAggregator, startAggregatorSwitch };
