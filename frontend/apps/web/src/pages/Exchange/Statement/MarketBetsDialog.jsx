import React from 'react';
import { DialogShell } from '../../../components/exchange/site';
import { Bone, SkeletonBetRows, formatAmount, formatStartTime } from '../../../components/exchange';
import { usePolling, useExchangeCurrency } from '../../../hooks/exchange';
import { getStatementMarketBets } from '../../../services/exchange';

/* INR from mssports, printed in the header wallet's coin (utils/exchange/stakeCurrency.js). */
const signedWith = (fmt) => (n) => {
  const v = Number(n) || 0;
  return `${v > 0 ? '+' : v < 0 ? '−' : ''}${fmt(Math.abs(v))}`;
};
const tone = (n) => (Number(n) > 0 ? 'text-success' : Number(n) < 0 ? 'text-error' : 'text-secondary');

/**
 * The result behind one SPORTS statement row — `POST account-statement-v2/bets` — in the site's
 * DialogShell: breadcrumb, winner, the player's bets on that market with each bet's net, totals.
 * Mount only while open.
 *
 * @param {{ row: { matchId, eventId, fancyName?, description }, onClose: () => void }} props
 */
export default function MarketBetsDialog({ row, onClose }) {
  const cur = useExchangeCurrency();
  const fmt = cur.isInr ? formatAmount : cur.formatInr;
  const money = (n) => `${cur.prefix}${fmt(n)}`;
  const signed = signedWith(fmt);
  const { matchId, eventId, fancyName } = row;
  const fetcher = React.useCallback(
    () => getStatementMarketBets({ matchId, eventId, fancyName: fancyName || undefined }),
    [matchId, eventId, fancyName],
  );
  const { data, error } = usePolling(fetcher, { key: `${matchId}|${eventId}|${fancyName ?? ''}` });
  const h = data?.header;
  const crumbs = h
    ? [h.sportName, h.competitionName, h.matchTitle, h.fancyName || h.marketType].filter((c) => c && c !== '-')
    : [];

  return (
    <DialogShell title="Result" onClose={onClose}>
      <div className="pb-4 pt-2 text-sm">
        {data === undefined ? (
          error ? (
            <p className="py-10 text-center text-tertiary">The result could not be loaded.</p>
          ) : (
            <div aria-busy="true" aria-label="Loading result">
              <Bone className="h-3 w-3/4 rounded" />
              <Bone className="mt-3 h-24 w-full rounded-xl" />
              <div className="mt-3">
                <SkeletonBetRows rows={2} compact />
              </div>
            </div>
          )
        ) : (
          <>
            <p className="text-xs text-tertiary">{crumbs.length ? crumbs.join(' › ') : row.description}</p>
            <div className="mt-3 grid grid-cols-2 gap-2 rounded-xl bg-layer4 p-3 text-xs">
              <span className="text-tertiary">Winner</span>
              <span className="text-right font-extrabold text-primary">{data.winner || '—'}</span>
              <span className="text-tertiary">Settled</span>
              <span className="text-right text-secondary">{data.settledAt ? formatStartTime(data.settledAt) : '—'}</span>
              <span className="text-tertiary">Bets</span>
              <span className="text-right text-secondary">{data.totalBets}</span>
              <span className="text-tertiary">Net</span>
              <span className={`text-right font-extrabold ${tone(data.totalWin)}`}>{signed(data.totalWin)}</span>
            </div>

            {data.bets.length === 0 ? (
              <p className="py-8 text-center text-xs text-tertiary">No bets on this market.</p>
            ) : (
              <div className="mt-3 flex flex-col gap-1.5">
                {data.bets.map((b) => {
                  const back = b.side === 'BACK';
                  return (
                    <div
                      key={b.id}
                      className={`flex items-stretch gap-2 overflow-hidden rounded-lg bg-layer4 ${b.deleted ? 'opacity-50' : ''}`}
                    >
                      <span className={`w-1 flex-none ${back ? 'bg-back' : 'bg-lay'}`} />
                      <div className="min-w-0 flex-1 py-2">
                        <p className="truncate font-semibold text-primary">{b.selection_name || b.fancy_name || '—'}</p>
                        <p className="mt-0.5 truncate text-xs text-tertiary">
                          {String(b.bet_type || '').toUpperCase()}
                          {b.created_at ? ` · ${formatStartTime(b.created_at)}` : ''}
                          {b.deleted ? ' · Void' : ''}
                        </p>
                      </div>
                      <div className="flex-none py-2 pr-3 text-right text-xs leading-5">
                        <p className="text-secondary">
                          <span className="font-extrabold text-primary">{Number(b.odds) || b.odds}</span>
                          <span className="mx-1 text-tertiary">×</span>
                          <span className="font-semibold text-primary">{money(b.stake_amount)}</span>
                        </p>
                        {b.win != null && <p className={`font-extrabold ${tone(b.win)}`}>{signed(b.win)}</p>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </DialogShell>
  );
}
