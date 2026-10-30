/* eslint-disable no-console, eqeqeq -- bitcasino: hash-game-exchange logic kept verbatim (its debug logs and loose compares). */
/* Ported from TENEXCH components/betting/placeBet/placeBetLiveChecks.js, unchanged. On mssports the
 * buffer runs SERVER-side (placeBetBuffered), so these are previews. Addaplay's equivalents win
 * where both exist: fancy drift = addaplay.isFancyDriftAcceptable (any tier, either side),
 * live side = addaplay.readLiveSide. monitorOddsBuffer / getFinalSuspensionStatus:
 * TENEXCH (no Addaplay equivalent). */

// ─── Live-market checks used by the submit pipeline ──────────────────────────
// These read the freshest market list (via getMarketList / marketList) and
// decide whether the bet can still go through. No React, no toasts — callers
// (usePlaceBetPanel) own the UI side effects.

import { normalizeName, isBlockedGameStatus, feedSideFor } from './placeBetRules';

// Resolve the runner row for a market: by selection id when we have one,
// otherwise by (normalized) name, falling back to a single-runner section.
function findRunner(mkt, selectionId, runnerName) {
  if (!mkt?.section) return null;
  if (selectionId) {
    return mkt.section.find(s => String(s.sid) === String(selectionId));
  }
  const wantNat = normalizeName(runnerName);
  return mkt.section.find(s => normalizeName(s.nat) === wantNat)
    || (mkt.section.length === 1 ? mkt.section[0] : null);
}

// ── Buffer monitoring — continuously track latest odds/size ─────────────────
// Polls the live market list every 500ms for `bufferSeconds`, following the
// best available price for the selected side. Resolves with:
//   finalOdds — last live odds seen (selected odds for locked/fancy markets)
//   finalSize — last live size seen
//   blocked   — runner went suspended / lost its odds mid-buffer
export async function monitorOddsBuffer({
  bufferSeconds,
  clickTime,
  getMarketList,
  marketId,
  selectionId,
  betType,
  oddsLocked,
  selectedOdds,
  initialSize,
  // Line markets show the feed's BACK tiers as "No" and its LAY tiers as
  // "Yes", so the side to read here is the opposite of the slip's.
  feedSideInverted = false,
}) {
  let finalOdds = selectedOdds;
  let finalSize = initialSize;
  let blocked = false;

  if (!marketId || !selectionId || !(bufferSeconds > 0)) {
    return { finalOdds, finalSize, blocked };
  }

  let checkCount = 0;
  await new Promise(resolve => {
    const iv = setInterval(() => {
      checkCount++;
      const elapsed = ((Date.now() - clickTime.getTime()) / 1000).toFixed(1);
      const mList = getMarketList();
      const mkt = mList.find(m => m.mid == marketId);
      if (!mkt?.section) {
        console.log(`%c[PlaceBet] 🔍 ${elapsed}s | Check #${checkCount} | No market data`, 'color: #FF9800');
        return;
      }
      // Market-level suspension — bookmaker (match1) conveys suspension ONLY
      // per-section, every other gtype also carries a market `status`
      if ((mkt.gtype || '').toLowerCase() !== 'match1') {
        const mktStatus = (mkt.status || '').toUpperCase();
        if (isBlockedGameStatus(mktStatus)) {
          console.log(`%c[PlaceBet] 🔴 ${elapsed}s | Check #${checkCount} | Market ${mktStatus} — immediate reject`, 'color: #f44336; font-weight: bold');
          blocked = true;
          clearInterval(iv);
          resolve();
          return;
        }
      }
      const runner = mkt.section.find(s => s.sid == selectionId);
      if (!runner?.odds) {
        console.log(`%c[PlaceBet] 🔍 ${elapsed}s | Check #${checkCount} | No runner odds`, 'color: #FF9800');
        return;
      }

      const rawGstatus = (runner.gstatus || '').toUpperCase();
      const rawStatus = (runner.status || '').toUpperCase();
      const gs = rawGstatus || rawStatus;
      console.log(
        `%c[PlaceBet] 🔍 ${elapsed}s | Check #${checkCount} | gstatus=${rawGstatus || 'N/A'} | status=${rawStatus || 'N/A'}`,
        'color: #9E9E9E'
      );
      if (isBlockedGameStatus(gs)) {
        console.log(`%c[PlaceBet] 🔴 ${elapsed}s | Check #${checkCount} | ${gs} — immediate reject`, 'color: #f44336; font-weight: bold');
        blocked = true;
        clearInterval(iv);
        resolve();
        return;
      }

      const feedSide = feedSideFor(betType, feedSideInverted);
      const bestObj = runner.odds.find(o =>
        (o.otype || '').toLowerCase() === feedSide &&
        (o.tno === 0 || o.oname === (feedSide === 'lay' ? 'lay1' : 'back1'))
      );

      if (!bestObj || !bestObj.odds || bestObj.odds <= 0) {
        console.log(`%c[PlaceBet] 🔴 ${elapsed}s | Check #${checkCount} | No valid odds — immediate reject`, 'color: #f44336; font-weight: bold');
        blocked = true;
        clearInterval(iv);
        resolve();
        return;
      }

      const liveOdds = bestObj.odds;
      const liveSize = bestObj.size || 0;
      const oddsMatch = Math.abs(liveOdds - selectedOdds) <= 0.001;

      const allOdds = runner.odds || [];
      const b3 = allOdds.find(o => o.oname === 'back3')?.odds || '-';
      const b2 = allOdds.find(o => o.oname === 'back2')?.odds || '-';
      const b1 = allOdds.find(o => o.oname === 'back1')?.odds || '-';
      const l1 = allOdds.find(o => o.oname === 'lay1')?.odds || '-';
      const l2 = allOdds.find(o => o.oname === 'lay2')?.odds || '-';
      const l3 = allOdds.find(o => o.oname === 'lay3')?.odds || '-';
      const oddsSnap = `[${b3} ${b2} ${b1} | ${l1} ${l2} ${l3}]`;

      const color = oddsMatch ? 'color: #4CAF50' : 'color: #FF9800';
      const symbol = oddsMatch ? '✓' : '✗';
      console.log(
        `%c[PlaceBet] 🔍 ${elapsed}s | Check #${checkCount} | Selected: ${selectedOdds} | Live: ${liveOdds} ${symbol} | Size: ${liveSize} | All: ${oddsSnap}`,
        color
      );

      // Only update odds/size for non-locked (Match Odds) markets
      if (!oddsLocked) {
        finalOdds = liveOdds;
        finalSize = liveSize;
      } else {
        // For fancy/locked markets: still track size, keep odds as selected
        finalSize = liveSize;
      }
    }, 500);
    setTimeout(() => { clearInterval(iv); resolve(); }, bufferSeconds * 1000);
  });

  return { finalOdds, finalSize, blocked };
}

