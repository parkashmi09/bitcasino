'use strict';

const { QueryTypes } = require('sequelize');
const { money, featureCatalogue } = require('@ibitplay/common');

/** Blank fields in Site config read as these (the owner's numbers). */
const DEFAULT_MIN_BALANCE = '200';
const DEFAULT_INACTIVE_HOURS = 10;

const select = (db, sql, replacements) => db.sequelize.query(sql, { replacements, type: QueryTypes.SELECT });

/** The site's Live TV rule: `{ mode: 'gated' | 'open' | 'none', minBalance, inactiveHours, message }`. */
async function liveTvRule(db) {
  const [row] = await select(db, `SELECT variant, enabled, config FROM site_features WHERE feature = 'live_tv'`, {});
  // Never configured: the catalogue's default (the gate), on.
  const mode = !row ? featureCatalogue.defaultVariantOf('live_tv') : row.enabled === false ? 'none' : row.variant;
  const config = row?.config ?? {};
  const minBalance = /^\d{1,8}(\.\d{1,2})?$/.test(String(config.minBalance ?? '').trim()) ? String(config.minBalance).trim() : DEFAULT_MIN_BALANCE;
  const hours = Number.parseInt(String(config.inactiveHours ?? ''), 10);
  const inactiveHours = Number.isFinite(hours) && hours > 0 ? hours : DEFAULT_INACTIVE_HOURS;
  const message = typeof config.message === 'string' && config.message.trim() ? config.message.trim().slice(0, 300) : null;
  return { mode: ['gated', 'open', 'none'].includes(mode) ? mode : 'gated', minBalance, inactiveHours, message };
}

/**
 * May `userId` watch? Gated (owner, 2026-11-01): only a player who has BOTH at least the minimum
 * INR balance AND a bet within the last `inactiveHours` (any product: `wager_activity`, and an
 * open sports bet from the sportsbook's table). Otherwise the message says what is missing — recharge, play, or both.
 */
async function access(db, userId) {
  const rule = await liveTvRule(db);
  const base = { minBalance: rule.minBalance, inactiveHours: rule.inactiveHours };
  if (rule.mode === 'none') return { allowed: false, reason: 'OFF', message: 'Live TV is not available right now.', ...base, balance: null, lastBetAt: null };
  if (rule.mode === 'open') return { allowed: true, reason: null, message: null, ...base, balance: null, lastBetAt: null };

  const [credits] = await select(db, 'SELECT inr FROM credits WHERE uid = :userId', { userId });
  const balance = money.fromStored(credits?.inr ?? '0');
  // Casino and original games are recorded at the bet; sports reach wager_activity only once
  // settled, so a sports bet still open counts from the sportsbook's own table.
  const [last] = await select(
    db,
    `SELECT GREATEST(
       (SELECT MAX(created_at) FROM wager_activity WHERE user_id = :userId),
       (SELECT MAX(created_at) FROM mssports."SportsBet" WHERE user_id = :userId)
     ) AS at`,
    { userId }
  );
  const lastBetAt = last?.at ? new Date(last.at).toISOString() : null;
  const recent = lastBetAt !== null && Date.now() - Date.parse(lastBetAt) < rule.inactiveHours * 3_600_000;
  const funded = money.gte(balance, rule.minBalance);

  if (funded && recent) return { allowed: true, reason: null, message: null, ...base, balance, lastBetAt };

  const amount = Number(rule.minBalance).toLocaleString('en-IN');
  const lines = [];
  if (!funded) lines.push(`Please recharge: Live TV needs a balance of at least ₹${amount}.`);
  if (!recent) lines.push(`Inactive: no bets in the last ${rule.inactiveHours} hours. Place a bet to start the live stream.`);
  return {
    allowed: false,
    reason: !funded && !recent ? 'LOW_BALANCE_INACTIVE' : !funded ? 'LOW_BALANCE' : 'INACTIVE',
    // The owner's own text, when set, comes first; the reasons stay so the player knows what to do.
    message: [rule.message, ...lines].filter(Boolean).join(' '),
    ...base,
    balance,
    lastBetAt,
  };
}

module.exports = { access, liveTvRule, DEFAULT_MIN_BALANCE, DEFAULT_INACTIVE_HOURS };
