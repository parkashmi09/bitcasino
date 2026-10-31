import React from 'react';
import { SkeletonBetRows, formatAmount, formatStartTime } from '../../../components/exchange';
import { IconArrow } from '../../../components/exchange/icons';
import { Select } from '../../../components/exchange/site';
import { Input } from '../../../components/exchange/site';
import { EmptyPlaceholder } from '../../../components/exchange/site';
import { Pagination } from '../../../components/exchange/site';
import { usePolling, useExchangeCurrency } from '../../../hooks/exchange';
import { getAccountStatement } from '../../../services/exchange';
import { ExchangeAccountPage } from '../ExchangeFrame';
import { defaultStatementRange, statementRangeError } from '../model';
import MarketBetsDialog from './MarketBetsDialog';

/* `reportType` is the server's own enum (UserStatementController: ALL | TRANSACTION | SPORTS). */
const REPORTS = [
  { value: 'ALL', label: 'All' },
  { value: 'SPORTS', label: 'Sports' },
  { value: 'TRANSACTION', label: 'Transactions' },
];
const PAGE_SIZE = 25;

/* credit / debit / closing arrive as 2-dp strings, '-' when empty. */
const amount = (v) => (v == null || v === '-' || v === '' ? null : Number(v));
const opensResult = (r) => r.category === 'SPORTS' && r.matchId != null && r.eventId != null;

function StatementRow({ row, onOpen }) {
  // INR from mssports, printed in the header wallet's coin (utils/exchange/stakeCurrency.js).
  const cur = useExchangeCurrency();
  const fmt = cur.isInr ? formatAmount : cur.formatInr;
  const credit = amount(row.credit);
  const debit = amount(row.debit);
  const closing = amount(row.closing);
  const clickable = Boolean(onOpen);

  const body = (
    <>
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 text-sm font-semibold text-primary">{row.description || '—'}</p>
        <p className="mt-0.5 text-xs text-tertiary">{row.date ? formatStartTime(row.date) : ''}</p>
      </div>
      <div className="flex-none text-right text-xs leading-5">
        {credit != null && credit !== 0 ? (
          <p className="font-extrabold text-success">+{fmt(credit)}</p>
        ) : debit != null && debit !== 0 ? (
          <p className="font-extrabold text-error">−{fmt(debit)}</p>
        ) : (
          <p className="text-secondary">{fmt(credit ?? 0)}</p>
        )}
        <p className="text-tertiary">
          Bal <span className="text-secondary">{closing != null ? fmt(closing) : '—'}</span>
        </p>
      </div>
      {clickable && <IconArrow className="size-4 flex-none rotate-180 self-center fill-secondary" />}
    </>
  );

  const cls = 'flex w-full items-start gap-3 border-b border-third py-3 text-left';
  return clickable ? (
    <button type="button" className={`${cls} btn-like`} onClick={() => onOpen(row)}>
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/**
 * `/sports/statement` — the exchange account statement (`POST account-statement-v2`): a date
 * range of at most 31 days (checked here before the server's own 400), All / Sports /
 * Transactions, 25 a page. A sports row opens its market's result (`MarketBetsDialog`).
 */
export default function ExchangeStatement() {
  const [range, setRange] = React.useState(defaultStatementRange);
  const [report, setReport] = React.useState('ALL');
  const [open, setOpen] = React.useState(null);

  const rangeError = statementRangeError(range.from, range.to);
  const filterKey = `${range.from}|${range.to}|${report}`;
  const [pageState, setPageState] = React.useState({ key: filterKey, page: 1 });
  const page = pageState.key === filterKey ? pageState.page : 1;

  const fetcher = React.useCallback(
    () => getAccountStatement({ fromDate: range.from, toDate: range.to, reportType: report, page, limit: PAGE_SIZE }),
    [range.from, range.to, report, page],
  );
  const { data, error } = usePolling(fetcher, { key: `${filterKey}|${page}`, enabled: !rangeError });

  const closeDialog = React.useCallback(() => setOpen(null), []);
  const reportOption = REPORTS.find((o) => o.value === report);

  return (
    <ExchangeAccountPage title="Statement">
      <div className="rounded-xl bg-layer4 px-4 pb-4 lg:px-8">
        <div className="grid grid-cols-2 gap-2 py-4 sm:grid-cols-3 [&>button]:bg-input_bright">
          <label className="block min-w-0">
            <span className="mb-1 block text-xs text-tertiary">From</span>
            <Input
              type="date"
              value={range.from}
              onChange={(from) => setRange((r) => ({ ...r, from }))}
              required={false}
            />
          </label>
          <label className="block min-w-0">
            <span className="mb-1 block text-xs text-tertiary">To</span>
            <Input type="date" value={range.to} onChange={(to) => setRange((r) => ({ ...r, to }))} required={false} />
          </label>
          <div className="col-span-2 min-w-0 sm:col-auto">
            <span className="mb-1 block text-xs text-tertiary">Type</span>
            <Select title="Report type" value={reportOption} options={REPORTS} onChange={(o) => setReport(o.value)}>
              {(o) => <div className="ellipsis w-0 flex-auto text-left">{o.label}</div>}
            </Select>
          </div>
        </div>

        {rangeError ? (
          <p role="alert" className="py-10 text-center text-sm text-error">
            {rangeError}
          </p>
        ) : data === undefined ? (
          error ? (
            <p className="py-10 text-center text-sm text-tertiary">
              {error.status === 401 ? 'Please sign in again.' : error.message || 'The statement could not be loaded.'}
            </p>
          ) : (
            <SkeletonBetRows rows={6} accent={false} />
          )
        ) : data.rows.length === 0 ? (
          <EmptyPlaceholder>No entries in this period</EmptyPlaceholder>
        ) : (
          data.rows.map((row, i) => (
            <StatementRow
              key={`${row.date}|${row.betId ?? ''}|${i}`}
              row={row}
              onOpen={opensResult(row) ? setOpen : undefined}
            />
          ))
        )}

        {!rangeError && (
          <Pagination page={page} pages={data?.totalPages ?? 0} onChange={(p) => setPageState({ key: filterKey, page: p })} />
        )}
      </div>
      {open && <MarketBetsDialog row={open} onClose={closeDialog} />}
    </ExchangeAccountPage>
  );
}
