import { useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { Skeleton } from '@/components/ui/Skeleton';
import { IN_HOUSE_EVENTS, useBetHistory, usePlayRound } from '@/queries';
import { useBalances, useDisplayCurrency } from '@/hooks/useWallet';
import { compareDecimal, formatBalance, percentOf } from '@/lib/format';
import { currencyMeta } from '@/data/currencies';

/**
 * Limbo — the first in-house original wired to the real engine.
 *
 * One message in (`{coin, amount, payout}`), one settled round back. The
 * stake is debited, the result drawn and the payout credited in a single
 * transaction on casino-service, so the reply already carries the new balance
 * and there is nothing to poll for.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * WHAT THIS SCREEN DOES NOT CLAIM
 *
 * **It never says "provably fair", and the hash is not offered as proof.**
 * The backend's own generator says why, in
 * `in-house/engine/hash.js`: `makeHash()` takes no player input and is drawn
 * at the same moment as the result rather than published beforehand, so there
 * is no commitment to verify anything against. Its seed is `Math.random()`,
 * which is xorshift128+ and not cryptographically secure. The hash is shown
 * because it is the round's identifier in `bets.hash` and a support ticket
 * names it — that is all it is, and that is what the label says.
 *
 * **It does not print a house/player edge beyond the multiplier curve.**
 * `GameEngine.canProfit` reads the `house` table before every round, and when
 * the house is over its configured maximum Limbo *re-rolls any result that
 * would have beaten the player's target* until one does not. The player
 * cannot win while that is true, and nothing on the wire tells this client
 * whether it is. Printing a win chance that ignores it would be a claim we
 * cannot support; the figure below is labelled as what it is — the
 * multiplier curve — and nothing more.
 * ═════════════════════════════════════════════════════════════════════════
 *
 * The 2% house edge is taken from the STAKE on settlement, not from the
 * multiplier: a win at 2.00× on a 10 stake returns 19.80, not 20. That is
 * `HOUSE_EDGE_PERCENT` in `inHouse.constants.js` and it is why the payout
 * preview below subtracts it rather than showing `stake × payout`.
 */

/** The module's own floor: `limbo.js` returns null below this, twice. */
const MIN_PAYOUT = 1.01;

/**
 * The house edge, from `inHouse.constants.js`. Duplicated here only to PREVIEW
 * the payout — the server's figure is the one that moves, and the round reply
 * carries the balance it produced.
 */
const HOUSE_EDGE_PERCENT = 2;

export function LimboGame({ game }) {
  const [currency] = useDisplayCurrency();
  const { balances, status: walletStatus } = useBalances();
  const round = usePlayRound(IN_HOUSE_EVENTS[game.event]);

  const [stake, setStake] = useState('10');
  const [payout, setPayout] = useState('2.00');

  const decimals = currencyMeta(currency).decimals;
  const balance = balances[currency] ?? '0';

  const target = Number(payout);
  const validPayout = Number.isFinite(target) && target >= MIN_PAYOUT;
  const staked = /[1-9]/.test(stake || '');
  const overBalance = compareDecimal(stake || '0', balance) > 0;
  const ready = staked && validPayout && !overBalance && !round.isPending;

  /**
   * What a win returns, by the server's own formula:
   * `profit + (stake - houseCut)` where `profit = stake × target - stake`.
   * All of it on the digit string — a stake is `NUMERIC(30,8)` and a float
   * cannot carry one.
   */
  const winReturn = validPayout && staked
    ? percentOf(stake, Math.round(target * 100) - HOUSE_EDGE_PERCENT, decimals)
    : null;

  const result = round.data ?? null;

  const submit = () => {
    round.reset();
    round.mutate({ coin: currency, amount: stake, payout: target.toFixed(2) });
  };

  return (
    <div className="grid gap-3 lg:grid-cols-[300px_1fr]">
      <div className="grid content-start gap-3 rounded-s-md bg-gohan p-4">
        <Field label="Bet amount" hint={walletStatus === 'loading' ? undefined : `${formatBalance(balance, decimals)} ${currency}`}>
          <input
            value={stake}
            onChange={(event) => setStake(sanitiseAmount(event.target.value))}
            inputMode="decimal"
            disabled={round.isPending}
            className="h-11 w-full rounded-i-sm border-[0.8px] border-beerus bg-goku px-3 text-sm tabular-nums text-bulma outline-none focus:border-piccolo disabled:text-trunks"
          />
          <div className="mt-1.5 flex gap-1.5">
            {/* Percentages of the CURRENT stake, not of the balance — this is
                the halve/double pair every originals client has. `percentOf`
                truncates, so ½ of an odd last digit rounds down rather than
                asking for a hundredth more than is held. */}
            <Quick onClick={() => setStake(percentOf(stake || '0', 50, decimals))}>½</Quick>
            <Quick onClick={() => setStake(percentOf(stake || '0', 200, decimals))}>2×</Quick>
            <Quick onClick={() => setStake(percentOf(balance, 100, decimals))}>Max</Quick>
          </div>
          {overBalance && (
            <p role="alert" className="mt-1.5 text-[11px] text-dodoria">
              That is more than your {currency} balance.
            </p>
          )}
        </Field>

        <Field
          label="Target multiplier"
          hint={validPayout ? `Roll above ${target.toFixed(2)}× to win` : `Minimum ${MIN_PAYOUT.toFixed(2)}×`}
        >
          <input
            value={payout}
            onChange={(event) => setPayout(sanitiseAmount(event.target.value))}
            inputMode="decimal"
            disabled={round.isPending}
            className="h-11 w-full rounded-i-sm border-[0.8px] border-beerus bg-goku px-3 text-sm tabular-nums text-bulma outline-none focus:border-piccolo disabled:text-trunks"
          />
          {!validPayout && payout !== '' && (
            <p role="alert" className="mt-1.5 text-[11px] text-dodoria">
              Below {MIN_PAYOUT.toFixed(2)}× the round is refused.
            </p>
          )}
        </Field>

        <div className="grid gap-1 rounded-i-md bg-goku px-3 py-2.5 text-xs">
          <Row
            label="Returns on a win"
            value={winReturn ? `${formatBalance(winReturn, decimals)} ${currency}` : '—'}
          />
          {/* Labelled as the curve it comes from, not as a win probability —
              see the header. `result = floor(98·2^52 / (2^52 − h)) / 100`, so
              the share of draws above a target is 98/target percent BEFORE
              the house switch, which this client cannot see. */}
          <Row
            label="Multiplier curve"
            value={validPayout ? `${(98 / target).toFixed(2)}% of draws clear it` : '—'}
          />
        </div>

        {round.isError && (
          <p role="alert" className="rounded-i-sm bg-dodoria/10 px-3 py-2 text-xs text-bulma">
            {round.error?.message || 'The round was refused.'}
          </p>
        )}

        <button
          type="button"
          onClick={submit}
          disabled={!ready}
          className="h-11 rounded-i-sm bg-piccolo text-sm font-medium text-goten transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {round.isPending ? 'Playing…' : 'Bet'}
        </button>
      </div>

      <div className="grid gap-3">
        <ResultPanel result={result} pending={round.isPending} currency={currency} decimals={decimals} />
        <RecentRounds currency={currency} />
      </div>
    </div>
  );
}

/**
 * The round's outcome, in the space the provider iframe occupies for an
 * aggregator game — same 16:9 box, so switching between an original and a
 * provider title does not move the page.
 */
function ResultPanel({ result, pending, currency, decimals }) {
  const won = result?.win === true;

  return (
    <div className="grid aspect-video w-full place-items-center rounded-s-md bg-popo px-6 text-center">
      {pending ? (
        <p className="text-sm text-goten/60">Drawing…</p>
      ) : result ? (
        <div>
          <p
            className={
              won
                ? 'font-secondary text-6xl font-medium text-roshi tabular-nums'
                : 'font-secondary text-6xl font-medium text-dodoria tabular-nums'
            }
          >
            {result.result}×
          </p>
          <p className="mt-3 text-sm text-goten">
            {won
              ? `Won ${formatBalance(result.profit ?? '0', decimals)} ${currency}`
              : `Lost ${formatBalance(String(result.profit ?? '0').replace('-', ''), decimals)} ${currency}`}
          </p>
          <p className="mt-1 text-xs text-goten/60 tabular-nums">
            Balance {formatBalance(result.balance ?? '0', decimals)} {currency}
          </p>
          {/* The round's identifier, and nothing more — see the file header on
              why this is not offered as a fairness proof. */}
          <p className="mx-auto mt-4 max-w-[420px] truncate font-mono text-[10px] text-goten/40">
            round #{result.gid} · {result.hash}
          </p>
        </div>
      ) : (
        <div>
          <span className="mx-auto grid size-14 place-items-center rounded-full bg-goten/10 text-goten">
            <Icon name="bolt" size={26} />
          </span>
          <p className="mt-3 text-sm text-goten/70">Set a stake and a target, then bet.</p>
        </div>
      )}
    </div>
  );
}

/**
 * The player's own last rounds, read back from the platform.
 *
 * `source: 'inhouse'` narrows `GET /casino/bet-history` to the `bets` table,
 * where one row IS one round: `amount` is the stake and `profit` the signed
 * win. The provider sources report movements instead, and mixing the two
 * shapes into one list is how a bet and its win end up looking like two bets.
 *
 * It exists so the round is verifiable from the screen: the panel above is
 * the socket reply talking about itself, and this is the database answering
 * the same question over HTTP a moment later.
 */
function RecentRounds({ currency }) {
  const { data, isPending, isError } = useBetHistory({ source: 'inhouse', limit: 6 });
  const rows = data?.data ?? [];

  if (isError) return null;

  return (
    <div className="rounded-s-md bg-gohan p-4">
      <h2 className="text-xs font-medium text-trunks">Your recent rounds</h2>

      {isPending ? (
        <div className="mt-3 grid gap-1.5">
          {[0, 1, 2].map((row) => (
            <Skeleton key={row} className="h-7 rounded-i-xs" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <p className="mt-3 text-xs text-trunks">Nothing yet — your first round appears here.</p>
      ) : (
        <ul className="mt-2 divide-y divide-beerus text-xs">
          {rows.map((row) => (
            <li key={`${row.id}-${row.transaction_id}`} className="flex items-center gap-3 py-2">
              <span className="w-20 shrink-0 truncate text-bulma">{row.game_title}</span>
              <span className="tabular-nums text-trunks">
                {row.amount} {row.currency_code ?? currency}
              </span>
              <span
                className={
                  row.outcome === 'win'
                    ? 'ms-auto tabular-nums text-roshi'
                    : 'ms-auto tabular-nums text-trunks'
                }
              >
                {row.profit}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Field({ label, hint, children }) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium text-trunks">{label}</span>
        {hint && <span className="text-[11px] tabular-nums text-trunks">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

function Row({ label, value }) {
  return (
    <span className="flex items-baseline justify-between gap-3">
      <span className="text-trunks">{label}</span>
      <span className="tabular-nums text-bulma">{value}</span>
    </span>
  );
}

function Quick({ onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex-1 rounded-i-xs bg-beerus py-1 text-[11px] font-medium text-bulma transition-colors hover:bg-trunks/20"
    >
      {children}
    </button>
  );
}

/**
 * Digits and one point, at most eight decimal places.
 *
 * The eight is not cosmetic: `money.toMinor` on the backend refuses anything
 * finer than the platform's `NUMERIC(30,8)` scale with
 * `BAD_REQUEST: amount supports at most 8 decimal places`, which reaches the
 * player as a message about decimal places rather than about their bet.
 */
function sanitiseAmount(value) {
  const cleaned = value.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1');
  const [whole, fraction] = cleaned.split('.');
  return fraction === undefined ? whole : `${whole}.${fraction.slice(0, 8)}`;
}