// ── Final live suspension check (for all market types) ──────────────────────
// Returns the blocking game status ('SUSPENDED' | 'BALL RUNNING' | 'INACTIVE')
// or null when the runner is still bettable / not found.
export function getFinalSuspensionStatus({ marketList, marketId, selectionId, runnerName }) {
  const mkt = marketList.find(m => String(m.mid) === String(marketId));
  // Market-level status first (non-match1 — same rule as the buffer monitor)
  if (mkt && (mkt.gtype || '').toLowerCase() !== 'match1') {
    const mktStatus = (mkt.status || '').toUpperCase();
    if (isBlockedGameStatus(mktStatus)) {
      console.log(`%c[PlaceBet] 🔴 Final check: market ${mktStatus} — rejecting`, 'color: #f44336; font-weight: bold');
      return mktStatus;
    }
  }
  const runner = findRunner(mkt, selectionId, runnerName);
  if (!runner) return null;

  const rawGstatus = (runner.gstatus || '').toUpperCase();
  const rawStatus = (runner.status || '').toUpperCase();
  const gs = rawGstatus || rawStatus;
  console.log(
    `%c[PlaceBet] 🔍 Final check | gstatus=${rawGstatus || 'N/A'} | status=${rawStatus || 'N/A'}`,
    'color: #9E9E9E'
  );
  if (isBlockedGameStatus(gs)) {
    console.log(`%c[PlaceBet] 🔴 Final check: ${gs} — rejecting`, 'color: #f44336; font-weight: bold');
    return gs;
  }
  return null;
}

// ── Strict odds check for FANCY (locked-odds) markets ───────────────────────
// The slip odds must still exist (±0.01) among the live tiers for the chosen
// side. Returns { mismatch, liveSize } — liveSize is the size of the matching
// live tier when found (null otherwise).
export function checkFancyOddsDrift({ marketList, marketId, runnerName, betType, selectedOdds, feedSideInverted = false }) {
  const result = { mismatch: false, liveSize: null };
  const mkt = marketList.find(m => String(m.mid) === String(marketId));
  if (!mkt?.section) return result;

  // Fancy rows are matched by name only (no selection id on purpose —
  // fancy feeds reuse sids across rows)
  const wantNat = normalizeName(runnerName);
  let sectionFound = mkt.section.find(s => normalizeName(s.nat) === wantNat);
  if (!sectionFound && mkt.section.length === 1) sectionFound = mkt.section[0];
  if (!sectionFound) return result;

  const side = feedSideFor(betType, feedSideInverted);
  const oddsArr = sectionFound.odds || [];
  const sideTiers = oddsArr
    .filter(o => (o.otype || '').toLowerCase() === side)
    .map(o => Number(o.odds))
    .filter(n => Number.isFinite(n) && n > 0);

  if (sideTiers.length === 0) return result;

  const closest = sideTiers.reduce((best, curr) =>
    Math.abs(curr - selectedOdds) < Math.abs(best - selectedOdds) ? curr : best
  );
  if (Math.abs(closest - selectedOdds) > 0.01) {
    console.log(`%c[PlaceBet] 🔴 Fancy odds mismatch: slip=${selectedOdds} closest=${closest}`, 'color: #f44336; font-weight: bold');
    result.mismatch = true;
    return result;
  }

  const liveObj = oddsArr.find(o =>
    (o.otype || '').toLowerCase() === side && Math.abs(Number(o.odds) - closest) <= 0.01
  );
  if (liveObj?.size) result.liveSize = liveObj.size;
  return result;
}
