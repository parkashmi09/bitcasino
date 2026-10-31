'use strict';

const { money } = require('@ibitplay/common');

const { KIND_CATEGORY } = require('./statements.constants');

/**
 * Turning a list of events into a statement.
 *
 * Pure arithmetic over exact minor units — no database, no request. Kept
 * separate so the one piece of reasoning that matters in this module can be
 * tested against hand-worked numbers.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * THE RUNNING BALANCE IS ANCHORED ON THE LIVE WALLET AND DERIVED BACKWARDS
 *
 * This is legacy's idea and it is a good one, kept verbatim:
 *
 *     closing = live − (movements after the period)
 *     opening = closing − (movements inside the period)
 *     row.balance = opening + running sum
 *
 * The naive alternative is to start from zero and add up. That produces a
 * closing figure that disagrees with the wallet whenever anything ever moved
 * money by a path the statement does not read — a historical GT settlement, a
 * direct write — and gives the reader no way to tell whether the statement or
 * the wallet is wrong.
 *
 * Anchoring on the wallet puts the whole of that discrepancy in the OPENING
 * figure, where it reads as "brought forward", and the last row of an
 * up-to-date period always equals the real balance. `unexplained` reports the
 * lifetime discrepancy separately so it stays visible rather than becoming
 * invisible inside "brought forward".
 * ═════════════════════════════════════════════════════════════════════════
 *
 * ── `toMinorQuantised`, NOT `toMinor`, ON EVERY INGESTED AMOUNT ──────────
 *
 * The amounts reaching here come straight off bare `numeric` columns —
 * `staff_transfers.amount`, `credits_ledger.netamount`, `gis_transactions
 * .amount` — which have always accepted whatever precision legacy's float
 * arithmetic produced. Real rows carry well past eight decimal places.
 *
 * `toMinor` refuses those, correctly: it validates INPUT, and a write the
 * platform cannot represent is a bug. But a statement is a READ, and one
 * over-precise historical row 400'd the entire statement with "amount
 * supports at most 8 decimal places" — the reader loses the whole report over
 * a rounding artefact in a single event. Quantising to the canonical scale
 * shows the row at the precision the platform actually keeps. Writes still go
 * through `toMinor` and still reject.
 */

/** `YYYY-MM-DD` in UTC, matching how the range bounds are compared. */
const dayOf = (ts) => new Date(ts).toISOString().slice(0, 10);

/**
 * Where a timestamp sits relative to the window.
 * @returns {-1|0|1} before, inside, after.
 */
function place(ts, from, to) {
  const day = dayOf(ts);
  if (from && day < from) return -1;
  if (to && day > to) return 1;
  return 0;
}

/**
 * Build the ledger.
 *
 * @param {Array<{ts: Date|string, kind: string, amount: string}>} events Oldest first.
 * @param {string} live The wallet balance right now, as a decimal string.
 */
function buildLedger(events, live, { from, to, page = 1, limit = 100, category = 'all' }) {
  let lifetimeNet = 0n;
  let afterEndNet = 0n;
  let periodNet = 0n;
  const inside = [];

  for (const event of events) {
    const minor = money.toMinorQuantised(event.amount);
    lifetimeNet += minor;

    const where = place(event.ts, from, to);
    if (where > 0) {
      afterEndNet += minor;
      continue;
    }
    if (where < 0) continue;

    periodNet += minor;
    inside.push({ ...event, minor });
  }

  const liveMinor = money.toMinorQuantised(live);
  const closing = liveMinor - afterEndNet;
  const opening = closing - periodNet;

  let running = opening;
  for (const event of inside) {
    running += event.minor;
    event.amount = money.toDecimalString(event.minor);
    event.balance = money.toDecimalString(running);
    event.direction = event.minor >= 0n ? 'IN' : 'OUT';
    delete event.minor;
    delete event.seq;
  }

  const visible = category === 'all' ? inside : inside.filter((e) => KIND_CATEGORY[e.kind] === category);

  // Newest first for display. Paging happens AFTER the running balance is
  // computed — a balance that depends on which page you asked for is not one.
  const ordered = visible.slice().reverse();
  const start = (page - 1) * limit;

  return {
    opening: money.toDecimalString(opening),
    closing: money.toDecimalString(closing),
    movement: money.toDecimalString(periodNet),
    /**
     * What the events cannot account for.
     *
     * `live − lifetimeNet`. Non-zero means money reached this wallet by a path
     * the statement does not read. Reported rather than hidden.
     */
    unexplained: money.toDecimalString(liveMinor - lifetimeNet),
    lifetimeNet: money.toDecimalString(lifetimeNet),
    /** Every in-period row, for the callers that summarise rather than page. */
    inside,
    rows: ordered.slice(start, start + limit),
    pagination: {
      page,
      limit,
      total: ordered.length,
      totalPages: Math.max(1, Math.ceil(ordered.length / limit)),
    },
  };
}

/**
 * Day-by-day money in and out.
 *
 * Gaming P&L is added afterwards by the caller, which has it per day from the
 * aggregate queries rather than from these rows.
 */
function dailyFromEvents(events) {
  const days = new Map();

  const day = (date) => {
    if (!days.has(date)) {
      days.set(date, { date, deposit: 0n, withdraw: 0n, sportsPnl: 0n, casinoPnl: 0n });
    }
    return days.get(date);
  };

  for (const event of events) {
    if (KIND_CATEGORY[event.kind] !== 'money') continue;
    const bucket = day(dayOf(event.ts));
    const minor = money.toMinorQuantised(event.amount);
    if (minor >= 0n) bucket.deposit += minor;
    else bucket.withdraw += -minor;
  }

  return { days, day };
}

/** Render the day map, newest first. */
function finishDaily(days) {
  return [...days.values()]
    .map((d) => ({
      date: d.date,
      deposit: money.toDecimalString(d.deposit),
      withdraw: money.toDecimalString(d.withdraw),
      sportsPnl: money.toDecimalString(d.sportsPnl),
      casinoPnl: money.toDecimalString(d.casinoPnl),
      net: money.toDecimalString(d.deposit - d.withdraw),
    }))
    .sort((a, b) => (a.date < b.date ? 1 : -1));
}

/**
 * Decide which side of the P&L the subject keeps.
 *
 * `playerPnl + = the player won`. The agent's is its exact negation, so the
 * two can never drift: it is computed, not accumulated separately.
 */
function finaliseGaming({ sportsPlayerPnl, casinoPlayerPnl, headlineFor }) {
  const sports = money.toMinor(sportsPlayerPnl);
  const casino = money.toMinor(casinoPlayerPnl);
  const total = sports + casino;

  const forAgent = headlineFor === 'AGENT';
  const pick = (value) => money.toDecimalString(forAgent ? -value : value);

  return {
    sports: { playerPnl: money.toDecimalString(sports), agentPnl: money.toDecimalString(-sports) },
    casino: { playerPnl: money.toDecimalString(casino), agentPnl: money.toDecimalString(-casino) },
    total: {
      playerPnl: money.toDecimalString(total),
      agentPnl: money.toDecimalString(-total),
      headlineFor,
      headlinePnl: pick(total),
      headlineSports: pick(sports),
      headlineCasino: pick(casino),
    },
  };
}

module.exports = { buildLedger, dailyFromEvents, finishDaily, finaliseGaming, place, dayOf };
