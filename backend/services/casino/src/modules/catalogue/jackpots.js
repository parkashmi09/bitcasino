'use strict';

/**
 * Provider jackpot bodies -> one list the lobby can render: `[{ name, amount, currency, gameId, raw }]`.
 *
 * Used by GET /casino/gis/jackpots (Slotegrator) and GET /casino/catalogue/jackpots (gaminghub360's
 * EGT jackpot info). shortcut: neither provider documents this body for us and no captured
 * payload exists in the repo, so the reader is tolerant: a bare array, a list under
 * `items` / `data` / `jackpots` / `levels` (nested once, e.g. `{ data: { jackpots } }`), or a
 * `{ levelName: amount }` map; common field spellings for each value. Replace with a strict
 * mapping once a real response is captured.
 *
 * `amount` is a decimal string (provider figures can exceed float precision); a row with no
 * readable amount is dropped. `raw` keeps the provider's entry for anything not mapped.
 */
const LIST_KEYS = ['items', 'data', 'jackpots', 'levels', 'result'];
const NAME_KEYS = ['name', 'title', 'jackpot_name', 'jackpotName', 'level', 'levelName', 'type', 'id'];
const AMOUNT_KEYS = ['amount', 'value', 'current_value', 'currentValue', 'currentAmount', 'balance', 'sum', 'jackpot'];
const CURRENCY_KEYS = ['currency', 'currency_code', 'currencyCode'];
const GAME_KEYS = ['game_uuid', 'gameUuid', 'game_id', 'gameId'];

const first = (obj, keys) => {
  for (const key of keys) if (obj?.[key] !== undefined && obj[key] !== null && obj[key] !== '') return obj[key];
  return undefined;
};

/** A finite number or numeric string as a plain decimal string; otherwise null. */
function decimal(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : null;
  if (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value.trim())) return value.trim();
  return null;
}

/** The entries array (or a name -> amount map) inside a provider body, and a body-level currency. */
function entriesOf(body, depth = 0) {
  if (Array.isArray(body)) return { list: body, currency: undefined };
  if (!body || typeof body !== 'object') return { list: [], currency: undefined };
  const currency = first(body, CURRENCY_KEYS);
  for (const key of LIST_KEYS) {
    const inner = body[key];
    if (Array.isArray(inner)) return { list: inner, currency };
    if (inner && typeof inner === 'object' && depth < 1) {
      const nested = entriesOf(inner, depth + 1);
      if (nested.list.length) return { list: nested.list, currency: nested.currency ?? currency };
    }
  }
  // `{ I: 120.5, II: 880 }` — every value a figure: name -> amount.
  const pairs = Object.entries(body).filter(([key]) => !CURRENCY_KEYS.includes(key));
  if (pairs.length && pairs.every(([, v]) => decimal(v) !== null)) {
    return { list: pairs.map(([name, amount]) => ({ name, amount })), currency };
  }
  // One jackpot object on its own.
  if (first(body, AMOUNT_KEYS) !== undefined) return { list: [body], currency };
  return { list: [], currency };
}

function normaliseJackpots(body, { currency: fallbackCurrency = null } = {}) {
  const { list, currency: bodyCurrency } = entriesOf(body);
  const out = [];
  list.forEach((entry, index) => {
    if (!entry || typeof entry !== 'object') return;
    let rawAmount = first(entry, AMOUNT_KEYS);
    // `{ amount: { value, currency } }` — a money object.
    if (rawAmount && typeof rawAmount === 'object') rawAmount = first(rawAmount, ['value', 'amount']);
    const amount = decimal(rawAmount);
    if (amount === null) return;
    const currency = first(entry, CURRENCY_KEYS) ?? first(entry.amount, CURRENCY_KEYS) ?? bodyCurrency ?? fallbackCurrency;
    const gameId = first(entry, GAME_KEYS);
    out.push({
      name: String(first(entry, NAME_KEYS) ?? `Jackpot ${index + 1}`),
      amount,
      currency: currency != null ? String(currency).toUpperCase() : null,
      ...(gameId !== undefined ? { gameId: String(gameId) } : {}),
      raw: entry,
    });
  });
  return out;
}

module.exports = { normaliseJackpots };
