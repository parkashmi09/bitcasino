'use strict';

/**
 * The four places a casino transaction can live, and how each spells itself.
 *
 * `bets` is the in-house games (crash, dice, the 30s/1m/2m rounds).
 * `gis_transactions` is Slotegrator.
 * `js_game_transactions` is jsGames v1.
 * `game_transactions` is jsGames v2.
 *
 * Each has its own column names for the same four ideas — who, how much, when,
 * and what happened. Legacy expressed the reconciliation as a hand-written
 * UNION with per-table CASE expressions repeated in five different handlers,
 * and they had drifted apart: `getTransactionHistory` counted a zero-profit bet
 * as `BET`, `getTransactionStats` counted it as neither a win nor a loss, and
 * `/admin/analytics` counted it as `bet`.
 *
 * One declaration, read by every query in the module.
 */
const SOURCES = Object.freeze({
  inhouse: {
    model: 'Bets',
    table: 'bets',
    label: 'in-house',
    userColumn: 'uid',
    amountColumn: 'amount',
    /** Signed profit — positive is a win. */
    profitColumn: 'profit',
    timeColumn: 'created',
    currencyColumn: 'coin',
    idColumn: 'gid',
    rowIdColumn: 'id',
    /** One row IS one round here: `amount` is the stake, `profit` the win. */
    roundColumn: 'gid',
    kindColumn: null,
    gameColumn: 'game',
    /** `bets.game` already holds the name — nothing to look up. */
    catalog: null,
    sessionColumn: null,
    /** Settled when the game wrote a result back. */
    finishedColumn: 'result',
    statusColumn: null,
  },
  gis: {
    model: 'GisTransactions',
    table: 'gis_transactions',
    label: 'slotegrator',
    userColumn: 'user_id',
    amountColumn: 'amount',
    profitColumn: 'amount',
    timeColumn: 'created_at',
    currencyColumn: 'currency',
    idColumn: 'transaction_id',
    rowIdColumn: 'id',
    roundColumn: 'round_id',
    kindColumn: 'action',
    gameColumn: 'game_uuid',
    catalog: 'gis',
    sessionColumn: 'session_id',
    finishedColumn: 'finished',
    statusColumn: null,
  },
  jsgames: {
    model: 'JsGameTransactions',
    table: 'js_game_transactions',
    label: 'jsgames',
    userColumn: 'user_id',
    amountColumn: 'amount',
    profitColumn: 'amount',
    timeColumn: 'timestamp',
    currencyColumn: 'currency',
    idColumn: 'serial_number',
    rowIdColumn: 'id',
    /** v1 carries the provider's round in `external_transaction_id`. */
    roundColumn: 'external_transaction_id',
    kindColumn: 'transaction_type',
    gameColumn: 'game_uid',
    catalog: 'jsgames',
    sessionColumn: null,
    finishedColumn: null,
    statusColumn: 'transaction_status',
  },
  jsgamesv2: {
    model: 'GameTransaction',
    table: 'game_transactions',
    label: 'jsgames-v2',
    userColumn: 'user_id',
    amountColumn: 'amount',
    profitColumn: 'amount',
    timeColumn: 'created_at',
    currencyColumn: 'currency',
    idColumn: 'external_transaction_id',
    rowIdColumn: 'id',
    /** v2 reports movements, not rounds — each row stands alone. */
    roundColumn: null,
    kindColumn: 'transaction_type',
    gameColumn: 'game_uid',
    catalog: 'jsgames',
    sessionColumn: null,
    finishedColumn: null,
    statusColumn: null,
  },
});

/**
 * Where a game identifier is spelled out into a name.
 *
 * `gis_transactions.game_uuid` and `js_game_transactions.game_uid` are provider
 * identifiers — a UUID and a slug. Rendering either one in a "Game" column puts
 * `a3f1…` in front of the player, so the id is resolved against the catalog
 * that owns it.
 */
const CATALOGS = Object.freeze({
  gis: { model: 'GisGames', keyColumn: 'uuid', nameColumn: 'name', vendorColumn: 'provider' },
  jsgames: { model: 'JsGames', keyColumn: 'game_uid', nameColumn: 'game_name', vendorColumn: 'vendor' },
});

const SOURCE_KEYS = Object.freeze(Object.keys(SOURCES));

/**
 * How a movement is classified, everywhere in this module.
 *
 * A zero-profit round is a PUSH, not a win and not a loss. Legacy called it
 * three different things in three different handlers, so the three reports
 * disagreed with each other about the same row.
 */
const OUTCOME = Object.freeze({ WIN: 'WIN', LOSS: 'LOSS', PUSH: 'PUSH' });

