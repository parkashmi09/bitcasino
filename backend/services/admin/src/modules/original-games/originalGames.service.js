'use strict';

const { money, entitlements } = require('@ibitplay/common');

const S = require('../reports/stats.shared');
const { reportingCurrency } = require('../reports/reportingCurrency');
const { playerScope } = require('../reports/audienceStats.helpers');

/**
 * Admin → Casino → Original Games, read from casino-service's `og_transactions` / `og_games`.
 *
 * One round = one `bet` + its `win` (same `round_id`); a loss is a win of 0. A bet or win that was
 * rolled back is a refund and is left out of wagered and won. GGR = wagered − won (the house side).
 * Every read covers the caller's own players (`playerScope`): the Super Admin side sees every
 * player, a staff below it only its downline. `channel` picks Direct Users (no parent) or Agent Users.
 */

/** Minor units per major for the provider's limits — the same table as casino-service originalGames.constants. */
const EXPONENT = { INR: 2, USDT: 6 };

/** Only games the provider offers today (og_games): old in-house rows (crash, dice) stay out. */
const OFFERED = (column) => `${column} IN (SELECT code FROM og_games)`;

/** A row of og_transactions that a rollback has undone. */
const ROLLED_BACK = `EXISTS (SELECT 1 FROM og_transactions r
                              WHERE r.kind = 'rollback' AND r.status = 'applied' AND r.reference_transaction_id = t.transaction_id)`;

/** The caller's players on `channel` → ` AND <column> IN (…)` plus its replacements. */
async function scopeFor(models, staff, channel) {
  const scope = await playerScope(models, staff, { channel: channel ?? 'all', alias: 'p' });
  return {
    where: (column) => ` AND ${column} IN (SELECT p.id FROM users p WHERE ${scope.sql})`,
    replacements: scope.replacements,
  };
}

/** count / sum columns every stats query shares, over the inner `o` rows (t + `rb` flag). */
const FIGURES = `
  COUNT(*) FILTER (WHERE o.kind = 'bet' AND NOT o.rb)::int AS bets,
  COALESCE(SUM(o.amount) FILTER (WHERE o.kind = 'bet' AND NOT o.rb), 0)::text AS wagered,
  COALESCE(SUM(o.amount) FILTER (WHERE o.kind = 'win' AND NOT o.rb), 0)::text AS won,
  COUNT(*) FILTER (WHERE o.kind = 'win' AND o.amount > 0 AND NOT o.rb)::int AS "paidWins",
  COUNT(*) FILTER (WHERE o.kind = 'bet' AND o.rb)::int AS refunds`;

/** Bet history status, from the joined bet + win. */
const STATUS_SQL = `CASE WHEN rb.id IS NOT NULL THEN 'refunded'
                         WHEN w.payout IS NULL THEN 'open'
                         WHEN w.payout > 0 THEN 'won'
                         ELSE 'lost' END`;

class OriginalGamesAdminService {
  constructor({ models }) {
    this.models = models;
  }

  // ── Dashboard ────────────────────────────────────────────────────────

