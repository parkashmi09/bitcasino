import {
  MatchOddsBlock,
  FancyBlock,
  OddEvenBlock,
  LineMarketBlock,
  MarketCard,
  RunnerRow,
  CashoutButton,
} from '../../../components/exchange';
import { limitsText } from '../../../components/exchange/utils';
import { formatOdd, formatSize, marketHasCashoutPosition } from '../../../utils/exchange';
import {
  ladder,
  bestPrice,
  hasDepth,
  rowStatus,
  marketKind,
  marketTitle,
  bookFor,
  singleRow,
} from './shape';

/* Every market of the match, each drawn by its kit block (shape.js marketKind). One slip for the
 * whole page: the block that owns `slip.mid` gets `betSlip` under the clicked row, every other
 * block renders without it. All fancy2 (line) markets share ONE LineMarketBlock placed where the
 * first of them sat in the feed (TENEXCH GameDetails). */

const gt = (m) => String(m?.gtype || '').toLowerCase();

/* Racing runners (horse / greyhound) carry jockey, trainer, age, draw and a silks image in the
 * feed. Silks are served per market: race_icons/{mid}/{himg} (TENEXCH RacingDetails). */
const SILK_BASE = 'https://sitethemedata.com/race_icons/';
const raceInfo = (s) => {
  const parts = [
    s.jname && `J: ${s.jname}`,
    s.tname && `T: ${s.tname}`,
    Number(s.hage) > 0 && `Age ${s.hage}`,
    s.sdraw && String(s.sdraw) !== '0' && `Draw ${s.sdraw}`,
  ].filter(Boolean);
  return parts.length ? <p className="mt-0.5 truncate text-[11px] font-semibold leading-4 text-tertiary">{parts.join(' · ')}</p> : undefined;
};
const raceSilk = (market, s) =>
  s.himg ? (
    <img
      src={`${SILK_BASE}${market.mid}/${s.himg}`}
      alt=""
      loading="lazy"
      className="size-7 flex-none rounded object-contain"
      onError={(e) => {
        e.currentTarget.style.display = 'none';
      }}
    />
  ) : undefined;
// TENEXCH formatOdd: the feed value as-is (3.6, not 3.60).
const price = (v) => formatOdd(v);

function RunnerMarket({ market, book, projected, slip, slipNode, disabled, signedIn, racing, onCell, onCashout, formatAmount, formatLimit }) {
  const mine = slip && String(slip.mid) === String(market.mid);
  const g = gt(market);
  const sections = market.section || [];
  const block = {
    id: market.mid,
    name: marketTitle(market),
    min: market.min || undefined,
    max: market.max || undefined,
    runners: sections.map((s) => ({
      id: s.sid,
      name: s.nat,
      // fancy1 rows carry their own stake range (TENEXCH "Min:100 Max:25K" under each row).
      subline: g === 'fancy1' && (s.min || s.max) ? <p className="mt-0.5 text-[0.6875rem] leading-4 text-tertiary">{limitsText(s.min, s.max, formatLimit)}</p> : raceInfo(s),
      leading: raceSilk(market, s),
      back: ladder(s, 'back'),
      lay: ladder(s, 'lay'),
      status: rowStatus(market, s),
      pnl: bookFor(book, market.mid, s.nat),
      projected: mine && projected ? (projected[s.nat] ?? null) : null,
    })),
  };
  const canCashout = signedIn && (g === 'match' || g === 'match1') && marketHasCashoutPosition(market, book);
  return (
    <MatchOddsBlock
      market={block}
      // A racecard shows ONE back and ONE lay per runner, like TENEXCH; other match markets the 3×3 ladder.
      depth={!racing && g === 'match' && hasDepth(market) ? 3 : 1}
      showSize
      formatPrice={price}
      formatSize={formatSize}
      formatAmount={formatAmount}
      selected={mine ? slip.kitSel : null}
      activeRunnerId={mine ? slip.rowId : null}
      betSlip={mine ? slipNode : null}
      disabled={disabled}
      cashout={canCashout ? <CashoutButton disabled={disabled} onClick={() => onCashout(market)} /> : null}
      onSelect={(sel) => {
        const section = sections.find((s) => s.sid === sel.runnerId);
        if (!section) return;
        const betType = g === 'fancy1' ? (sel.side === 'back' ? 'yes' : 'no') : sel.side;
        onCell({
          market,
          section,
          betType,
          odds: sel.price,
          size: sel.size,
          kind: 'runner',
          rowId: section.sid,
          kitSel: { runnerId: section.sid, side: sel.side, level: sel.level ?? 0 },
        });
      }}
    />
  );
}