function classify(profit) {
  const value = Number(profit ?? 0);
  if (value > 0) return OUTCOME.WIN;
  if (value < 0) return OUTCOME.LOSS;
  return OUTCOME.PUSH;
}

/**
 * What a row DID, in one vocabulary across the four sources.
 *
 * `outcome` answers "did this make money"; `kind` answers "was this a stake or
 * a payout", which is the question a Bet/Win column asks. Without it a caller
 * has to know that Slotegrator spells a stake `action = 'bet'`, jsGames v2
 * spells it `transaction_type = 'loss'`, and the in-house table does not spell
 * it at all because one row is already a whole round.
 *
 * `ROUND` — stake and win in one row (`amount` is the stake, `profit` the win).
 * `NET`   — a single signed movement that already nets a stake against a win.
 */
const KIND = Object.freeze({
  BET: 'BET',
  WIN: 'WIN',
  REFUND: 'REFUND',
  ROLLBACK: 'ROLLBACK',
  ROUND: 'ROUND',
  NET: 'NET',
});

const KIND_BY_LABEL = Object.freeze({
  bet: KIND.BET,
  // v2 records a losing spin as its own debit rather than a zero win.
  loss: KIND.BET,
  win: KIND.WIN,
  refund: KIND.REFUND,
  rollback: KIND.ROLLBACK,
  // v1 collapses a bet and a win that arrived together into one signed row.
  settle: KIND.NET,
});

/**
 * Classify one row's direction.
 *
 * A source with no label column has rows that are already whole rounds. A label
 * nobody here recognises falls back to the sign of the movement, which is the
 * one signal every source stores the same way — better than reporting a stake
 * as a payout because a provider invented a new word.
 */
function kindOf(source, row) {
  if (!source.kindColumn) return KIND.ROUND;

  const label = String(row[source.kindColumn] ?? '').toLowerCase();
  if (KIND_BY_LABEL[label]) return KIND_BY_LABEL[label];

  return Number(row[source.amountColumn] ?? 0) < 0 ? KIND.BET : KIND.WIN;
}

/**
 * `kindOf` as SQL: how many of a source's rows are STAKES, and how many are
 * PAYOUTS that actually paid.
 *
 * ── A COUNT OF ROWS IS NOT A COUNT OF BETS ───────────────────────────────
 *
 * Slotegrator writes a `bet` row AND a `win` row for one spin, and it writes
 * the `win` row even when the spin paid nothing — 931 rows for 405 spins, 309
 * of the 520 wins worth zero. So over `gis_transactions`:
 *
 *     COUNT(*)                      → 931 bets   (it was 405)
 *     COUNT(*) FILTER (amount > 0)  → 931 wins   (it was 211)
 *
 * because `amount` there is UNSIGNED — a stake and a payout are both positive,
 * and neither is the signed profit that `SOURCES[*].profitColumn` claims. Only
 * the in-house table stores a real profit, and only because one of its rows is
 * already a whole round.
 *
 * `refund` and `rollback` are neither a stake nor a payout: a refunded bet was
 * never really risked. Same reason sports turnover counts settled bets only.
 *
 * Every fragment is built from the frozen `SOURCES` table above and never from
 * a request, which is what makes it safe to hand to `literal()`.
 */
function countExpressions(source) {
  // No label column means one row IS one round: it was a bet, and `profit`
  // says whether it paid.
  if (!source.kindColumn) {
    return {
      stakes: 'COUNT(*)',
      paidWins: `COUNT(*) FILTER (WHERE ${source.profitColumn} > 0)`,
    };
  }

  const kind = `LOWER(${source.kindColumn}::text)`;

  return {
    // `loss` is how v2 spells a losing spin's debit and `settle` how v1 spells
    // a bet and its win collapsed into one signed row — each is one stake.
    stakes: `COUNT(*) FILTER (WHERE ${kind} IN ('bet', 'loss', 'settle'))`,
    // A `win` row worth zero is a spin that paid nothing, not a win.
    paidWins: `COUNT(*) FILTER (WHERE ${kind} IN ('win', 'settle') AND ${source.amountColumn} > 0)`,
  };
}

