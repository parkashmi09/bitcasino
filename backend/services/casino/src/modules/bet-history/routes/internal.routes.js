'use strict';

const { Router } = require('express');
const { response, asyncHandler, validate, z } = require('@ibitplay/common');
const { Op, fn, col, literal } = require('sequelize');
const { money } = require('@ibitplay/common');

/* Only `/player/:userId/stats` uses it — the rest of this file queries the
   models directly, which is how it was written. */
const { BetHistoryService } = require('../betHistory.service');
const { casinoProfileStats } = require('../profileStats');

/**
 * A round with a public outcome.
 *
 * Excludes two kinds of row that the feeds used to carry:
 *
 *   `result IS NULL`       still open — no outcome yet, and showing one
 *                          implies there is.
 *   `result = "refunded"`  VOIDED by `GameEngine.refund`, stake returned. Its
 *                          `profit` is `0`, which `classify()` reads as a
 *                          PUSH — so a round that never happened appeared as
 *                          a tie in the public ticker and in `LAST_BETS`.
 *
 * `bets.result` is a `json` column and the marker is the JSON string
 * `"refunded"`, so the comparison is on `::text` rather than the column.
 */
const SETTLED = literal(`"result" IS NOT NULL AND "result"::text <> '"refunded"'`);

/**
 * Bet reads for user-service's socket transport.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * WHY THESE ARE HERE AND NOT IN user-service
 *
 * Six socket events read the `bets` table: `C.MY_BETS`, `C.GAME_DETAILS`,
 * `C.USER_CHART`, `C.LAST_BETS`, `C.LAST_BETS_BY_GAME` and `C.TOP_WINNERS`.
 *
 * `bets` is a CASINO-domain table. user-service loads `core`, `payments` and
 * `extended` — it does not have the model, and giving it one so that a socket
 * handler could read another service's table is the coupling this port exists
 * to undo. It is the same boundary that put the two `/betHistory` sports
 * routes in sports-service rather than casino.
 *
 * The player holds ONE socket, to user-service, because a client connects to
 * one host. So user-service owns the connection and asks casino-service for
 * the casino half over the internal API — which is what the internal audience
 * is for.
 * ═════════════════════════════════════════════════════════════════════════
 *
 * Every route here takes the player id as a PARAMETER, which is safe precisely
 * because the internal audience is unreachable from outside: the loader mounts
 * it behind the shared internal key, and the gateway does not proxy
 * `/internal/*`. The caller has already resolved the player from their token.
 */

/** Newest-first, bounded. Legacy's leaderboards had no limit at all. */
const MAX_ROWS = 50;

const playerId = z.coerce.number().int().positive();
const limit = z.coerce.number().int().min(1).max(MAX_ROWS).default(25);

