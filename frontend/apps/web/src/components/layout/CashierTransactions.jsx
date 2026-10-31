import { useEffect, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '@/components/ui/Icon';
import { Skeleton } from '@/components/ui/Skeleton';
import { QueryError } from '@/components/ui/QueryState';
import { CoinMark } from './WalletMenu';
import { useTransactionHistory, useTransfers } from '@/queries';
import { formatBalance } from '@/lib/format';
import { currencyMeta } from '@/data/currencies';
import { cn } from '@/lib/cn';

/**
 * The in-drawer transactions screen the reference's `Recent transactions` row
 * opens — `cashier_transactions`, the sheet that covers the wallet drawer.
 *
 * It goes back to the account landing (`home_configuration`) with the headers
 * the reference gives it:
 *
 *   54px step header, back action at the start, `Transaction history` in the
 *   middle and the settings gear at the end — the back button is how a player
 *   finds their way home, the gear is the same `/profile/settings` the landing
 *   row already uses.
 *
 * The list merges the combined history (`GET /user/history`, deposits and
 * withdrawals across all seven rails) with player-to-player transfers
 * (`GET /user/history/transfers`) into one date-sorted feed, as a wallet's
 * "history" should read as a single story rather than three tabs. Transfers
 * are drawn with the `gift` mark where a payment has the rail's coin, because
 * a tip carries no currency of its own.
 */

const PAGE = 25;

/** The seven rails spell the same state many ways; three buckets read the same. */
function statusTone(value) {
  const text = String(value ?? '').toLowerCase();
  if (['completed', 'approved', 'success', 'confirmed', 'paid'].includes(text)) {
    return 'bg-roshi/15 text-roshi';
  }
  if (['rejected', 'failed', 'cancelled', 'canceled', 'expired'].includes(text)) {
    return 'bg-dodoria/15 text-dodoria';
  }
  return 'bg-beerus text-trunks';
}

function StatusPill({ status }) {
  const value = String(status ?? '').toLowerCase();
  return (
    <span
      className={cn(
        'inline-block rounded-i-xs px-2 py-0.5 text-xs font-medium capitalize',
        statusTone(value),
      )}
    >
      {value || 'unknown'}
    </span>
  );
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

/** `apay` -> `A-Pay`. The rails name themselves in snake_case. */
function label(value) {
  if (!value) return 'Unknown';
  return String(value)
    .split(/[_-]/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/** A deposit or withdrawal, normalised to the shape one feed can hold. */
function paymentRow(kind, row) {
  return {
    key: `${kind}-${row.method ?? row.type ?? 'row'}-${row.id ?? row.transactionId ?? 'row'}`,
    icon: row.currency ?? null,
    title: label(row.method ?? row.type) || kind,
    date: row.date ?? row.createdAt,
    amount: row.amount ?? '0',
    status: row.status ?? null,
  };
}

/**
 * A player-to-player tip. The transfers endpoint gives it no currency, so it
 * is drawn with the `gift` disc rather than a coin the platform cannot name.
 */
function transferRow(row) {
  return {
    key: `transfer-${row.id ?? 'row'}`,
    icon: null,
    title: row.direction === 'credit' ? 'Transfer received' : 'Transfer sent',
    date: row.createdAt,
    amount: row.amount ?? '0',
    status: null,
  };
}

export function CashierTransactions({ onBack, onSettings }) {
  const combined = useTransactionHistory({ limit: PAGE, offset: 0 });
  const transfers = useTransfers({ limit: PAGE, offset: 0 });
  const backRef = useRef(null);

  useEffect(() => {
    backRef.current?.focus();
  }, []);

  const pending = combined.isPending || transfers.isPending;
  const error = combined.error ?? transfers.error;
  const isError = combined.isError || transfers.isError;

  const rows = useMemo(() => {
    const deposits = (combined.data?.deposits?.rows ?? []).map((row) =>
      paymentRow('deposit', row),
    );
    const withdrawals = (combined.data?.withdrawals?.rows ?? []).map((row) =>
      paymentRow('withdrawal', row),
    );
    const tips = (transfers.data ?? []).map(transferRow);
    return [...deposits, ...withdrawals, ...tips].sort(
      (a, b) => new Date(b.date ?? 0) - new Date(a.date ?? 0),
    );
  }, [combined.data, transfers.data]);

  return (
    <div
      data-testid="cashier_transactions"
      className="absolute inset-0 z-10 flex h-full w-full animate-sheet-in flex-col bg-gohan text-bulma"
    >
      {/* The step header: back at the start, the title in the middle, the
          settings gear at the end — the reference's own order. */}
      <div className="flex h-[54px] shrink-0 items-center justify-between px-2">
        <button
          type="button"
          ref={backRef}
          onClick={onBack}
          aria-label="Back to wallet"
          data-testid="back_action"
          className="grid size-10 cursor-pointer place-items-center rounded-i-sm border-[0.8px] border-beerus text-bulma transition-colors hover:bg-heles"
        >
          <Icon name="chevron-left" size={20} />
        </button>

        <span className="text-base font-medium">Transaction history</span>

        <Link
          to="/profile/settings"
          onClick={onSettings}
          aria-label="Wallet settings"
          data-testid="settings_action"
          className="grid size-10 cursor-pointer place-items-center rounded-i-sm border-[0.8px] border-beerus text-bulma transition-colors hover:bg-heles"
        >
          <Icon name="cog" size={20} />
        </Link>
      </div>

      <div className="min-h-0 flex-1 overflow-y-scroll px-4 pb-8">
        {pending ? (
          <div className="grid gap-2">
            {[0, 1, 2, 3, 4].map((skeleton) => (
              <Skeleton key={skeleton} className="h-14 rounded-i-md" />
            ))}
          </div>
        ) : isError ? (
          <QueryError
            error={error}
            onRetry={() => {
              combined.refetch();
              transfers.refetch();
            }}
            title="Could not load your transactions"
          />
        ) : rows.length === 0 ? (
          <div
            data-testid="cashier_transactions_list"
            className="flex h-[calc(100vh_-_15rem)] flex-col items-center justify-center gap-4 px-6 text-center"
          >
            <div className="grid size-12 place-items-center rounded-full bg-beerus">
              <Icon name="clock" size={22} className="text-trunks" />
            </div>
            <span className="max-w-[260px] text-sm leading-relaxed text-trunks">
              No transaction in your history to display yet
            </span>
          </div>
        ) : (
          <div data-testid="cashier_transactions_list" className="grid gap-2">
            {rows.map((row) => (
              <Row key={row.key} row={row} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ row }) {
  const unresolved = Boolean(row.icon) && /^\d+$/.test(row.icon);
  const decimals = currencyMeta(row.icon ?? 'USDT').decimals;

  return (
    <div className="flex min-h-14 items-center gap-2 rounded-i-md bg-goku p-2">
      {row.icon ? (
        <CoinMark code={row.icon} size={36} />
      ) : (
        <span
          className="grid size-9 shrink-0 place-items-center rounded-full bg-heles text-trunks"
          aria-hidden="true"
        >
          <Icon name="gift" size={18} />
        </span>
      )}

      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-bulma">
          {row.title}
        </span>
        <span className="block text-xs text-trunks tabular-nums">
          {formatDate(row.date)}
        </span>
      </span>

      <span className="shrink-0 text-end">
        <span className="block text-sm font-medium text-bulma tabular-nums">
          {formatBalance(row.amount, decimals)}{' '}
          {unresolved ? (
            <span
              className="text-trunks"
              title={`The platform has no ticker for provider coin ${row.icon}. Set CCPAYMENT_COIN_IDS to resolve it.`}
            >
              coin #{row.icon}
            </span>
          ) : (
            (row.icon ?? '')
          )}
        </span>
        {row.status && <StatusPill status={row.status} />}
      </span>
    </div>
  );
}