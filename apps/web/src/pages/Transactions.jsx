import { useState } from 'react';
import { Skeleton } from '@/components/ui/Skeleton';
import { QueryError } from '@/components/ui/QueryState';
import { useTransactionHistory, useTransfers } from '@/queries';
import { formatBalance } from '@/lib/format';
import { currencyMeta } from '@/data/currencies';
import { cn } from '@/lib/cn';

/**
 * `/profile/transactions` — every movement of money on the account.
 *
 * The screen `docs/10` lists under both Phase 4 ("a transactions page over the
 * ledger is still ahead") and Phase 6. This is it.
 *
 * ## Three tabs, because the platform genuinely has three answers
 *
 * `GET /user/history` answers `{deposits: {count, rows}, withdrawals: {count,
 * rows}}` — two separately-counted sides rather than one list, because they
 * are merged from different tables and no single total would mean anything.
 * Transfers are a third call: a player-to-player tip is neither a deposit nor
 * a withdrawal and the combined endpoint has no rail for it.
 *
 * So the tabs are not a filter over one dataset. Each is its own shape, and
 * flattening them into one table would need a `kind` column that says the
 * same thing the tab already does.
 *
 * ## What a row actually contains
 *
 * The seven payment rails spell the same state four different ways, so the
 * server normalises `status` before it leaves — `method` is what says which
 * rail a row came from. Both are printed, because "pending" alone does not
 * tell a player whether to check their bank or a block explorer.
 *
 * **Amounts are decimal strings and are formatted, never parsed.** Same rule
 * as the wallet: `formatBalance` groups the digits without calling `Number`.
 *
 * ## Paging is offset-based and the offset is capped
 *
 * `limit`/`offset`, not page/limit — and the server caps `offset` at 10,000,
 * because the combined read pulls `offset + limit` rows from each of seven
 * tables to know which survive the sort. The pager below is Previous/Next
 * rather than numbered pages: `count` is per-side, so there is no single
 * total to divide into pages that would be honest for the view as a whole.
 */

const TABS = [
  { id: 'deposits', label: 'Deposits' },
  { id: 'withdrawals', label: 'Withdrawals' },
  { id: 'transfers', label: 'Transfers' },
];

const PAGE = 25;

export function Transactions() {
  const [tab, setTab] = useState('deposits');
  const [page, setPage] = useState(0);

  const offset = page * PAGE;

  const combined = useTransactionHistory({
    limit: PAGE,
    offset,
    enabled: tab !== 'transfers',
  });
  const transfers = useTransfers({
    limit: PAGE,
    offset,
    enabled: tab === 'transfers',
  });

  const active = tab === 'transfers' ? transfers : combined;

  const rows =
    tab === 'transfers'
      ? (transfers.data ?? [])
      : (combined.data?.[tab]?.rows ?? []);

  const count =
    tab === 'transfers' ? undefined : combined.data?.[tab]?.count;

  const select = (next) => {
    setTab(next);
    // The offset belongs to the list being read, and the three have different
    // lengths — staying on page 4 while switching to a tab with six rows
    // shows an empty table that looks like an error.
    setPage(0);
  };

  return (
    <div className="grid gap-2 pt-2">
      <h1 className="font-primary text-2xl font-normal tracking-normal text-bulma">
        Transactions
      </h1>

      <div
        role="tablist"
        aria-label="Transaction type"
        className="flex gap-1 overflow-x-auto rounded-i-md bg-gohan p-1"
      >
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            aria-selected={tab === entry.id}
            onClick={() => select(entry.id)}
            className={cn(
              'h-9 shrink-0 cursor-pointer rounded-i-sm px-4 text-sm font-medium transition-colors',
              tab === entry.id
                ? 'bg-goku text-bulma'
                : 'text-trunks hover:bg-heles hover:text-bulma',
            )}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <section className="rounded-i-md bg-gohan p-4">
        {active.isPending ? (
          <div className="grid gap-2">
            {[0, 1, 2, 3, 4].map((row) => (
              <Skeleton key={row} className="h-14 rounded-i-sm" />
            ))}
          </div>
        ) : active.isError ? (
          <QueryError
            error={active.error}
            onRetry={active.refetch}
            title="Could not load your transactions"
          />
        ) : rows.length === 0 ? (
          <Empty tab={tab} paged={page > 0} onBack={() => setPage(0)} />
        ) : (
          <>
            {/* The table scrolls inside itself rather than pushing the page
                sideways — five columns do not fit a phone and a horizontally
                scrolling document is worse than a horizontally scrolling
                table. */}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] border-collapse text-sm">
                <thead>
                  <tr className="text-start text-xs text-trunks">
                    <Th>Date</Th>
                    <Th>Method</Th>
                    <Th align="end">Amount</Th>
                    <Th>Status</Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, index) => (
                    <Row key={rowKey(row, index)} row={row} />
                  ))}
                </tbody>
              </table>
            </div>

            <Pager
              page={page}
              rows={rows.length}
              count={count}
              onChange={setPage}
            />
          </>
        )}
      </section>
    </div>
  );
}

/**
 * A row's key.
 *
 * `id` is unique WITHIN a rail and the combined list merges seven of them, so
 * two rows can legitimately share one. The rail is part of the key for that
 * reason, and the index is the last resort for a rail that reports neither.
 */
function rowKey(row, index) {
  return `${row.method ?? row.type ?? 'row'}-${row.id ?? row.transactionId ?? index}`;
}

