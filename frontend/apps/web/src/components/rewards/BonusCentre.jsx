import { Link } from 'react-router-dom';
import { useCountdown } from '@/hooks/useCountdown';
import { useGates } from '@/hooks/useGates';
import { formatBalance } from '@/lib/format';
import { useBonusEvents } from '@/queries';
import { useBonusHistory } from '@/queries/promotions';
import { useRakeback } from '@/queries/rewards';

/**
 * The Bonus centre block under `/profile/boosts` — owner `bonus_centre` on top of `bonus`
 * (gate `bonusCentre`, off for an agent's player like every promotion).
 *
 * Four reads, each already the caller's own: the periodic bonuses' next windows (the page's
 * `GET /user/bonus`, passed in), rakeback (`/user/rakeback`), the award history
 * (`/user/bonus/history`) and the bonus log (`/user/bonus/events`). A part with nothing in it
 * is left out; the block renders nothing at all when every part is empty.
 */
const TYPES = [
  ['daily', 'Daily bonus'],
  ['weekly', 'Weekly bonus'],
  ['monthly', 'Monthly bonus'],
];

export function BonusCentre({ bonus }) {
  const gates = useGates();
  const rakeback = useRakeback({ enabled: gates.on('rakeback') });
  const history = useBonusHistory();
  const events = useBonusEvents({ limit: 10 });
  const currency = bonus?.currency ?? '';

  const next = TYPES.filter(([id]) => bonus?.types?.[id]?.eligible && bonus.types[id].nextClaimAt);
  const awards = history.data ?? [];
  const log = events.data?.events ?? [];
  const rb = rakeback.data;
  if (next.length === 0 && awards.length === 0 && log.length === 0 && !rb) return null;

  return (
    <section className="grid gap-4 rounded-i-md bg-gohan p-4">
      <h2 className="font-primary text-xl leading-7 font-medium tracking-normal text-bulma">Bonus centre</h2>

      {(next.length > 0 || rb) && (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(220px,100%),1fr))] gap-3">
          {next.map(([id, label]) => (
            <li key={id} className="grid gap-1 rounded-i-sm bg-goku p-3">
              <span className="text-sm text-trunks">{label}</span>
              {bonus.types[id].claimable ? (
                <span className="text-base font-bold text-roshi">Ready to claim</span>
              ) : (
                <Countdown at={bonus.types[id].nextClaimAt} />
              )}
            </li>
          ))}
          {rb && (
            <li className="grid gap-1 rounded-i-sm bg-goku p-3">
              <span className="text-sm text-trunks">Rakeback</span>
              <span className="text-base font-bold text-bulma tabular-nums">
                {formatBalance(String(rb.amount ?? '0'))} {rb.currency}
              </span>
              <Link to="/promotions/weekly-rakeback-2026" className="text-sm text-piccolo underline underline-offset-2">
                {rb.claimable ? 'Claim it' : 'How it works'}
              </Link>
            </li>
          )}
        </ul>
      )}

      {awards.length > 0 && (
        <List heading="Bonus awards">
          {awards.map((row) => (
            <Row
              key={row.id}
              left={`${String(row.type ?? 'bonus').replace(/^\w/, (c) => c.toUpperCase())} bonus`}
              sub={row.claimed ? 'claimed' : row.unclaimable ? 'not claimable' : 'waiting'}
              right={`${formatBalance(String(row.amount ?? '0'))} ${row.amountCurrency ?? currency}`}
              at={row.claimedAt ?? row.createdAt}
            />
          ))}
        </List>
      )}

      {log.length > 0 && (
        <List heading="Recent bonus events">
          {log.map((row, index) => (
            <Row key={row.id ?? index} left={row.name} right={`${formatBalance(row.amount)} ${currency}`} at={row.at} />
          ))}
        </List>
      )}
    </section>
  );
}

function Countdown({ at }) {
  const { days, hours, minutes, seconds, done } = useCountdown(at);
  return (
    <span className="text-base font-bold text-bulma tabular-nums">
      {done ? 'Due now' : `${Number(days) > 0 ? `${days}d ` : ''}${hours}:${minutes}:${seconds}`}
    </span>
  );
}

function List({ heading, children }) {
  return (
    <div className="grid gap-2">
      <h3 className="text-base font-medium text-bulma">{heading}</h3>
      <ul className="grid gap-2">{children}</ul>
    </div>
  );
}

function Row({ left, sub, right, at }) {
  return (
    <li className="flex items-baseline justify-between gap-3 rounded-i-sm bg-goku px-4 py-3 text-sm">
      <span className="min-w-0 truncate text-bulma">
        {left}
        {sub && <span className="text-trunks"> · {sub}</span>}
      </span>
      <span className="text-end text-bulma tabular-nums">
        {right}
        {at && <span className="block text-xs text-trunks">{new Date(at).toLocaleDateString('en-GB')}</span>}
      </span>
    </li>
  );
}