module.exports = function internalRoutes(deps) {
  const { models } = deps;
  const service = new BetHistoryService(deps);
  const router = Router();

  /** One bet, with money as decimal strings rather than driver floats. */
  const describeBet = (bet) => ({
    id: String(bet.id),
    game: bet.game,
    coin: bet.coin,
    amount: money.toDecimalString(money.toMinor(bet.amount ?? '0')),
    profit: money.toDecimalString(money.toMinor(bet.profit ?? '0')),
    at: bet.created,
  });

  /**
   * Attach player NAMES to a public list — never ids.
   *
   * A leaderboard carrying account ids is a list of accounts to target.
   * Legacy's returned the whole row.
   */
  const withNames = async (rows) => {
    const ids = [...new Set(rows.map((r) => Number(r.uid)).filter(Number.isInteger))];
    const users = ids.length
      ? await models.Users.findAll({ where: { id: ids }, attributes: ['id', 'name', 'avatar'], raw: true })
      : [];
    const byId = new Map(users.map((u) => [String(u.id), u]));

    return rows.map((row) => {
      const user = byId.get(String(row.uid));
      return {
        name: user?.name ?? 'Anonymous',
        avatar: user?.avatar ?? null,
        game: row.game,
        coin: row.coin,
        amount: money.toDecimalString(money.toMinor(row.amount ?? '0')),
        profit: money.toDecimalString(money.toMinor(row.profit ?? '0')),
        at: row.created,
      };
    });
  };

  /** @legacy SOCKET fd2a0537bcdae1736f552707b3bd3156 — `C.MY_BETS` */
  router.get(
    '/player/:userId/bets',
    validate({
      params: z.object({ userId: playerId }).strict(),
      query: z.object({ game: z.string().trim().max(60).optional(), limit }).strict(),
    }),
    asyncHandler(async (req, res) => {
      const rows = await models.Bets.findAll({
        where: { uid: req.params.userId, ...(req.query.game ? { game: req.query.game } : {}) },
        order: [['id', 'DESC']],
        limit: req.query.limit,
        raw: true,
      });
      return response.ok(res, { bets: rows.map(describeBet) });
    })
  );

  /**
   * @legacy SOCKET 657cdcaf1b9072c7d708bb3766bd3915 — `C.GAME_DETAILS`
   *
   * Scoped to the player. Legacy took the bet id from the message with no
   * guard at all, so any bet could be inspected by anyone.
   */
  router.get(
    '/player/:userId/bets/:betId',
    validate({ params: z.object({ userId: playerId, betId: playerId }).strict() }),
    asyncHandler(async (req, res) => {
      const bet = await models.Bets.findOne({
        where: { id: req.params.betId, uid: req.params.userId },
        raw: true,
      });
      // Null rather than a 404 — the caller turns it into the socket refusal,
      // and one answer for "no such bet" and "not yours" keeps the endpoint
      // from confirming which bet ids exist.
      return response.ok(res, { bet: bet ? describeBet(bet) : null });
    })
  );

  /** @legacy SOCKET 1cf37d076d187195c2d7d5e3678dfe0b — `C.USER_CHART` */
  router.get(
    '/player/:userId/chart',
    validate({
      params: z.object({ userId: playerId }).strict(),
      query: z.object({ game: z.string().trim().max(60).optional() }).strict(),
    }),
    asyncHandler(async (req, res) => {
      const rows = await models.Bets.findAll({
        where: { uid: req.params.userId, ...(req.query.game ? { game: req.query.game } : {}) },
        attributes: [
          [fn('DATE', col('created')), 'date'],
          [fn('COUNT', col('id')), 'bets'],
          [fn('COALESCE', fn('SUM', col('profit')), 0), 'profit'],
        ],
        group: [fn('DATE', col('created'))],
        order: [[fn('DATE', col('created')), 'ASC']],
        // Ninety days. Legacy's chart had no bound and read every bet ever.
        limit: 90,
        raw: true,
      });

      return response.ok(res, {
        chart: rows.map((row) => ({
          date: new Date(row.date).toISOString().slice(0, 10),
          bets: Number(row.bets) || 0,
          profit: money.toDecimalString(money.toMinor(row.profit ?? '0')),
        })),
      });
    })
  );

  /** @legacy SOCKET 62f8c260fbce6de8e5ed19767977cc1e — `C.LAST_BETS` */
  /**
   * One player's headline counts, for user-service's public profile — gap 17.
   *
   * `playerStats` counts ROUNDS rather than movements and returns no money,
   * both deliberately — see its own note. It is the same method the player's
   * own `/casino/bet-history/stats` uses; the only difference is who names the
   * player, which here is the calling service on behalf of a viewer.
   */
  router.get(
    '/player/:userId/stats',
    validate({ params: z.object({ userId: z.coerce.number().int().positive() }) }),
    asyncHandler(async (req, res) =>
      response.ok(res, await service.playerStats({ userId: req.params.userId }))
    )
  );

  /**
   * The casino half of user-service's `GET /user/profile/stats`: stakes, wins,
   * biggest payout and top games per currency, for one player. user-service
   * converts to USD and adds sports. See `profileStats.js`.
   */
  router.get(
    '/player/:userId/profile-stats',
    validate({ params: z.object({ userId: z.coerce.number().int().positive() }) }),
    asyncHandler(async (req, res) =>
      response.ok(res, await casinoProfileStats(deps.db, req.params.userId))
    )
  );

  router.get(
    '/recent',
    validate({
      query: z.object({ game: z.string().trim().max(60).optional(), limit }).strict(),
    }),
    asyncHandler(async (req, res) => {
      const rows = await models.Bets.findAll({
        /* Settled, non-voided rounds only — same reasoning as `liveFeed`. An
           open round has no outcome to publish, and a refunded one is a round
           that did not happen, whose zero profit reads as a PUSH. */
        where: req.query.game ? { [Op.and]: [{ game: req.query.game }, SETTLED] } : SETTLED,
        attributes: ['id', 'uid', 'game', 'amount', 'profit', 'coin', 'created'],
        order: [['id', 'DESC']],
        limit: req.query.limit,
        raw: true,
      });
      return response.ok(res, { bets: await withNames(rows) });
    })
  );

  /** @legacy SOCKET b7cafd57089c07ade71b7776085660a0 — `C.TOP_WINNERS` */
  router.get(
    '/top-winners',
    validate({ query: z.object({ limit }).strict() }),
    asyncHandler(async (req, res) => {
      const rows = await models.Bets.findAll({
        /* `profit > 0` already excludes a refund (its profit is 0), but not an
           open round, so `SETTLED` is applied here too rather than relying on
           one filter to imply the other. */
        where: { [Op.and]: [{ profit: { [Op.gt]: 0 } }, SETTLED] },
        attributes: ['id', 'uid', 'game', 'amount', 'profit', 'coin', 'created'],
        order: [['profit', 'DESC']],
        limit: req.query.limit,
        raw: true,
      });
      return response.ok(res, { winners: await withNames(rows) });
    })
  );

  return router;
};
