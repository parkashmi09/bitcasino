/* Ported from TENEXCH frontend/src/utils/exposureMapping.js, unchanged.
 * TENEXCH (no Addaplay equivalent for THIS backend) — Addaplay's parseExposures
 * (MatchDetail/utils.js:102) reads a different server's exposure shape; mssports answers
 * TENEXCH rows ({match_id, team_name, exposure_amount, game_type}). */

import { classifyMarket } from './oddsHelpers';

// Maps raw `/user/matchexposures/match` rows onto the LIVE markets list.
// Keys are STRICTLY `${market.mid}:${runnerName.toLowerCase()}` — a name-only
// fallback leaked the value into every market sharing the runner name (tennis:
// the same two players appear in MATCH_ODDS, Bookmaker, set winners…).
// A row finds its market by, in order:
//   1. exact mid match (row.match_id === market.mid)
//   2. row.game_type === market name (stored ids can differ from the live
//      feed's mid — e.g. row match_id 7547772858252 vs feed's MATCH_ODDS mid)
//   3. same market family (MATCH_ODDS / BOOKMAKER) that lists this runner
// Shared by GameDetails and VirtualCricketDetails — keep the two pages in sync
// by editing THIS function, not by re-inlining the loop in a page.
export function mapMatchExposures(matchExposureRows, markets) {
  const map = {};
  if (!matchExposureRows?.length || !markets?.length) return map;
  const normName = (s) => String(s || '').trim().toLowerCase();
  const normType = (s) => String(s || '').toUpperCase().replace(/[\s_]+/g, '');
  const familyOf = (gt) => {
    const g = normType(gt);
    if (g === 'MATCHODDS' || g === 'TIEDMATCH') return 'MATCH_ODDS';
    if (g === 'BOOKMAKER' || g === 'BOOKMAKER2') return 'BOOKMAKER';
    return null;
  };
  for (const item of matchExposureRows) {
    const name = normName(item.team_name || item.teamName);
    const amt = Number(item.exposure_amount);
    if (!name || !Number.isFinite(amt)) continue;
    const rowMid = item.match_id != null ? String(item.match_id).trim() : '';
    // 1) exact market-id match
    let mkt = rowMid ? markets.find((m) => String(m.mid).trim() === rowMid) : null;
    // 2) game_type matches the market's name (MATCH_ODDS, Bookmaker…)
    if (!mkt) {
      const gt = normType(item.game_type);
      if (gt) {
        mkt = markets.find((m) => normType(m.mname) === gt
          && (m.section || []).some((s) => normName(s.nat) === name));
      }
    }
    // 3) same market family that actually lists this runner
    if (!mkt) {
      const fam = familyOf(item.game_type);
      if (fam) {
        mkt = markets.find((m) => classifyMarket(m) === fam
          && (m.section || []).some((s) => normName(s.nat) === name));
      }
    }
    if (!mkt) continue;
    const key = `${String(mkt.mid).trim()}:${name}`;
    // Same market+runner can have rows per game_type — sum them
    map[key] = Number(((map[key] || 0) + amt).toFixed(2));
  }
  return map;
}
