import { useState } from 'react';
import { useLastBets, useTopWinners } from '@/queries/live';
import { walletBalance } from '@/lib/format';
import { currencyMeta } from '@/data/currencies';
import { cn } from '@/lib/cn';
import { Rail } from './Rail';

/**
 * The live wins ticker — `LAST_BETS` and `TOP_WINNERS`, both public socket
 * events on user-service.
 *
 * ## Two lists, and they are genuinely two lists
 *
 * `Latest` is the feed in time order; `Biggest` is the same rounds ordered by
 * profit. Neither is derivable from the other from here, because each is
 * twenty rows off a much longer table — the biggest win of the day is very
 * unlikely to be in the twenty most recent, and sorting the recent twenty by
 * profit would produce a "biggest wins" list that is really "the best of the
 * last few minutes". Two events, two reads.
 *
 * Both are polled rather than pushed: the platform answers these on request
 * and broadcasts nothing on them. `queries/live.js` holds the interval and the
 * rate-limit backoff.
 *
 * ## It renders nothing until somebody wins
 *
 * A ticker with no wins in it is not a failure state and not something to fill
 * with plausible numbers, so the section simply is not there. It appears on
 * its own the first time a round settles in profit.
 *
 * A failure is treated the same way, and for the same reason `ProviderRail`
 * does: this is ambient colour on a lobby page, and an alert where a ticker
 * should be draws far more attention to the outage than a missing strip does.
 * That includes a socket that cannot connect at all — a signed-out visitor
 * whose network blocks websockets still gets a working home page, just a
 * quieter one.
 *
 * ## Money is a string, and stays one
 *
 * `amount` and `profit` are decimal strings off a `NUMERIC` column.
 * `walletBalance` formats them without ever calling `Number`, and truncates to
 * the currency's display precision rather than rounding — rounding a win up
 * would state a payout larger than the one that was made.
 */

const TABS = [
  { id: 'latest', label: 'Latest' },
  { id: 'biggest', label: 'Biggest' },
];

export function LatestWins() {
  const [tab, setTab] = useState('latest');

  /**
   * Both feeds are read, and only one is shown.
   *
   * The alternative — `enabled: tab === …` — makes the first press of the
   * other tab a cold fetch with an empty rail under it, on a strip whose whole
   * job is ambient movement. Two twenty-row reads on a twenty-second poll is
   * well inside the public bucket's forty-per-ten-seconds, so the cost of
   * keeping both warm is a socket message the connection was already open for.
   */
  const latest = useLastBets();
  const biggest = useTopWinners();

  const active = tab === 'biggest' ? biggest : latest;

  /**
   * Wins only, on both tabs.
   *
   * `LAST_BETS` is every settled round — the losses are in it too, because
   * `LAST_BETS_BY_GAME` on a game page wants them. A "latest wins" strip that
   * listed somebody's losing spins would be a different feature, and a rather
   * hostile one, so the filter is here rather than in the query: the same
   * rows, unfiltered, are what `RecentRounds` renders on a game page.
   */
  const rows = (active.data ?? []).filter((row) => row.won);

  if (active.isError || rows.length === 0) return null;

  return (
    <Rail
      title="Live wins"
      action={
        <div className="flex shrink-0 items-center gap-1 rounded-i-md bg-gohan p-0.5">
          {TABS.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setTab(option.id)}
              aria-pressed={tab === option.id}
              className={cn(
                'rounded-i-sm px-2.5 py-1 text-xs font-medium transition-colors',
                tab === option.id
                  ? 'bg-goku text-bulma'
                  : 'text-trunks hover:text-bulma',
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      }
    >
      {rows.map((row) => (
        <WinCard key={row.key} win={row} />
      ))}
    </Rail>
  );
}

/**
 * One row of the ticker.
 *
 * The player's name is the reason this reads the socket feed rather than
 * `GET /casino/bet-history/live`, which carries no identity — see the note at
 * the top of `queries/live.js`. It is a display name the player chose and the
 * platform already shows on its own leaderboards; nothing else about them is
 * on the wire, and nothing else is rendered.
 */
function WinCard({ win }) {
  const meta = currencyMeta(win.currency);
  const balance = walletBalance(win.profit, meta);

  return (
    <div className="flex w-[168px] shrink-0 flex-col gap-1 rounded-i-md bg-gohan px-3 py-2.5">
      <span className="truncate text-xs font-medium text-bulma" title={win.game}>
        {win.game}
      </span>
      <span className="truncate text-[11px] text-trunks" title={win.player}>
        {win.player}
      </span>
      <span className="flex items-baseline gap-1">
        <span className="font-secondary text-sm font-bold text-roshi tabular-nums">
          +{balance.amount}
        </span>
        <span className="text-[11px] text-trunks">{balance.unit ?? win.currency}</span>
      </span>
    </div>
  );
}
