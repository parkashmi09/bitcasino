import React from 'react';
import { MarketFilterTabs, SkeletonBetRows, formatAmount, formatStartTime } from '../../../components/exchange';
import { Select } from '../../../components/exchange/site';
import { Input } from '../../../components/exchange/site';
import { EmptyPlaceholder } from '../../../components/exchange/site';
import { Pagination } from '../../../components/exchange/site';
import { usePolling, useExchangeCurrency } from '../../../hooks/exchange';
import { getSportsBets } from '../../../services/exchange';
import { ExchangeAccountPage } from '../ExchangeFrame';
import { marketLabel } from '../../Exchange/marketLabel';

/* `status` is mssports' own vocabulary (CricketService.getSportsBetsByUserId): `matchbet` = open
   and matched, `all` = every bet. THERE IS NO SETTLED FILTER — Settled reads `all` and drops the
   open rows here, so a page can hold fewer than PAGE_SIZE rows and the pager counts open bets too
   (docs/backend-gaps.md). No Unmatched tab: this site only takes matched bets (the slip never
   creates an unmatched order, `unmatchbet` is always empty), so there is nothing to list or cancel. */
const TABS = [
  { id: 'matched', label: 'Matched', status: 'matchbet' },
  { id: 'settled', label: 'Settled', status: 'all' },
];
const SIDES = [
  { value: 'all', label: 'All' },
  { value: 'back', label: 'Back' },
  { value: 'lay', label: 'Lay' },
];
const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 400;

const backish = (side) => side === 'back' || side === 'yes';
const SIDE_LABEL = { back: 'Back', lay: 'Lay', yes: 'Yes', no: 'No' };
const RESULT_LABEL = { won: 'Won', win: 'Won', lost: 'Lost', loss: 'Lost', void: 'Void', refund: 'Void', cancelled: 'Cancelled' };
/* mssports amounts are INR; printed in the header wallet's coin (utils/exchange/stakeCurrency.js). */
function useMoney() {
  const cur = useExchangeCurrency();
  const fmt = cur.isInr ? formatAmount : cur.formatInr;
  return { fmt, money: (n) => `${cur.prefix}${fmt(n)}` };
}

function BetRow({ bet, tab }) {
  const { fmt, money } = useMoney();
  const side = bet.side;
  const market = bet.fancyName || marketLabel(bet.marketType);
  // A fancy line's rate (Yes 54 @ 100). Odd/even markets carry a placeholder size (1000000), not a rate.
  const oddEven = String(bet.raw?.gtype || bet.marketType || '').toLowerCase() === 'oddeven';
  const rate = oddEven ? null : bet.raw?.size ?? bet.raw?.user_rate_size;
  const result = String(bet.resultStatus || '').toLowerCase();

  return (
    <div className="flex items-stretch gap-3 border-b border-third py-3">
      <span className={`w-1 flex-none rounded-full ${backish(side) ? 'bg-back' : 'bg-lay'}`} />
      <div className="min-w-0 flex-1">
        <p className="flex min-w-0 items-center gap-1.5">
          <span
            className={`flex-none rounded px-1 py-0.5 text-[0.625rem] font-extrabold uppercase leading-none text-alw_dark ${
              backish(side) ? 'bg-back' : 'bg-lay'
            }`}
          >
            {SIDE_LABEL[side] ?? side}
          </span>
          <span className="truncate text-sm font-extrabold text-primary">{bet.selection || market || '—'}</span>
        </p>
        <p className="mt-1 truncate text-xs text-secondary">
          {bet.matchTitle}
          {market ? ` · ${market}` : ''}
        </p>
        <p className="mt-0.5 truncate text-xs text-tertiary">
          {bet.createdAt ? formatStartTime(bet.createdAt) : ''}
          {bet.id != null ? ` · #${bet.id}` : ''}
        </p>
      </div>
      <div className="flex-none text-right text-xs leading-5">
        <p className="text-secondary">
          <span className="font-extrabold text-primary">{bet.odds}</span>
          {rate != null && (side === 'yes' || side === 'no') && <span className="text-tertiary">@{rate}</span>}
          <span className="mx-1 text-tertiary">×</span>
          <span className="font-extrabold text-primary">{money(bet.stake)}</span>
        </p>
        {tab === 'settled' ? (
          <p>
            {RESULT_LABEL[result] && <span className="mr-1.5 text-tertiary">{RESULT_LABEL[result]}</span>}
            {bet.profit != null && (
              <span className={bet.profit > 0 ? 'font-extrabold text-success' : bet.profit < 0 ? 'font-extrabold text-error' : 'text-secondary'}>
                {bet.profit > 0 ? '+' : bet.profit < 0 ? '−' : ''}
                {fmt(Math.abs(bet.profit))}
              </span>
            )}
          </p>
        ) : (
          bet.liability > 0 && (
            <p className="text-tertiary">
              Liability <span className="font-extrabold text-error">−{fmt(bet.liability)}</span>
            </p>
          )
        )}
      </div>
    </div>
  );
}