  async stats({ staff, channel, currency, ...query }) {
    const window = S.resolveWindow(query);
    const [buckets, rates, convertTo, scope] = await Promise.all([
      S.bucketsFor(this.models, window),
      currency ? null : S.loadRates(this.models),
      currency ? null : reportingCurrency(this.models, staff),
      scopeFor(this.models, staff, channel),
    ]);
    const replacements = { ...S.replacementsFor(window, null), ...scope.replacements, ...(currency ? { currency } : {}) };
    const rows = `(SELECT t.*, ${ROLLED_BACK} AS rb FROM og_transactions t
                    WHERE t.kind IN ('bet', 'win') AND t.status = 'applied' AND ${OFFERED('t.game_code')} AND ${S.windowSql('t.created_at')}
                      ${scope.where('t.user_id')}${currency ? ' AND t.currency = :currency' : ''}) o`;

    const [series, games, currencies, [players]] = await Promise.all([
      S.select(this.models, `SELECT ${S.bucketSql('o.created_at')} AS bucket, o.currency, ${FIGURES} FROM ${rows} GROUP BY 1, 2`, replacements),
      S.select(
        this.models,
        `SELECT o.game_code AS code, MAX(g.name) AS name, o.currency, ${FIGURES}, COUNT(DISTINCT o.user_id)::int AS players
           FROM ${rows} LEFT JOIN og_games g ON g.code = o.game_code GROUP BY 1, 3`,
        replacements
      ),
      S.select(this.models, `SELECT o.currency, ${FIGURES}, COUNT(DISTINCT o.user_id)::int AS players FROM ${rows} GROUP BY 1`, replacements),
      S.select(this.models, `SELECT COUNT(DISTINCT o.user_id) FILTER (WHERE o.kind = 'bet')::int AS n FROM ${rows}`, replacements),
    ]);

    const converter = S.createConverter(rates, currency, convertTo);
    const totals = add(null, null);
    const perBucket = new Map();
    for (const r of series) {
      const sum = add(perBucket.get(r.bucket), r, converter);
      perBucket.set(r.bucket, sum);
      add(totals, r, converter);
    }
    const perGame = new Map();
    for (const r of games) {
      const key = r.code ?? 'unknown';
      perGame.set(key, { ...add(perGame.get(key), r, converter), name: r.name ?? r.code ?? 'Unknown game', players: (perGame.get(key)?.players ?? 0) + r.players });
    }

    const show = (f) => ({
      bets: f.bets,
      paidWins: f.paidWins,
      refunds: f.refunds,
      wagered: S.dec(f.wagered),
      won: S.dec(f.won),
      ggr: S.dec(f.wagered - f.won),
      margin: S.ratio(S.dec(f.wagered - f.won), S.dec(f.wagered)),
    });

    return {
      currency: converter.currency,
      converted: converter.converted,
      totals: {
        ...show(totals),
        players: players?.n ?? 0,
        averageBet: S.average(totals.wagered, totals.bets),
        winRate: totals.bets ? Math.round((totals.paidWins / totals.bets) * 10_000) / 10_000 : null,
      },
      series: buckets.map((bucket) => ({ bucket, ...show(perBucket.get(bucket) ?? add(null, null)) })),
      byGame: [...perGame.entries()]
        .map(([code, f]) => ({ code, name: f.name, players: f.players, ...show(f) }))
        .sort((a, b) => Number(b.wagered) - Number(a.wagered)),
      // Native amounts, no conversion: what each coin really turned over.
      byCurrency: currencies.map((r) => {
        const wagered = S.minor(r.wagered);
        const won = S.minor(r.won);
        return { currency: r.currency, bets: r.bets, players: r.players, wagered: S.dec(wagered), won: S.dec(won), ggr: S.dec(wagered - won) };
      }),
      unconverted: converter.unconverted(),
    };
  }

  // ── Bet history ──────────────────────────────────────────────────────

  async bets({ staff, channel, from, to, game, currency, status, search, page, limit }) {
    const where = [`b.kind = 'bet'`, `b.status = 'applied'`, OFFERED('b.game_code')];
    const scope = await scopeFor(this.models, staff, channel);
    const replacements = { limit, offset: (page - 1) * limit, ...scope.replacements };
    if (from) {
      where.push('b.created_at >= CAST(:from AS timestamptz)');
      replacements.from = from;
    }
    if (to) {
      where.push('b.created_at < CAST(:to AS timestamptz)');
      replacements.to = to;
    }
    if (game) {
      where.push('b.game_code = :game');
      replacements.game = game;
    }
    if (currency) {
      where.push('b.currency = :currency');
      replacements.currency = currency;
    }
    if (search) {
      // A user id, a username, or a round / transaction id.
      where.push(`(u.name ILIKE :like OR b.user_id::text = :search OR b.round_id = :search OR b.transaction_id = :search)`);
      replacements.search = search;
      replacements.like = `%${search.replace(/[\\%_]/g, '\\$&')}%`;
    }
    const channelFilter = scope.where('b.user_id');
    if (status) replacements.status = status;

    const rows = await S.select(
      this.models,
      `SELECT * FROM (
         SELECT b.id::text, b.created_at, b.user_id::text AS "userId", u.name AS username, (u.parent_staff_id IS NULL) AS direct,
                b.game_code AS "gameCode", COALESCE(g.name, b.game_code) AS "gameName", b.currency,
                b.amount::text AS stake, w.payout::text AS payout, w.settled_at AS "settledAt",
                b.round_id AS "roundId", b.transaction_id AS "transactionId",
                COALESCE(w.balance_after, b.balance_after)::text AS "balanceAfter",
                ${STATUS_SQL} AS status
           FROM og_transactions b
           JOIN users u ON u.id = b.user_id
           LEFT JOIN og_games g ON g.code = b.game_code
           LEFT JOIN LATERAL (
             SELECT SUM(x.amount) AS payout, MAX(x.created_at) AS settled_at,
                    (ARRAY_AGG(x.balance_after ORDER BY x.id DESC))[1] AS balance_after
               FROM og_transactions x
              WHERE x.kind = 'win' AND x.status = 'applied' AND x.round_id = b.round_id AND x.user_id = b.user_id
             HAVING COUNT(*) > 0
           ) w ON TRUE
           LEFT JOIN og_transactions rb
             ON rb.kind = 'rollback' AND rb.status = 'applied' AND rb.reference_transaction_id = b.transaction_id
          WHERE ${where.join(' AND ')}${channelFilter}
       ) r
       ${status ? 'WHERE r.status = :status' : ''}
       ORDER BY r.created_at DESC, r.id DESC
       LIMIT :limit OFFSET :offset`,
      replacements
    );
    const [{ total }] = await S.select(
      this.models,
      `SELECT COUNT(*)::int AS total FROM (
         SELECT ${STATUS_SQL} AS status
           FROM og_transactions b
           JOIN users u ON u.id = b.user_id
           LEFT JOIN LATERAL (
             SELECT SUM(x.amount) AS payout FROM og_transactions x
              WHERE x.kind = 'win' AND x.status = 'applied' AND x.round_id = b.round_id AND x.user_id = b.user_id
             HAVING COUNT(*) > 0
           ) w ON TRUE
           LEFT JOIN og_transactions rb
             ON rb.kind = 'rollback' AND rb.status = 'applied' AND rb.reference_transaction_id = b.transaction_id
          WHERE ${where.join(' AND ')}${channelFilter}
       ) r ${status ? 'WHERE r.status = :status' : ''}`,
      replacements
    );

    return {
      rows: rows.map((r) => ({
        ...r,
        // Player's side: payout − stake (negative = the house won).
        profit: r.payout == null || r.status === 'refunded' ? null : S.dec(S.minor(r.payout) - S.minor(r.stake)),
      })),
      total,
    };
  }