function FancyMarket({ market, book, slip, slipNode, disabled, onCell, formatAmount, formatLimit }) {
  const mine = slip && String(slip.mid) === String(market.mid);
  const sections = market.section || [];
  const rows = sections.map((s) => {
    const no = ladder(s, 'lay')[0];
    const yes = ladder(s, 'back')[0];
    return {
      id: s.sid,
      name: s.nat,
      no: { line: no?.price ?? null, rate: no?.size ?? null },
      yes: { line: yes?.price ?? null, rate: yes?.size ?? null },
      min: s.min,
      max: s.max,
      status: rowStatus(market, s),
      pnl: bookFor(book, market.mid, s.nat),
    };
  });
  return (
    <FancyBlock
      title={marketTitle(market)}
      rows={rows}
      formatAmount={formatAmount}
      formatLimit={formatLimit}
      selected={mine ? slip.kitSel : null}
      activeRowId={mine ? slip.rowId : null}
      betSlip={mine ? slipNode : null}
      disabled={disabled}
      onSelect={(sel) => {
        const section = sections.find((s) => s.sid === sel.rowId);
        if (!section) return;
        onCell({
          market,
          section,
          betType: sel.side,
          odds: sel.line,
          size: sel.rate,
          kind: 'fancy',
          rowId: section.sid,
          kitSel: { rowId: section.sid, side: sel.side },
        });
      }}
    />
  );
}

function OddEvenMarket({ market, book, slip, slipNode, disabled, onCell, formatAmount, formatLimit }) {
  const mine = slip && String(slip.mid) === String(market.mid);
  const sections = market.section || [];
  const rows = sections.map((s) => ({
    id: s.sid,
    name: s.nat,
    odd: ladder(s, 'back')[0] || { price: null, size: null },
    even: ladder(s, 'lay')[0] || { price: null, size: null },
    min: s.min,
    max: s.max,
    status: rowStatus(market, s),
    pnl: bookFor(book, market.mid, s.nat),
  }));
  return (
    <OddEvenBlock
      title={marketTitle(market)}
      rows={rows}
      formatPrice={price}
      formatSize={formatSize}
      formatAmount={formatAmount}
      formatLimit={formatLimit}
      selected={mine ? slip.kitSel : null}
      activeRowId={mine ? slip.rowId : null}
      betSlip={mine ? slipNode : null}
      disabled={disabled}
      onSelect={(sel) => {
        const section = sections.find((s) => s.sid === sel.rowId);
        if (!section) return;
        onCell({
          market,
          section,
          betType: sel.pick === 'odd' ? 'yes' : 'no',
          odds: sel.price,
          size: sel.size,
          kind: 'oddeven',
          rowId: section.sid,
          kitSel: { rowId: section.sid, pick: sel.pick },
        });
      }}
    />
  );
}

function LineMarkets({ markets, book, slip, slipNode, disabled, onCell, formatAmount }) {
  const rows = [];
  const index = {};
  for (const m of markets) {
    for (const s of m.section || []) {
      const id = `${m.mid}:${s.sid}`;
      index[id] = { market: m, section: s };
      rows.push({
        id,
        name: (m.section || []).length > 1 ? `${marketTitle(m)} · ${s.nat}` : marketTitle(m),
        // Line markets invert the feed: "No" is filled from its BACK tiers, "Yes" from LAY.
        no: ladder(s, 'back'),
        yes: ladder(s, 'lay'),
        status: rowStatus(m, s),
        pnl: bookFor(book, m.mid, m.mname) ?? bookFor(book, m.mid, s.nat),
      });
    }
  }
  const mine = slip && slip.kind === 'line';
  return (
    <LineMarketBlock
      rows={rows}
      depth={markets.some(hasDepth) ? 3 : 1}
      formatPrice={price}
      formatSize={formatSize}
      formatAmount={formatAmount}
      selected={mine ? slip.kitSel : null}
      activeRowId={mine ? slip.rowId : null}
      betSlip={mine ? slipNode : null}
      disabled={disabled}
      onSelect={(sel) => {
        const hit = index[sel.rowId];
        if (!hit) return;
        // The touched rung is shown; the bet goes at that side's live main quote (useMatchSlip).
        const main = bestPrice(hit.section, sel.side === 'no' ? 'back' : 'lay');
        if (!(Number(main) > 0)) return;
        onCell({
          market: hit.market,
          section: hit.section,
          betType: sel.side,
          odds: sel.price,
          size: sel.size,
          kind: 'line',
          rowId: sel.rowId,
          kitSel: { rowId: sel.rowId, side: sel.side, level: sel.level ?? 0 },
        });
      }}
    />
  );
}