/**
 * `countExpressions`, extended to the MONEY — what the dashboard actually asks.
 *
 * ── WHY THE DASHBOARD WAS WRONG ──────────────────────────────────────────
 *
 * `stats()` classified every row by the SIGN OF `profitColumn` and summed
 * `ABS(amount)` over all of them as "wagered". For the in-house table that is
 * right, because one row is a whole round and `profit` is a real signed
 * profit. For the other three `profitColumn` IS `amountColumn` — the note on
 * `countExpressions` above says so — and that column is UNSIGNED. So on a
 * deployment whose rows are all Slotegrator:
 *
 *     wins    = COUNT(*) FILTER (amount > 0)  → every non-zero row, stakes too
 *     losses  = COUNT(*) FILTER (amount < 0)  → zero, always
 *     wagered = SUM(ABS(amount))              → stakes + payouts + refunds
 *
 * Measured against this database: 20,543 "wins" where 14,172 rows are wins,
 * and ₹64.37 crore "wagered" against ₹33.35 crore actually staked — the extra
 * ₹31 crore being the payouts counted a second time as if players had bet
 * them. House P&L then came out as MINUS the entire turnover.
 *
 * The kind vocabulary already existed and already knew better. This is the
 * same reasoning as `countExpressions`, carried to the sums.
 *
 * A REFUND IS NOT TURNOVER and a REFUND IS NOT A PAYOUT — a refunded bet was
 * never really risked, so it is reported on its own line and kept out of both.
 */
function statExpressions(source) {
  const amount = `ABS(${source.amountColumn})`;

  // One row IS one round: it was a bet, and `profit` says what it did.
  if (!source.kindColumn) {
    const profit = source.profitColumn;
    return {
      movements: 'COUNT(*)',
      // Every round staked something, so the stake count IS the row count.
      bets: 'COUNT(*)',
      /**
       * A source with no win ROWS reports the rounds that PAID as its wins —
       * a zero-profit round is a push, which keeps `wins + losses + pushes`
       * equal to the total here and stops the three reports disagreeing.
       */
      winRows: `COUNT(*) FILTER (WHERE ${profit} > 0)`,
      paidWins: `COUNT(*) FILTER (WHERE ${profit} > 0)`,
      pushes: `COUNT(*) FILTER (WHERE ${profit} = 0)`,
      losses: `COUNT(*) FILTER (WHERE ${profit} < 0)`,
      refunds: '0',
      wagered: `COALESCE(SUM(${amount}), 0)`,
      payouts: `COALESCE(SUM(${profit}) FILTER (WHERE ${profit} > 0), 0)`,
      refunded: '0',
    };
  }

  const kind = `LOWER(${source.kindColumn}::text)`;
  const isStake = `${kind} IN ('bet', 'loss', 'settle')`;
  const isWin = `${kind} IN ('win', 'settle')`;
  const isRefund = `${kind} IN ('refund', 'rollback')`;

  return {
    movements: 'COUNT(*)',
    bets: `COUNT(*) FILTER (WHERE ${isStake})`,
    /**
     * Every win row, zero-value ones included. This is the figure LEGACY
     * reported as `total_wins` and the one the Transaction Breakdown panel
     * shows, so it is carried explicitly rather than inferred.
     */
    winRows: `COUNT(*) FILTER (WHERE ${isWin})`,
    paidWins: `COUNT(*) FILTER (WHERE ${isWin} AND ${source.amountColumn} > 0)`,
    /** A win row worth nothing: the spin closed and paid zero. */
    pushes: `COUNT(*) FILTER (WHERE ${isWin} AND ${source.amountColumn} = 0)`,
    /** Only v2 writes a losing spin as its own debit; elsewhere this is zero. */
    losses: `COUNT(*) FILTER (WHERE ${kind} = 'loss')`,
    refunds: `COUNT(*) FILTER (WHERE ${isRefund})`,
    wagered: `COALESCE(SUM(${amount}) FILTER (WHERE ${isStake}), 0)`,
    payouts: `COALESCE(SUM(${amount}) FILTER (WHERE ${isWin}), 0)`,
    refunded: `COALESCE(SUM(${amount}) FILTER (WHERE ${isRefund}), 0)`,
  };
}

/**
 * Whether the round this row belongs to has closed.
 *
 * Slotegrator states it outright in a boolean. The in-house table states it by
 * writing a result back, so the presence of one IS the answer. A source that
 * says nothing gets `null` rather than a guessed `false` — "we do not know" and
 * "the round is still open" are different claims to put in front of a player.
 */
function finishedOf(source, row) {
  if (!source.finishedColumn) return null;

  const value = row[source.finishedColumn];
  if (typeof value === 'boolean') return value;
  return value !== null && value !== undefined;
}

/** How many rows any single source may contribute to one page. */
const MAX_ROWS_PER_SOURCE = 500;

module.exports = {
  SOURCES,
  SOURCE_KEYS,
  CATALOGS,
  OUTCOME,
  KIND,
  classify,
  kindOf,
  countExpressions,
  statExpressions,
  finishedOf,
  MAX_ROWS_PER_SOURCE,
};
