'use strict';

const { QueryTypes } = require('sequelize');

/**
 * Sports bet ka P/L — zip ke `StatementBuilder.sportsNet` ka port (sports service
 * me bhi yahi formula hai). Statement ke "Details" modal aur bet export isi se
 * har bet ka Win nikalte hain.
 */

/** Sport id → naam (zip `config/sportsList.js` + `utils/sportsNames`). */
const SPORT_NAMES = {
  1: 'Football', 2: 'Tennis', 3: 'Mixed Martial Arts', 4: 'Cricket', 5: 'Golf', 6: 'Boxing',
  7: 'Beach Volleyball', 8: 'Table Tennis', 9: 'Futsal', 10: 'Horse Racing', 11: 'E Games',
  15: 'Basketball', 16: 'MotoGP', 17: 'Chess', 18: 'Volleyball', 19: 'Ice Hockey', 22: 'Badminton',
  25: 'Hockey', 29: 'Cycling', 32: 'Motorbikes', 33: 'Athletics', 35: 'Basketball 3X3', 37: 'Sumo',
  38: 'Virtual sports', 39: 'Handball', 40: 'Politics', 52: 'Motor Sports', 53: 'Baseball',
  54: 'Rugby Union', 55: 'Rugby League', 57: 'Darts', 58: 'American Football', 59: 'Snooker',
  62: 'Soccer', 64: 'Esports', 65: 'Greyhound Racing', 66: 'Kabaddi', 67: 'Boat Racing',
  68: 'Esoccer', 69: 'Wrestling', 1477: 'Kabaddi',
};

const sportName = (sportId) => SPORT_NAMES[String(sportId)] || null;

const lower = (v) => String(v || '').toLowerCase();
const isMeterMarket = (marketType) => ['meter', 'meters'].includes(lower(marketType));
const isLineMarket = (marketType) => /\bline$/i.test(String(marketType || '').trim());
const isBadloBet = (bet) => bet?.badlo === true || String(bet?.badlo) === 'true';
const isKhadoBet = (bet) => lower(bet?.market_type) === 'khado';

/** FAN market ka asli naam — khado me selection_name, baaki me fancy_name. */
const fanMarketName = (bet) =>
  isKhadoBet(bet) ? bet?.selection_name || bet?.fancy_name || null : bet?.fancy_name || bet?.selection_name || null;

/**
 * Ek settled bet ka net (+ jeet, − haar).
 * Meter / badlo / oddeven / fancy1 ka net settlement ki ledger entry se (ledgerNet).
 */
function sportsNet(b, ledgerNet = null) {
  const stake = parseFloat(b.stake_amount) || 0;
  const liab = parseFloat(b.liability) || 0;
  const odds = parseFloat(b.odds) || 0;
  const size = parseFloat(b.size) || 0;
  const bt = lower(b.bet_type);
  const gt = String(b.game_type || '').toUpperCase();
  const mt = lower(b.market_type);
  const res = lower(b.result_status);
  const isBack = bt === 'back' || bt === 'yes';
  const isLay = bt === 'lay' || bt === 'no';

  const netFromLedger = gt === 'FAN' && (isMeterMarket(b.market_type) || isBadloBet(b) || mt === 'oddeven' || mt === 'fancy1');
  if (netFromLedger && ledgerNet != null && Number.isFinite(Number(ledgerNet))) {
    return Math.round(Number(ledgerNet) * 100) / 100;
  }

  if (res === 'won') {
    if (isLay) return stake;
    if (!isBack) return 0;
    if (gt === 'BM' || mt === 'tied match') return stake * (odds / 100);
    if (gt !== 'FAN') return stake * (odds - 1);
    if (mt === 'fancy1' || isLineMarket(b.market_type)) return stake;
    return size > 0 ? stake * (size / 100) : stake * (odds / 100);
  }
  if (res === 'loss') {
    if (isBack) return -stake;
    if (isLay) return -liab;
  }
  return 0;
}

/** FAN bets ki settlement entry ka netamount (bet_id → net). */
async function loadFanSettlementNet(sequelize, bets) {
  const ids = bets.filter((b) => String(b.game_type || '').toUpperCase() === 'FAN').map((b) => b.id);
  const out = new Map();
  if (!ids.length) return out;

  const rows = await sequelize.query(
    `SELECT bet_id, netamount FROM mssports.credits_ledger
      WHERE reason = 'settlement' AND bet_id IN (:ids) AND netamount IS NOT NULL
      ORDER BY id ASC`,
    { replacements: { ids }, type: QueryTypes.SELECT }
  );
  for (const r of rows) {
    if (!out.has(String(r.bet_id))) out.set(String(r.bet_id), r.netamount);
  }
  return out;
}

module.exports = { SPORT_NAMES, sportName, sportsNet, loadFanSettlementNet, fanMarketName, isKhadoBet };