function Row({ row }) {
  const currency = row.currency ?? null;

  /**
   * ═════════════════════════════════════════════════════════════════════
   * A CRYPTO DEPOSIT'S CURRENCY MAY NOT BE A TICKER AT ALL.
   *
   * `ccdeposit` stores CCPayment's own numeric `coinid`, and the server
   * resolves it through `CCPAYMENT_COIN_IDS` — a config map that is **unset
   * on this deployment**. `ccpaymentTicker` then returns null and the service
   * falls back to `String(coinId)`, so the row arrives with
   * `currency: "1280"`.
   *
   * Printing that beside the amount reads as part of the number. Guessing
   * USDT would be worse: it is a claim about which asset moved, made from no
   * information. So an unresolved id is drawn as what it is — the provider's
   * coin id, marked — and the row stays truthful about what the platform can
   * and cannot say. Setting `CCPAYMENT_COIN_IDS` in `backend/.env` is what
   * turns these into tickers.
   * ═════════════════════════════════════════════════════════════════════
   */
  const unresolved = Boolean(currency) && /^\d+$/.test(currency);
  const decimals = currencyMeta(currency ?? 'USDT').decimals;

  return (
    <tr className="border-t border-beerus">
      <Td>
        <span className="whitespace-nowrap text-trunks tabular-nums">
          {formatDate(row.date ?? row.createdAt)}
        </span>
      </Td>
      <Td>
        <span className="text-bulma">{label(row.method ?? row.type)}</span>
      </Td>
      <Td align="end">
        <span className="whitespace-nowrap text-bulma tabular-nums">
          {formatBalance(row.amount ?? '0', decimals)}{' '}
          {unresolved ? (
            <span
              className="text-trunks"
              title={`The platform has no ticker for provider coin ${currency}. Set CCPAYMENT_COIN_IDS to resolve it.`}
            >
              coin #{currency}
            </span>
          ) : (
            (currency ?? '')
          )}
        </span>
      </Td>
      <Td>
        <StatusPill status={row.status} />
      </Td>
    </tr>
  );
}

/**
 * The normalised status, coloured by what it means for the player.
 *
 * Three buckets rather than one colour per string: the rails between them
 * produce more spellings than a palette should carry, and "is my money
 * moving, has it arrived, or did it fail" is the whole question.
 */
function StatusPill({ status }) {
  const value = String(status ?? '').toLowerCase();

  const tone = ['completed', 'approved', 'success', 'confirmed', 'paid'].includes(value)
    ? 'bg-roshi/15 text-roshi'
    : ['rejected', 'failed', 'cancelled', 'canceled', 'expired'].includes(value)
      ? 'bg-dodoria/15 text-dodoria'
      : 'bg-beerus text-trunks';

  return (
    <span
      className={cn('inline-block rounded-i-xs px-2 py-0.5 text-xs font-medium capitalize', tone)}
    >
      {value || 'unknown'}
    </span>
  );
}

function Empty({ tab, paged, onBack }) {
  // A page past the end is not the same as an empty history, and offering
  // "back to the first page" is the only useful thing to say about it.
  if (paged) {
    return (
      <div className="grid justify-items-center gap-2 py-10 text-center">
        <p className="text-sm text-trunks">Nothing on this page.</p>
        <button
          type="button"
          onClick={onBack}
          className="cursor-pointer text-sm font-medium text-piccolo hover:underline"
        >
          Back to the first page
        </button>
      </div>
    );
  }

  return (
    <div className="grid justify-items-center gap-2 py-10 text-center">
      <p className="text-sm text-bulma">No {tab} yet.</p>
      <p className="max-w-[380px] text-xs leading-relaxed text-trunks">
        {tab === 'transfers'
          ? 'Tips you send or receive from other players appear here.'
          : `Your ${tab} will appear here once you have made one.`}
      </p>
    </div>
  );
}

/**
 * Previous / Next, not numbered pages.
 *
 * `count` is per-side on the combined read and absent on transfers, so there
 * is no total to divide into pages that would be honest across all three
 * tabs. A short page is the end of the list; that is what disables Next.
 */
function Pager({ page, rows, count, onChange }) {
  const last = rows < PAGE || (count !== undefined && (page + 1) * PAGE >= count);

  if (page === 0 && last) return null;

  return (
    <div className="mt-3 flex items-center justify-between gap-3 border-t border-beerus pt-3">
      <span className="text-xs text-trunks tabular-nums">
        {page * PAGE + 1}–{page * PAGE + rows}
        {count !== undefined && ` of ${count}`}
      </span>
      <div className="flex gap-2">
        <PagerButton disabled={page === 0} onClick={() => onChange(page - 1)}>
          Previous
        </PagerButton>
        <PagerButton disabled={last} onClick={() => onChange(page + 1)}>
          Next
        </PagerButton>
      </div>
    </div>
  );
}

function PagerButton({ disabled, onClick, children }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="cursor-pointer rounded-i-sm bg-beerus px-3 py-1.5 text-xs font-medium text-bulma transition-colors hover:bg-trunks/20 disabled:cursor-default disabled:opacity-40"
    >
      {children}
    </button>
  );
}

/**
 * `pe-3` matches `Td`. Without it the header row is the one place the columns
 * do not line up — `Amount` and `Status` ran together as "AmountStatus",
 * because the cells below carried the gap and the headers did not.
 */
function Th({ children, align }) {
  return (
    <th
      scope="col"
      className={cn('pb-2 pe-3 font-medium', align === 'end' ? 'text-end' : 'text-start')}
    >
      {children}
    </th>
  );
}

function Td({ children, align }) {
  return (
    <td className={cn('py-3 pe-3', align === 'end' && 'text-end')}>{children}</td>
  );
}

/** `apay` -> `A-Pay`, `crypto` -> `Crypto`. The rails name themselves in snake. */
function label(value) {
  if (!value) return 'Unknown';
  return String(value)
    .split(/[_-]/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}
