/* hash-game-exchange pages/Wallet/BetHistory/sportsBets.js — only `marketLabel`, the one export the exchange reads. */


/* A real value, not empty and not the stored "NULL". */
const present = (v) => {
  const s = v == null ? '' : String(v).trim();
  return s && s.toLowerCase() !== 'null' ? s : '';
};

/* MATCH_ODDS → "Match Odds", OVER_UNDER_15 → "Over/Under 1.5". */
export const marketLabel = (type) => {
  const ou = /^OVER_UNDER_(\d)(\d)$/i.exec(present(type));
  if (ou) return `Over/Under ${ou[1]}.${ou[2]}`;
  return present(type)
    .toLowerCase()
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ');
};