  // ── Games ────────────────────────────────────────────────────────────

  async games({ staff, channel }) {
    const scope = await scopeFor(this.models, staff, channel);
    const [rows, [site], owner] = await Promise.all([
      S.select(
        this.models,
        `SELECT g.code, g.name, g.position, g.data, g.synced_at AS "syncedAt",
                COUNT(t.id)::int AS bets, COUNT(DISTINCT t.user_id)::int AS players, MAX(t.created_at) AS "lastBetAt"
           FROM og_games g
           LEFT JOIN og_transactions t
             ON t.game_code = g.code AND t.kind = 'bet' AND t.status = 'applied'${scope.where('t.user_id')}
          GROUP BY g.code ORDER BY g.position, g.code`,
        scope.replacements
      ),
      S.select(this.models, 'SELECT originals FROM siteconfig LIMIT 1', {}).catch(() => []),
      entitlements.isFlagEntitled('originals').catch(() => true),
    ]);

    const siteOn = site?.originals !== false;
    return {
      // Both switches must be on for the lobby to show Originals (casino-service originalsOn).
      switches: { owner: owner !== false, site: siteOn, live: owner !== false && siteOn },
      games: rows.map((r) => {
        const data = r.data ?? {};
        return {
          code: r.code,
          name: r.name,
          status: data.status ?? null,
          enabled: data.enabled !== false,
          rtp: data.rtp != null ? Number(data.rtp) : null,
          category: data.category ?? null,
          currencies: data.supported_currencies ?? Object.keys(data.limits ?? {}),
          limits: Object.entries(data.limits ?? {}).map(([code, l]) => ({
            currency: code,
            minBet: majorOf(l?.min_bet, code),
            maxBet: majorOf(l?.max_bet, code),
            maxWin: majorOf(l?.max_win, code),
          })),
          image: data.image_url ?? data.image ?? data.thumbnail ?? null,
          syncedAt: r.syncedAt,
          bets: r.bets,
          players: r.players,
          lastBetAt: r.lastBetAt,
        };
      }),
    };
  }
}

/** Fold one row of figures into an accumulator (minor units, in the report currency). */
function add(acc, row, converter) {
  const sum = acc ?? { bets: 0, paidWins: 0, refunds: 0, wagered: S.ZERO, won: S.ZERO };
  if (!row) return sum;
  sum.bets += row.bets;
  sum.paidWins += row.paidWins;
  sum.refunds += row.refunds;
  sum.wagered += converter.convert(S.minor(row.wagered), row.currency, row.bets) ?? S.ZERO;
  sum.won += converter.convert(S.minor(row.won), row.currency) ?? S.ZERO;
  return sum;
}

/** The provider's integer minor units → a decimal in that coin. */
function majorOf(value, currency) {
  if (value == null || EXPONENT[currency] == null) return null;
  return money.toDecimalString(BigInt(value) * 10n ** BigInt(8 - EXPONENT[currency]));
}

module.exports = { OriginalGamesAdminService };
