'use strict';

const { reportingCurrency } = require('../reports/reportingCurrency');

const { money } = require('@ibitplay/common');
const { INHOUSE_PAYOUT, V2_STAKE, V2_PAYOUT, OG_PLAYED } = require('../statements/casinoRounds');

const { visibleStaffIds } = require('../staff-directory/staffDirectory.service');
const {
  COIN_IDS, WITHDRAWAL_DONE, VALUATION_NOTE, SPORT_NAMES, SPORTS_REFUNDED_RESULTS,
} = require('./dashboard.constants');
const { realDepositsSql } = require('../reports/depositRails');
const { gisKindSql, gisSideAmountSql, gisBetCountSql, gisPlayFilterSql } = require('../statements/statements.constants');

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * THE DASHBOARD'S TIME SERIES
 *
 * The headline routes answer "how much, in this window". These answer "how
 * much, per day/week/month of this window" — deposits and withdrawals,
 * registrations, casino and sports turnover and GGR — plus the top games and
 * sports over the same window, for the dashboard's charts.
 *
 * ── WHAT EACH FIGURE READS ───────────────────────────────────────────────
 *
 *   deposits     real deposits, every rail (`reports/depositRails.js`, the
 *                definition User reports and the Users page share). The Super
 *                Admin's Direct User Wallet credit / debit is neither a deposit
 *                nor a withdrawal (owner, 19 Oct 2026).
 *   withdrawals  withdrawals + fiat_withdrawals + f2paywithdrawals, withdrawn statuses (bank
 *                Approved or Paid, crypto Sent — WITHDRAWAL_DONE)
 *   casino       the four casino sources as `bet-history/profileStats.js`
 *                defines them: in-house `bets` (not refunded), Slotegrator
 *                `gis_transactions` (bet, win, refund, rollback — see
 *                `statements.constants.js` gisKindSql: a refund or rollback
 *                that returned a stake takes it off turnover, one that took a
 *                win back takes it off wins, so GGR is the reports'
 *                `#tradingPnlFor` figure), jsGames v1 and v2. A Slotegrator
 *                game whose catalogue type says "sport" is the partner
 *                sportsbook, so it is counted under SPORTS. Plus the Original
 *                Games aggregator (`og_transactions`, rolled-back legs out).
 *                GGR = stakes − wins. `casino*` is every casino game;
 *                `originals*` is the site's own games inside it (in-house
 *                `bets` + Original Games), so third-party = casino − originals.
 *   sports       turnover: `SportsBet.stake_amount` by placement time, voided
 *                and refunded bets excluded (by `status` AND `result_status`) (+ the partner sportsbook's
 *                stakes). GGR: the house side of the sports settlement ledger
 *                (−SUM(profit + loss) over the settlement reasons,
 *                by ledger time — the statements module's P&L) + the partner
 *                sportsbook's stakes − wins.
 *
 * ── WHOSE FIGURES ────────────────────────────────────────────────────────
 *
 * The admin dashboard builds this with `directOnly: true`: DIRECT USERS ONLY —
 * players with no parent (`parent_staff_id IS NULL`), i.e. site signups
 * (referral signups included). Players with a parent are agent clients and
 * live on the "Agent System" tab, never there. Only a tree containing
 * the platform root sees them; anyone else gets an empty scope.
 *
 * Without `directOnly` (the P&L report reuses this service) it is the
 * caller's tree: `visibleStaffIds`, and a tree containing the platform root
 * sees the whole site; anyone else sees the players whose `parent_staff_id`
 * is in their tree.
 *
 * Either way it is applied as a sub-select on `users` inside each query
 * rather than a list of ids pulled into memory.
 *
 * ── CURRENCY ─────────────────────────────────────────────────────────────
 *
 * With no `currency`, every amount is converted to USD at the CURRENT rate —
 * the same health warning as the headline (`VALUATION_NOTE`) — and what had
 * no rate is reported under `unconverted`, never dropped. With a `currency`,
 * only rows in that currency are read and the figures stay in it.
 *
 * ── SQL ──────────────────────────────────────────────────────────────────
 *
 * Every value is a bound replacement. The only text spliced into the SQL is
 * table and column names fixed in this file. Each window is a plain
 * `col >= from AND col < to` on the raw column, so a date index can serve it;
 * the bucketing function is applied in the SELECT only.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/**
 * `gis_transactions.amount` is SIGNED from the wallet's side: the GIS handler
 * (`casino/.../gis/gis.service.js`) writes a `bet` as a debit (negative) and a
 * `win` or `refund` as a credit (positive); a `rollback` is + when it reverses
 * a bet and − when it reverses a win or refund. Older rows may hold the bet as
 * a magnitude, so a bet is read through `ABS(amount)` and everything else as
 * stored (`statements.constants.js` gisSideAmountSql), with `amount <> 0` — an
 * `amount > 0` filter would drop every real stake.
 *
 * `gis_transactions.currency` says 'PKR' for this platform's INR wallet — see
 * `statements.constants.js` (CASINO_INR_CURRENCIES). Folded into INR here so a
 * casino round is not reported in a currency the site does not run.
 */
const GIS_CURRENCY_ALIASES = Object.freeze({ PKR: 'INR' });

/**
 * In-house rounds that QA tooling and bots write straight into `bets` carry
 * `result = {"fake": true, …}`. They are not turnover — the casino service's
 * rule (`bet-history/betHistory.service.js`), which the wager reports follow
 * too, so the dashboard and those reports agree.
 */
const NOT_FAKE = `(b.result->>'fake') IS DISTINCT FROM 'true'`;

/**
 * Sports Exchange settlement reasons in `mssports.credits_ledger` (settlementv2, commission, void
 * after settlement). Each row's `profit + loss` (loss stored negative) is the player's P/L — the
 * settlement ledger's "Total P/L". `netamount` is NOT: MO / BM settle back and lay of one market in one
 * row (on the first bet) as exposure released + P/L, so stake − netamount per bet booked a winning lay
 * as a loss. GGR = −Σ(profit + loss). Bets bhi `mssports."SportsBet"` me hain — `public."SportsBet"` purana, khaali table hai.
 */
const LEDGER_PNL = (a) => `(COALESCE(${a}.profit, 0) + COALESCE(${a}.loss, 0))`;

const SPORTS_LEDGER_REASONS = Object.freeze(['settlement', 'settlement_void', 'commission', 'commission_void']);

/** A sports bet in one of these never took a stake that stayed taken. */
const SPORTS_NOT_TURNOVER = Object.freeze(['void', 'voided', 'refund', 'refunded', 'cancelled', 'canceled', 'rejected', 'failed']);

/** How many games per currency the top-games query ranks before merging in USD. */
const TOP_PER_CURRENCY = 50;

/** Every series a bucket carries. Money keys are decimal strings, the rest counts. */
const MONEY_KEYS = Object.freeze([
  'deposits', 'withdrawals', 'casinoWagered', 'casinoWon', 'casinoGgr', 'originalsWagered', 'originalsWon', 'originalsGgr',
  'sportsStaked', 'sportsGgr',
]);
const COUNT_KEYS = Object.freeze(['depositCount', 'withdrawalCount', 'registrations', 'casinoBets', 'originalsBets', 'sportsBets']);

/** One withdrawal source: its table, date column (all timestamptz since 083), owner, amount, currency. Deposits: `realDepositsSql`. */
const MONEY_SOURCES = Object.freeze([
  { side: 'withdrawal', table: 'withdrawals', date: 'date', owner: 'uid', amount: 'amount', currency: 'coin', statuses: WITHDRAWAL_DONE.withdrawals },
  { side: 'withdrawal', table: 'fiat_withdrawals', date: 'date', owner: 'uid', amount: 'amount', currency: 'currency', statuses: WITHDRAWAL_DONE.fiat_withdrawals },
  { side: 'withdrawal', table: 'f2paywithdrawals', date: 'created_at', owner: 'user_id', amount: 'amount', currency: 'currency', statuses: WITHDRAWAL_DONE.f2paywithdrawals },
]);

/** 'Cricket' for '4'; "Sport 99" for an id the map does not know; 'Other' when the bet has none. */
const sportName = (id) => (id === 'other' ? 'Other' : SPORT_NAMES[id] ?? `Sport ${id}`);

class DashboardStatsService {
  constructor({ models, db, logger, config, directOnly = false, agentOnly = false, branchId = null }) {
    this.models = models;
    this.db = db;
    this.logger = logger;
    this.config = config;
    /** Dashboard "Direct Users" tab: only players with no parent. */
    this.directOnly = directOnly;
    /** P&L "Agent Users" tab: only players with a parent in the caller's tree. */
    this.agentOnly = agentOnly;
    /** Branch reports (modules/branches): only that branch's direct players. The caller checked who may ask. */
    this.branchId = branchId;
  }

  /**
   * Per-bucket figures over `[from, to)`.
   *
   * Only buckets with activity come back; the screen lays them over the full
   * list of buckets itself, so the payload does not carry a year of zeros.
   */
  async series({ actor, from, to, granularity = 'day', currency }) {
    const scope = await this.#scope(actor);
    const ctx = this.#context({ from, to, granularity, currency, scope });
    const rates = currency ? null : await this.#rates();

    const [moneyRows, registrations, gamingRows] = scope.empty
      ? [[], [], []]
      : await Promise.all([this.#moneyRows(ctx), this.#registrationRows(ctx), this.#gamingRows(ctx)]);

    const acc = new Map();
    const unconverted = new Map();
    const bucketOf = (key) => {
      if (!acc.has(key)) {
        acc.set(key, {
          bucket: key,
          ...Object.fromEntries(MONEY_KEYS.map((k) => [k, 0n])),
          ...Object.fromEntries(COUNT_KEYS.map((k) => [k, 0])),
        });
      }
      return acc.get(key);
    };

    /** Add `amount` (in `cur`) to `metric` (`sign` −1 subtracts), converting when no currency was asked for. */
    const add = (row, metric, amount, cur, sign = 1n) => {
      const value = this.#value(amount, cur, rates);
      const minor = value === null ? null : value * sign;
      if (minor === null) {
        const k = `${metric}|${cur || '?'}`;
        const prev = unconverted.get(k) ?? { metric, currency: cur || null, amount: 0n };
        prev.amount += money.toMinorQuantised(String(amount ?? '0')) * sign;
        unconverted.set(k, prev);
        return;
      }
      row[metric] += minor;
    };

    for (const r of moneyRows) {
      const row = bucketOf(r.bucket);
      const cur = this.#currencyOf(r.currency);
      if (r.side === 'deposit') {
        add(row, 'deposits', r.total, cur);
        row.depositCount += Number(r.n) || 0;
      } else {
        add(row, 'withdrawals', r.total, cur);
        row.withdrawalCount += Number(r.n) || 0;
      }
    }

    for (const r of registrations) bucketOf(r.bucket).registrations += Number(r.n) || 0;

    for (const r of gamingRows) {
      const row = bucketOf(r.bucket);
      const cur = this.#currencyOf(r.currency);
      const n = Number(r.n) || 0;
      if (r.section === 'casino') {
        for (const p of r.source === 'originals' ? ['casino', 'originals'] : ['casino']) {
          if (r.kind === 'stake') {
            add(row, `${p}Wagered`, r.total, cur);
            add(row, `${p}Ggr`, r.total, cur);
            row[`${p}Bets`] += n;
          } else {
            add(row, `${p}Won`, r.total, cur);
            add(row, `${p}Ggr`, r.total, cur, -1n);
          }
        }
      } else if (r.kind === 'stake') {
        add(row, 'sportsStaked', r.total, cur);
        row.sportsBets += n;
        if (r.source === 'partner') add(row, 'sportsGgr', r.total, cur);
      } else if (r.kind === 'win') {
        add(row, 'sportsGgr', r.total, cur, -1n);
      } else if (r.kind === 'house') {
        add(row, 'sportsGgr', r.total, cur);
      }
    }

    const buckets = [...acc.values()].sort((a, b) => (a.bucket < b.bucket ? -1 : 1)).map((b) => this.#finish(b));
    const totals = this.#finish(
      [...acc.values()].reduce(
        (t, b) => {
          for (const k of MONEY_KEYS) t[k] += b[k];
          for (const k of COUNT_KEYS) t[k] += b[k];
          return t;
        },
        { ...Object.fromEntries(MONEY_KEYS.map((k) => [k, 0n])), ...Object.fromEntries(COUNT_KEYS.map((k) => [k, 0])) }
      )
    );
    delete totals.bucket;

    return {
      range: { from: ctx.from.toISOString(), to: ctx.to.toISOString() },
      granularity,
      currency: currency ?? rates.target,
      converted: !currency,
      valuation: currency ? null : { note: VALUATION_NOTE, ratesAsOf: rates.asOf },
      buckets,
      totals,
      /** Non-empty means the USD figures above are short by these native amounts. */
      unconverted: [...unconverted.values()].map((u) => ({ ...u, amount: money.toDecimalString(u.amount) })),
    };
  }

  /** The most-played casino games and sports over `[from, to)`, by turnover. */
  async top({ actor, from, to, currency, limit = 10 }) {
    const scope = await this.#scope(actor);
    const ctx = this.#context({ from, to, granularity: 'day', currency, scope });
    const rates = currency ? null : await this.#rates();

    const [gameRows, originalRows, sportRows] = scope.empty
      ? [[], [], []]
      : await Promise.all([this.#topGameRows(ctx), this.#topOriginalRows(ctx), this.#topSportRows(ctx)]);

    const merge = (rows, keyOf, extra) => {
      const map = new Map();
      for (const r of rows) {
        const minor = this.#value(r.total, this.#currencyOf(r.currency), rates);
        if (minor === null) continue;
        const key = keyOf(r);
        const entry = map.get(key) ?? { key, ...extra(r), wagered: 0n, bets: 0 };
        entry.wagered += minor;
        entry.bets += Number(r.n) || 0;
        map.set(key, entry);
      }
      return [...map.values()]
        .sort((a, b) => (b.wagered > a.wagered ? 1 : b.wagered < a.wagered ? -1 : 0))
        .slice(0, limit)
        .map((e) => ({ ...e, wagered: money.toDecimalString(e.wagered) }));
    };

    return {
      range: { from: ctx.from.toISOString(), to: ctx.to.toISOString() },
      currency: currency ?? rates.target,
      converted: !currency,
      games: merge(gameRows, (r) => r.game_key, (r) => ({ name: r.name || r.game_key, provider: r.provider ?? null })),
      originals: merge(originalRows, (r) => r.game_key, (r) => ({ name: r.name || r.game_key, provider: r.provider ?? null })),
      // By sport (`sport_id`), not `game_type` — MO/BM/FAN are market families, not sports.
      sports: merge(sportRows, (r) => r.sport, (r) => ({ name: sportName(r.sport) })),
    };
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Queries
  // ══════════════════════════════════════════════════════════════════════

  async #moneyRows(ctx) {
    const parts = [];
    const replacements = { ...ctx.replacements };

    MONEY_SOURCES.forEach((s, i) => {
      const statusKey = `st${i}`;
      replacements[statusKey] = s.statuses;
      const status = `LOWER(status) IN (:${statusKey})`;
      const currencyExpr = `UPPER(${s.currency})`;
      const currencyFilter = ctx.currency ? `AND UPPER(${s.currency}) = :currency` : '';
      parts.push(`
        SELECT ${this.#bucket(s.date)} AS bucket, '${s.side}' AS side, ${currencyExpr} AS currency,
               COALESCE(SUM(${s.amount}), 0)::text AS total, COUNT(*) AS n
          FROM ${s.table}
         WHERE ${status} AND ${this.#window(s.date)} ${currencyFilter} ${this.#owned(ctx, s.owner, s.ownerIsText)}
         GROUP BY 1, 3`);
    });

    const real = realDepositsSql({
      range: (column) => ` AND ${this.#window(column)}`,
      who: (column, text) => ` ${this.#owned(ctx, column, text)}`,
      currency: Boolean(ctx.currency),
    });
    Object.assign(replacements, real.replacements);
    parts.push(`
      SELECT ${this.#bucket('at')} AS bucket, 'deposit' AS side, cur AS currency, COALESCE(SUM(amt), 0)::text AS total, COUNT(*) AS n
        FROM (${real.sql}) d
       GROUP BY 1, 3`);

    return this.#query(parts.join(' UNION ALL '), replacements);
  }

  async #registrationRows(ctx) {
    const scope = ctx.scope.all
      ? 'AND NOT is_demo'
      : ctx.scope.direct
        ? `AND parent_staff_id IS NULL AND NOT is_demo${ctx.scope.branchId != null ? ' AND branch_id = :branchId' : ''}`
        : 'AND parent_staff_id IN (:staffIds)';
    return this.#query(
      `SELECT ${this.#bucket('created')} AS bucket, COUNT(*) AS n
         FROM users
        WHERE ${this.#window('created')} ${scope}
        GROUP BY 1`,
      ctx.replacements
    );
  }

  /**
   * Casino and sports movements, one row per (bucket, section, kind, currency).
   *
   * `source` separates the partner sportsbook's own stakes (whose GGR is
   * stakes − wins) from the in-house sportsbook's (whose GGR comes from the
   * settlement ledger instead).
   */
  async #gamingRows(ctx) {
    const r = { ...ctx.replacements, ledgerReasons: SPORTS_LEDGER_REASONS, notTurnover: SPORTS_NOT_TURNOVER, refundedResults: SPORTS_REFUNDED_RESULTS };
    const cur = (col) => (ctx.currency ? `AND UPPER(${col}) = :currency` : '');
    const gisCurrency = this.#gisCurrencyExpr('g.currency');

    const sql = `
      SELECT bucket, section, kind, source, currency, SUM(total)::text AS total, SUM(n) AS n FROM (
        SELECT ${this.#bucket('b.created')} AS bucket, 'casino' AS section, 'stake' AS kind, 'originals' AS source,
               UPPER(b.coin) AS currency, SUM(b.amount) AS total, COUNT(*) AS n
          FROM bets b
         WHERE b.amount > 0 AND (b.result IS NULL OR b.result::text <> '"refunded"') AND ${NOT_FAKE}
           AND ${this.#window('b.created')} ${cur('b.coin')} ${this.#owned(ctx, 'b.uid')}
         GROUP BY 1, 5
        UNION ALL
        -- What was PAID on every settled round (pushes and partial returns
        -- included); the count stays the number of winning rounds.
        SELECT ${this.#bucket('b.created')}, 'casino', 'win', 'originals', UPPER(b.coin), SUM(${INHOUSE_PAYOUT('b')}),
               COUNT(*) FILTER (WHERE b.profit > 0)
          FROM bets b
         WHERE b.result IS NOT NULL AND b.result::text <> '"refunded"' AND b.amount + b.profit > 0 AND ${NOT_FAKE}
           AND ${this.#window('b.created')} ${cur('b.coin')} ${this.#owned(ctx, 'b.uid')}
         GROUP BY 1, 5
        UNION ALL
        SELECT ${this.#bucket('g.created_at')},
               CASE WHEN LOWER(COALESCE(gg.type, '')) LIKE '%sport%' THEN 'sports' ELSE 'casino' END,
               ${gisKindSql('g')},
               'partner', ${gisCurrency}, SUM(${gisSideAmountSql('g')}), SUM(${gisBetCountSql('g')})
          FROM gis_transactions g
          LEFT JOIN gis_games gg ON gg.uuid = g.game_uuid
         WHERE ${gisPlayFilterSql('g')}
           AND ${this.#window('g.created_at')} ${ctx.currency ? `AND ${gisCurrency} = :currency` : ''} ${this.#owned(ctx, 'g.user_id')}
         GROUP BY 1, 2, 3, 5
        UNION ALL
        SELECT ${this.#bucket('j.timestamp')}, 'casino',
               CASE WHEN LOWER(j.transaction_type) = 'win' THEN 'win' ELSE 'stake' END,
               'house', UPPER(j.currency), SUM(ABS(j.amount)), COUNT(*)
          FROM js_game_transactions j
         WHERE j.amount <> 0 AND LOWER(j.transaction_type) IN ('bet', 'settle', 'win')
           AND LOWER(j.transaction_status) = 'completed'
           AND ${this.#window('j.timestamp')} ${cur('j.currency')} ${this.#owned(ctx, 'j.user_id')}
         GROUP BY 1, 3, 5
        UNION ALL
        -- jsGames v2 stake / payout from the callback's bet_amount / win_amount
        -- ('amount' is win − bet).
        SELECT ${this.#bucket('v.created_at')}, 'casino', k.kind,
               'house', UPPER(v.currency), SUM(k.amount), SUM(k.n)
          FROM game_transactions v
          CROSS JOIN LATERAL (VALUES ('stake', ${V2_STAKE('v')}, CASE WHEN ${V2_STAKE('v')} > 0 THEN 1 ELSE 0 END),
                                     ('win', ${V2_PAYOUT('v')}, CASE WHEN ${V2_PAYOUT('v')} > 0 THEN 1 ELSE 0 END)) AS k(kind, amount, n)
         WHERE k.amount <> 0
           AND ${this.#window('v.created_at')} ${cur('v.currency')} ${this.#owned(ctx, 'v.user_id')}
         GROUP BY 1, 3, 5
        UNION ALL
        -- Original Games: the bet leg is the stake, the win leg the payout.
        SELECT ${this.#bucket('o.created_at')}, 'casino', CASE WHEN o.kind = 'bet' THEN 'stake' ELSE 'win' END,
               'originals', UPPER(o.currency), SUM(o.amount),
               COUNT(*) FILTER (WHERE o.kind = 'bet' OR o.amount > 0)
          FROM og_transactions o
         WHERE ${OG_PLAYED('o')}
           AND ${this.#window('o.created_at')} ${cur('o.currency')} ${this.#owned(ctx, 'o.user_id')}
         GROUP BY 1, 3, 5
        UNION ALL
        SELECT ${this.#bucket('s.created_at')}, 'sports', 'stake', 'house',
               UPPER(COALESCE(NULLIF(s.original_currency, ''), 'INR')), SUM(s.stake_amount), COUNT(*)
          FROM mssports."SportsBet" s
         WHERE s.stake_amount > 0 AND LOWER(COALESCE(s.status, '')) NOT IN (:notTurnover)
           AND LOWER(COALESCE(s.result_status, '')) NOT IN (:refundedResults)
           AND ${this.#window('s.created_at')}
           ${ctx.currency ? `AND UPPER(COALESCE(NULLIF(s.original_currency, ''), 'INR')) = :currency` : ''}
           ${this.#owned(ctx, 's.user_id')}
         GROUP BY 1, 5
        UNION ALL
        -- House side of the Sports Exchange: minus the player's P/L on the settlement ledger.
        SELECT ${this.#bucket('l.created_at')}, 'sports', 'house', 'house', UPPER(l.currency), -SUM(${LEDGER_PNL('l')}), 0
          FROM mssports.credits_ledger l
         WHERE l.reason IN (:ledgerReasons)
           AND ${this.#window('l.created_at')} ${cur('l.currency')} ${this.#owned(ctx, 'l.user_id', true)}
         GROUP BY 1, 5
      ) x
      GROUP BY 1, 2, 3, 4, 5`;

    return this.#query(sql, r);
  }

  async #topGameRows(ctx) {
    const cur = (col) => (ctx.currency ? `AND UPPER(${col}) = :currency` : '');
    const gisCurrency = this.#gisCurrencyExpr('g.currency');
    const sql = `
      SELECT game_key, currency, name, provider, total::text AS total, n FROM (
        SELECT game_key, currency, MAX(name) AS name, MAX(provider) AS provider, SUM(amount) AS total, SUM(bets) AS n,
               ROW_NUMBER() OVER (PARTITION BY currency ORDER BY SUM(amount) DESC) AS rank
          FROM (
            -- Third-party casino only: the Originals (in-house bets, og_transactions) have their own section.
            -- Stakes less the refunds / rollbacks that returned them, as in the series.
            SELECT 'gis:' || COALESCE(g.game_uuid, '') AS game_key, ${gisCurrency} AS currency,
                   COALESCE(gn.name, gp.name, gg.name, g.game_uuid) AS name, COALESCE(gn.provider, gp.provider, gg.provider) AS provider,
                   ${gisSideAmountSql('g')} AS amount, ${gisBetCountSql('g')} AS bets
              FROM gis_transactions g
              -- The lobby's catalogue first (gisgamesnew, or parked when the other aggregator is live); gis_games is the legacy sync.
              LEFT JOIN gisgamesnew gn ON gn.uuid = g.game_uuid
              LEFT JOIN gisgamesnew_parked gp ON gp.uuid = g.game_uuid
              LEFT JOIN gis_games gg ON gg.uuid = g.game_uuid
             WHERE ${gisPlayFilterSql('g')} AND ${gisKindSql('g')} = 'stake' AND LOWER(COALESCE(gn.type, gp.type, gg.type, '')) NOT LIKE '%sport%'
               AND ${this.#window('g.created_at')} ${ctx.currency ? `AND ${gisCurrency} = :currency` : ''} ${this.#owned(ctx, 'g.user_id')}
            UNION ALL
            SELECT 'js:' || COALESCE(j.game_uid, ''), UPPER(j.currency), COALESCE(jg.game_name, j.game_uid), jg.vendor, ABS(j.amount), 1
              FROM js_game_transactions j
              LEFT JOIN js_games jg ON jg.game_uid = j.game_uid
             WHERE j.amount <> 0 AND LOWER(j.transaction_type) IN ('bet', 'settle') AND LOWER(j.transaction_status) = 'completed'
               AND ${this.#window('j.timestamp')} ${cur('j.currency')} ${this.#owned(ctx, 'j.user_id')}
            UNION ALL
            SELECT 'js:' || COALESCE(v.game_uid, ''), UPPER(v.currency), COALESCE(jg2.game_name, v.game_name, v.game_uid), jg2.vendor,
                   ${V2_STAKE('v')}, CASE WHEN ${V2_STAKE('v')} > 0 THEN 1 ELSE 0 END
              FROM game_transactions v
              LEFT JOIN js_games jg2 ON jg2.game_uid = v.game_uid
             WHERE ${V2_STAKE('v')} <> 0
               AND ${this.#window('v.created_at')} ${cur('v.currency')} ${this.#owned(ctx, 'v.user_id')}
          ) stakes
         GROUP BY game_key, currency
      ) ranked
      WHERE rank <= :perCurrency`;

    return this.#query(sql, { ...ctx.replacements, perCurrency: TOP_PER_CURRENCY });
  }

  /** Top Original games (in-house `bets` + `og_transactions`), the dashboard's "Original" tab beside the casino one. */
  async #topOriginalRows(ctx) {
    const cur = (col) => (ctx.currency ? `AND UPPER(${col}) = :currency` : '');
    const sql = `
      SELECT game_key, currency, name, provider, total::text AS total, n FROM (
        SELECT game_key, currency, MAX(name) AS name, MAX(provider) AS provider, SUM(amount) AS total, SUM(bets) AS n,
               ROW_NUMBER() OVER (PARTITION BY currency ORDER BY SUM(amount) DESC) AS rank
          FROM (
            -- Only the games the provider offers today (og_games): the old in-house crash / dice
            -- rounds (bets, and og rows for codes no longer offered) stay out of this chart.
            SELECT 'og:' || o.game_code AS game_key, UPPER(o.currency) AS currency, og.name AS name, 'Original Games' AS provider, o.amount, 1 AS bets
              FROM og_transactions o
              JOIN og_games og ON og.code = o.game_code
             WHERE ${OG_PLAYED('o')} AND o.kind = 'bet'
               AND ${this.#window('o.created_at')} ${cur('o.currency')} ${this.#owned(ctx, 'o.user_id')}
          ) stakes
         GROUP BY game_key, currency
      ) ranked
      WHERE rank <= :perCurrency`;

    return this.#query(sql, { ...ctx.replacements, perCurrency: TOP_PER_CURRENCY });
  }

  async #topSportRows(ctx) {
    const curExpr = `UPPER(COALESCE(NULLIF(s.original_currency, ''), 'INR'))`;
    return this.#query(
      `SELECT COALESCE(NULLIF(s.sport_id, ''), 'other') AS sport, ${curExpr} AS currency,
              SUM(s.stake_amount)::text AS total, COUNT(*) AS n
         FROM mssports."SportsBet" s
        WHERE s.stake_amount > 0 AND LOWER(COALESCE(s.status, '')) NOT IN (:notTurnover)
          AND LOWER(COALESCE(s.result_status, '')) NOT IN (:refundedResults)
          AND ${this.#window('s.created_at')}
          ${ctx.currency ? `AND ${curExpr} = :currency` : ''}
          ${this.#owned(ctx, 's.user_id')}
        GROUP BY 1, 2`,
      { ...ctx.replacements, notTurnover: SPORTS_NOT_TURNOVER, refundedResults: SPORTS_REFUNDED_RESULTS }
    );
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Fragments — fixed column names only; every value is a replacement
  // ══════════════════════════════════════════════════════════════════════

  #context({ from, to, granularity, currency, scope }) {
    const f = new Date(from);
    const t = new Date(to);
    return {
      from: f,
      to: t,
      currency: currency || null,
      scope,
      replacements: {
        unit: granularity,
        fromTz: f.toISOString(),
        toTz: t.toISOString(),
        ...(currency ? { currency } : {}),
        ...(scope.all || scope.direct ? {} : { staffIds: scope.staffIds }),
        ...(scope.branchId != null ? { branchId: scope.branchId } : {}),
      },
    };
  }

  /** The bucket a row falls in, as its first day ('YYYY-MM-DD'), in UTC. */
  #bucket(column) {
    return `to_char(date_trunc(:unit, ${column} AT TIME ZONE 'UTC'), 'YYYY-MM-DD')`;
  }

  /** Half-open window on the raw column. */
  #window(column) {
    return `${column} >= CAST(:fromTz AS timestamptz) AND ${column} < CAST(:toTz AS timestamptz)`;
  }

  /** The owner column inside the scope: direct users, the caller's tree, or for the root everyone but a demo user. */
  #owned(ctx, column, isText = false) {
    if (ctx.scope.all) {
      return `AND (${column} IS NULL OR ${column} NOT IN (SELECT u.id${isText ? '::text' : ''} FROM users u WHERE u.is_demo))`;
    }
    const players = ctx.scope.direct
      ? `u.parent_staff_id IS NULL AND NOT u.is_demo${ctx.scope.branchId != null ? ' AND u.branch_id = :branchId' : ''}`
      : 'u.parent_staff_id IN (:staffIds)';
    return isText
      ? `AND ${column} IN (SELECT u.id::text FROM users u WHERE ${players})`
      : `AND ${column} IN (SELECT u.id FROM users u WHERE ${players})`;
  }

  #gisCurrencyExpr(column) {
    const cases = Object.entries(GIS_CURRENCY_ALIASES)
      .map(([from, to]) => `WHEN UPPER(${column}) = '${from}' THEN '${to}'`)
      .join(' ');
    return `(CASE ${cases} ELSE UPPER(COALESCE(${column}, '')) END)`;
  }

  #query(sql, replacements) {
    return this.db.sequelize.query(sql, { replacements, type: this.db.QueryTypes.SELECT });
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Values
  // ══════════════════════════════════════════════════════════════════════

  /** `#1155` (a ccdeposit coin id) → 'BTC'; anything else upper-cased. */
  #currencyOf(raw) {
    const s = String(raw ?? '');
    if (s.startsWith('#')) return COIN_IDS[s.slice(1)] ?? null;
    return s.toUpperCase() || null;
  }

  /** Minor units of `amount`, in `rates.target` when `rates` is given; `null` when no rate covers it. */
  #value(amount, currency, rates) {
    const minor = money.toMinorQuantised(String(amount ?? '0'));
    if (!rates) return minor;
    if (currency && currency === rates.target) return minor;
    const rate = currency ? rates.map.get(currency) : null;
    if (rate == null) return minor === 0n ? 0n : null;
    const usd = (minor * money.toMinor(rate)) / 100_000_000n;
    return rates.perTarget ? (usd * 100_000_000n) / rates.perTarget : usd;
  }

  #finish(b) {
    const out = { bucket: b.bucket };
    for (const k of MONEY_KEYS) out[k] = money.toDecimalString(b[k]);
    for (const k of COUNT_KEYS) out[k] = b[k];
    out.net = money.toDecimalString(b.deposits - b.withdrawals);
    return out;
  }

  async #rates() {
    const [rows, want] = await Promise.all([this.models.Exchangerate.findAll({ raw: true }), reportingCurrency(this.models)]);
    // USD and USDT are 1:1 even when `exchangerate` has no row for them.
    const map = new Map([['USD', '1'], ['USDT', '1'], ...rows.map((r) => [String(r.currency ?? '').toUpperCase(), r.usd_rate])]);
    // Converted totals are in the site's default coin; USD when that coin has no rate.
    const rate = want === 'USD' ? null : map.get(want);
    const perTarget = rate != null && Number(rate) > 0 ? money.toMinorQuantised(String(rate)) : null;
    return {
      map,
      target: perTarget ? want : 'USD',
      perTarget,
      asOf: rows.reduce((latest, r) => (r.updated_at && (!latest || r.updated_at > latest) ? r.updated_at : latest), null),
    };
  }

  /**
   * The players this caller's figures cover. `directOnly` (the dashboard, see
   * `DashboardService#scope`): the direct users, and only for a tree that
   * contains the platform root. Otherwise the caller's tree, the root's being
   * the whole site. No actor is an empty scope, never everything.
   */
  async #scope(actor) {
    if (this.branchId != null) return { all: false, direct: true, empty: false, staffIds: [], branchId: this.branchId };
    if (!actor?.id) return { all: false, direct: false, empty: true, staffIds: [] };
    const staffIds = (await visibleStaffIds(this.models, actor.id, { logger: this.logger })).map(Number);
    const root = Number(this.config?.ROOT_STAFF_ID ?? 1);
    const isRoot = staffIds.includes(root);
    if (this.directOnly) return { all: false, direct: true, empty: !isRoot, staffIds: [] };
    if (this.agentOnly) return { all: false, direct: false, empty: staffIds.length === 0, staffIds };
    if (isRoot) return { all: true, direct: false, empty: false, staffIds: [] };
    return { all: false, direct: false, empty: staffIds.length === 0, staffIds };
  }
}

module.exports = { DashboardStatsService, SPORTS_LEDGER_REASONS, SPORTS_NOT_TURNOVER, LEDGER_PNL };