/* Khado (one Yes price, the band width in the name) and cricket-casino Number grids (one Back
   price per row) — no kit block of their own, so the kit's MarketCard + RunnerRow `cells`. */
function SingleMarket({ market, book, projected, slip, slipNode, disabled, onCell, formatAmount, formatLimit }) {
  const mine = slip && String(slip.mid) === String(market.mid);
  const sections = market.section || [];
  const khado = gt(market) === 'khado';
  return (
    <MarketCard
      name={marketTitle(market)}
      columns={[khado ? 'Yes' : 'Back']}
      columnTones={['back']}
      trailingHeader={khado ? 'Min / Max' : undefined}
      formatAmount={formatAmount}
    >
      {sections.map((s) => {
        const row = singleRow(market, s);
        // Khado rows print their stake range like a fancy row (TENEXCH "Min:100 Max:1L").
        const lim = khado && (s.min != null || s.max != null) ? limitsText(s.min, s.max, formatLimit) : null;
        return (
          <RunnerRow
            key={s.sid}
            name={row.name}
            subline={lim ? <p className="mt-0.5 text-[0.6875rem] leading-4 text-tertiary lg:hidden">{lim}</p> : undefined}
            trailing={lim ? <span className="text-xs leading-4 text-secondary">{lim}</span> : undefined}
            cells={[row.cell]}
            status={rowStatus(market, s)}
            disabled={disabled}
            pnl={bookFor(book, market.mid, s.nat)}
            projected={mine && projected ? (projected[s.nat] ?? null) : null}
            formatPrice={khado ? (v) => String(v ?? '') : price}
            formatSize={formatSize}
            formatAmount={formatAmount}
            selected={mine && slip.rowId === s.sid ? { key: row.cell.key } : null}
            onSelect={(sel) =>
              onCell({
                market,
                section: s,
                betType: row.betType,
                odds: sel.price,
                size: sel.size,
                kind: 'single',
                rowId: s.sid,
                kitSel: { key: row.cell.key },
                extra: khado ? { khado_range: row.band } : undefined,
              })
            }
          >
            {mine && slip.rowId === s.sid ? slipNode : null}
          </RunnerRow>
        );
      })}
    </MarketCard>
  );
}

/**
 * @param {object}   props
 * @param {object[]} props.markets       Feed markets to draw, in feed order (already tab-filtered).
 * @param {object}   props.book          useMatchExposure().book
 * @param {object|null} props.slip       useMatchSlip().slip
 * @param {React.ReactNode} props.slipNode  The <BetSlipInline/> for the open slip.
 * @param {object|null} props.projected  Runner name → projected book for the slip's market.
 * @param {boolean}  [props.racing]     Horse / greyhound card: best back + lay only (TENEXCH).
 * @param {boolean}  props.disabled      A bet is in flight.
 * @param {boolean}  props.signedIn
 * @param {(spec)=>void} props.onCell
 * @param {(market)=>void} props.onCashout
 * @param {(n)=>string} [props.formatAmount]  INR book / limits → the player's coin (undefined = kit default)
 * @param {(n)=>string} [props.formatLimit]   Fancy rows' Min/Max (undefined = kit default)
 */
export default function MarketBlocks({ markets, book, slip, slipNode, projected, disabled, signedIn, racing = false, onCell, onCashout, formatAmount, formatLimit }) {
  const common = { book, slip, slipNode, disabled, onCell, formatAmount };
  const lines = markets.filter((m) => marketKind(m) === 'line');
  let linesDrawn = false;
  const out = [];
  for (const m of markets) {
    const kind = marketKind(m);
    if (kind === 'line') {
      if (!linesDrawn) {
        linesDrawn = true;
        out.push(<LineMarkets key="lines" markets={lines} {...common} />);
      }
      continue;
    }
    if (kind === 'runner') {
      out.push(
        <RunnerMarket key={m.mid} market={m} projected={projected} signedIn={signedIn} racing={racing} onCashout={onCashout} formatLimit={formatLimit} {...common} />,
      );
    } else if (kind === 'oddeven') {
      out.push(<OddEvenMarket key={m.mid} market={m} formatLimit={formatLimit} {...common} />);
    } else if (kind === 'single') {
      out.push(<SingleMarket key={m.mid} market={m} projected={projected} formatLimit={formatLimit} {...common} />);
    } else {
      out.push(<FancyMarket key={m.mid} market={m} formatLimit={formatLimit} {...common} />);
    }
  }
  return <div className="flex flex-col gap-3">{out}</div>;
}
