'use strict';

/**
 * Throwaway verification for gap 2 + gap 19 — the three writes an in-house bet
 * must perform beyond moving the money.
 *
 *   cd "backend copy" && node verify-tier2.js
 *
 * Drives the REAL `GameEngine` against the dev database, the same way
 * `modules/in-house/__tests__/inHouse.test.js` does, because the socket is the
 * only other way in and a socket client would test the transport rather than
 * the writes. Cleans up everything it creates. Nothing in src/ imports it.
 */
const db = require('@ibitplay/db');
const { createLogger } = require('@ibitplay/common');
const { GameEngine } = require('./services/casino/src/modules/in-house/engine/gameEngine');
const { GamesService } = require('./services/casino/src/modules/games/games.service');

const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(54)} ${String(detail).slice(0, 62)}`);
};

(async () => {
  const logger = createLogger({ name: 'tier2', level: 'silent' });
  const connection = await db.connect({
    config: {
      DB_HOST: '127.0.0.1',
      DB_PORT: 5433,
      DB_NAME: 'bc_games',
      DB_USER: 'postgres',
      DB_PASSWORD: 'root',
      DB_SCHEMA: 'public',
    },
    logger,
    service: 'casino-service',
  });
  await connection.ping();

  const { models } = connection;
  const engine = new GameEngine({ models, db: connection, logger, config: {} });
  const games = new GamesService({ models, db: connection, config: {}, logger });

  const player = await models.Users.findOne({ where: { name: 'demo_player03' }, raw: true });
  const uid = player.id;

  /* Baseline, so the assertions are about the DELTA rather than the history. */
  const before = {
    played: await models.GisRecentlyPlayed.count({ where: { user_id: uid } }),
    wager: await models.Userwager.findOne({ where: { uid: String(uid) }, raw: true }),
    games: player.games_played,
    history: await models.UserwagerHistory.count({ where: { uid } }),
  };
  console.log(`baseline: recently-played=${before.played} wager=${before.wager?.wager ?? 'no row'} games_played=${before.games}\n`);

  await models.Credits.update({ inr: '1000' }, { where: { uid } });

  /* Every id this run creates, so cleanup can delete EXACTLY those. An earlier version
     removed `where: { uid, game: 'limbo' }` and took a pre-existing seeded bet with it —
     a cleanup must never be written as a predicate that could match somebody else's row. */
  const created = [];

  const bet = await engine.placeBet({ userId: uid, game: 'limbo', coin: 'INR', amount: '25' });
  created.push(bet.betId);
  check('the bet was placed', !!bet?.betId, `betId=${bet?.betId} balance=${bet?.balance}`);

  const after = {
    played: await models.GisRecentlyPlayed.findAll({ where: { user_id: uid }, raw: true }),
    wager: await models.Userwager.findOne({ where: { uid: String(uid) }, raw: true }),
    user: await models.Users.findOne({ where: { id: uid }, attributes: ['games_played'], raw: true }),
  };

  /* gap 2 */
  const row = after.played.find((r) => r.game_uuid === 'limbo');
  check('gap 2 — the play was recorded', !!row, `game_uuid=${row?.game_uuid}`);

  /* gap 2, second half: the read must NAME an in-house game, not return game:null */
  const recent = await games.recentlyPlayed({ userId: uid, limit: 10 });
  const resolved = recent.find((r) => r.game_uuid === 'limbo');
  check('  and recently-played RESOLVES it', !!resolved?.game, resolved?.game?.name ?? 'game: null');
  check('  against the in-house catalogue', resolved?.game?.name === 'Limbo', resolved?.game?.name);

  /* gap 19 */
  const wagerNow = Number(after.wager?.wager ?? 0);
  const wagerWas = Number(before.wager?.wager ?? 0);
  check('gap 19 — userwager moved by the stake', wagerNow - wagerWas === 25, `${wagerWas} -> ${wagerNow}`);
  check('gap 19 — games_played incremented', after.user.games_played === before.games + 1,
    `${before.games} -> ${after.user.games_played}`);

  /* A second bet must ADD, not overwrite — the increment path rather than the create path. */
  const bet2 = await engine.placeBet({ userId: uid, game: 'limbo', coin: 'INR', amount: '10' });
  created.push(bet2.betId);
  const second = await models.Userwager.findOne({ where: { uid: String(uid) }, raw: true });
  check('  a second bet ADDS (increment, not overwrite)', Number(second.wager) - wagerWas === 35,
    `${wagerNow} -> ${second.wager}`);

  /* Playing the same game twice must not duplicate the recently-played row. */
  const rows = await models.GisRecentlyPlayed.findAll({ where: { user_id: uid, game_uuid: 'limbo' }, raw: true });
  check('  replaying a game does not duplicate its row', rows.length === 1, `${rows.length} rows`);

  /* `userwager_history` is a designed audit table with no writer in the delivery — the same
     shape as `gis_recently_played` before this change. Two bets, two rows. */
  const hist = await models.UserwagerHistory.findAll({
    where: { uid }, order: [['id', 'ASC']], raw: true,
  });
  const added = hist.slice(before.history);
  check('userwager_history recorded both bets', added.length === 2, `${added.length} rows`);
  check('  the first row opens at 0', added[0]?.previous_wager === '0', `${added[0]?.previous_wager} -> ${added[0]?.new_wager}`);
  check('  the second continues from the first',
    added[1]?.previous_wager === added[0]?.new_wager, `${added[1]?.previous_wager} -> ${added[1]?.new_wager}`);

  /* And the whole point: wager/progress can now see it. */
  const wagerRow = await models.Userwager.findOne({ where: { uid: String(uid) }, raw: true });
  check('the wagering requirement can now be met at all', Number(wagerRow.wager) > 0, `wagered=${wagerRow.wager}`);

  /* ── clean up ────────────────────────────────────────────────────────── */
  await models.Bets.destroy({ where: { id: created } });
  await models.UserwagerHistory.destroy({ where: { uid, id: added.map((r) => r.id) } });
  await models.GisRecentlyPlayed.destroy({ where: { user_id: uid, game_uuid: 'limbo' } });
  if (before.wager) {
    await models.Userwager.update({ wager: before.wager.wager }, { where: { uid: String(uid) } });
  } else {
    await models.Userwager.destroy({ where: { uid: String(uid) } });
  }
  await models.Users.update({ games_played: before.games }, { where: { id: uid } });
  await models.Credits.update({ inr: '9769.30000000' }, { where: { uid } });
  console.log('\ncleaned up: bets, recently-played, userwager, games_played and the balance restored');

  await connection.close?.();
  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} checks passed`);
  process.exit(passed === results.length ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