/**
 * `/sports/my-bets` — the player's exchange bets: Matched / Settled (`GET cricket/sports-bets/user`),
 * All / Back / Lay, search, 20 a page, amounts in the header wallet's coin. Matched re-reads every
 * 10s. Signed out never reaches here — App.jsx
 * raises the sign-in dialog over the route instead.
 */
export default function ExchangeMyBets() {
  const { money } = useMoney();
  const [tab, setTab] = React.useState('matched');
  const [side, setSide] = React.useState('all');
  const [draft, setDraft] = React.useState('');
  const [query, setQuery] = React.useState('');

  React.useEffect(() => {
    const t = setTimeout(() => setQuery(draft.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [draft]);

  /* The page belongs to the filter it was chosen under; any filter change reads page 1 again
     without an effect resetting it. */
  const filterKey = `${tab}|${side}|${query}`;
  const [pageState, setPageState] = React.useState({ key: filterKey, page: 1 });
  const page = pageState.key === filterKey ? pageState.page : 1;

  const status = TABS.find((t) => t.id === tab).status;
  const fetcher = React.useCallback(
    () => getSportsBets({ page, limit: PAGE_SIZE, search: query || undefined, betType: side, status }),
    [page, query, side, status],
  );
  const { data, error, refresh } = usePolling(fetcher, {
    intervalMs: tab === 'settled' ? 0 : 10000,
    key: `${filterKey}|${page}`,
  });

  const rows = (data?.rows ?? []).filter((b) => (tab === 'settled' ? !b.isOpen : true));
  const pages = Number(data?.pagination?.total_pages) || 0;

  const sideOption = SIDES.find((o) => o.value === side);

  return (
    <ExchangeAccountPage title="My Bets">
      <div className="rounded-xl bg-layer4 px-4 pb-4 lg:px-8">
        <MarketFilterTabs className="pt-2" tabs={TABS} active={tab} onChange={setTab} />
        <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-2 py-3 sm:grid-cols-[10rem_minmax(0,1fr)] [&>button]:bg-input_bright">
          <Select title="Side" value={sideOption} options={SIDES} onChange={(o) => setSide(o.value)}>
            {(o) => <div className="ellipsis w-0 flex-auto text-left">{o.label}</div>}
          </Select>
          <Input value={draft} onChange={setDraft} placeholder="Search event, runner or market" required={false} />
        </div>

        {data === undefined ? (
          error ? (
            <div className="flex flex-col items-center gap-3 py-10 text-center" role="alert">
              <p className="text-sm text-tertiary">
                {error.status === 401
                  ? 'Please sign in again.'
                  : error.status === 429
                    ? 'Too many requests — retrying shortly…'
                    : 'Bets could not be loaded.'}
              </p>
              {error.status !== 401 && (
                <button type="button" className="button button-second h-8 px-3" onClick={refresh}>
                  Retry
                </button>
              )}
            </div>
          ) : (
            <SkeletonBetRows rows={5} />
          )
        ) : rows.length === 0 ? (
          <EmptyPlaceholder>
            {tab === 'settled' ? 'No settled bets' : 'No matched bets'}
          </EmptyPlaceholder>
        ) : (
          <>
            {data.pagination?.total_stake != null && tab !== 'settled' && (
              <p className="pb-1 text-xs text-tertiary">
                {data.pagination.total} bets · total stake{' '}
                <span className="font-extrabold text-primary">{money(data.pagination.total_stake)}</span>
              </p>
            )}
            {rows.map((bet) => (
              <BetRow key={bet.id} bet={bet} tab={tab} />
            ))}
          </>
        )}

        <Pagination page={page} pages={pages} onChange={(p) => setPageState({ key: filterKey, page: p })} />
      </div>
    </ExchangeAccountPage>
  );
}
