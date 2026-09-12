import { useLastBetsByGame } from '@/queries/live';
import { walletBalance } from '@/lib/format';
import { currencyMeta } from '@/data/currencies';
import { cn } from '@/lib/cn';

/**
 * Everyone's recent rounds on one game — `LAST_BETS_BY_GAME`, public.
 *
 * ## Why this is on the game page and the ticker is not
 *
 * The home ticker shows WINS, because a lobby strip of strangers' losses is a
 * different and rather bleak feature. This shows everything the feed answers,
 * losses included, because on a game page that is the honest picture: a table
 * of nothing but wins beside a Play button reads as a claim about the game.
 * Same event, same rows, opposite filter, and the reason is the surface rather
 * than the data.
 *
 * ## The game key, not the slug
 *
 * `game` is the ENGINE key from `parameters.event` — `limbo`, not
 * `limbo-original` and not `Limbo`. An unknown key answers an empty list with
 * no error anywhere (see `queries/live.js`), so this renders only for a game
 * `isPlayable` has already vouched for; anything else would be a permanently
 * empty panel that looks like a quiet game.
 *
 * ## Nothing, rather than an empty table
 *
 * A game nobody has played yet, or a feed that failed, both render as no
 * panel. The Play button above it is the point of the page and an error block
 * under it would be the loudest thing there — the same call `ProviderRail` and
 * `LatestWins` make.
 */
export function RecentRounds({ game, title }) {
  const { data, isError } = useLastBetsByGame(game);
  const rows = data ?? [];

  if (isError || rows.length === 0) return null;

  return (
    <section className="mt-6">
      <h2 className="font-secondary text-lg font-medium text-bulma">
        Recent rounds{title ? ` on ${title}` : ''}
      </h2>

      {/* The table scrolls inside itself rather than widening the page — four
          columns of numbers do not fit a phone, and a horizontally scrolling
          document is a worse answer than a horizontally scrolling table. */}
      <div className="mt-3 overflow-x-auto rounded-i-md bg-gohan">
        <table className="w-full min-w-[420px] text-sm">
          <thead>
            <tr className="text-xs text-trunks">
              <Th className="text-start">Player</Th>
              <Th className="text-end">Bet</Th>
              <Th className="text-end">Profit</Th>
              <Th className="text-end">When</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const meta = currencyMeta(row.currency);
              const betBalance = walletBalance(row.amount, meta);
              const profitBalance = walletBalance(row.profit, meta);
              return (
                <tr key={row.key} className="border-t border-beerus">
                  <Td className="max-w-[160px] truncate text-start text-bulma">{row.player}</Td>
                  <Td className="text-end tabular-nums text-trunks">
                    {betBalance.amount} {betBalance.unit ?? row.currency}
                  </Td>
                  {/**
                   * The sign comes off the STRING, not off arithmetic.
                   *
                   * `profit` is a `NUMERIC(30,8)` decimal string and
                   * `walletBalance` formats it without ever calling `Number`.
                   * A loss already carries its own `-`, so only a win needs a
                   * sign added — printing `+-10` is what happens when the
                   * prefix is unconditional.
                   */}
                  <Td
                    className={cn(
                      'text-end font-medium tabular-nums',
                      row.won ? 'text-roshi' : 'text-trunks',
                    )}
                  >
                    {row.won ? '+' : ''}
                    {profitBalance.amount} {profitBalance.unit ?? row.currency}
                  </Td>
                  <Td className="text-end text-xs text-trunks">{when(row.at)}</Td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Th({ children, className }) {
  return <th className={cn('px-3 py-2 font-medium', className)}>{children}</th>;
}

function Td({ children, className }) {
  return <td className={cn('px-3 py-2', className)}>{children}</td>;
}

/**
 * `12s`, `4m`, `3h`, then the date.
 *
 * A relative age rather than a clock time: the row's value is how recent it
 * is, and `13:42` requires the reader to know what time it is now. Past a day
 * the relative form stops helping ("31h" means nothing), so it becomes a date.
 *
 * An unparseable or absent timestamp renders as an em dash rather than
 * `Invalid Date`, which is what `toLocale*` prints for one.
 */
function when(iso) {
  const at = iso ? new Date(iso).getTime() : NaN;
  if (!Number.isFinite(at)) return '—';

  const seconds = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h`;

  return new Date(at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
