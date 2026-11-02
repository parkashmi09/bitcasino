import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { useCountdown } from '@/hooks/useCountdown';
import { cn } from '@/lib/cn';

/** `12.5` → `12.5`, `100.00000000` → `100`: amounts arrive as decimal strings. */
const trim = (value) => String(Number(value ?? 0));

/**
 * One casino challenge (`GET /casino/challenges`): the first `winners` players to hit
 * `minMultiplier`× on the game with a bet of at least `minBetUsd` win `prizeUsd` each.
 * Same frame as `TournamentCard` so the two read as one page.
 */
export function ChallengeCard({ challenge }) {
  const { game, gameName, imageUrl, minMultiplier, minBetUsd, prizeUsd, winners, winnersFound, winnerNames, endsAt } = challenge;
  const time = useCountdown(endsAt);
  const finished = time.done || winnersFound >= winners;

  return (
    <article className="grid w-full max-w-[36.125rem] gap-3 rounded-s-md bg-gohan p-4">
      {imageUrl && (
        <img
          src={imageUrl}
          alt=""
          loading="lazy"
          decoding="async"
          className={cn('block h-[11.375rem] w-full rounded-s-md bg-goku-80 object-cover', finished && 'grayscale')}
        />
      )}

      <div className="flex items-center justify-between gap-2">
        <span
          className={cn(
            'inline-flex h-4 items-center rounded-i-xs px-2 text-[9px] font-medium uppercase tracking-[0.0625rem] text-goten',
            finished ? 'bg-popo' : 'bg-roshi',
          )}
        >
          {finished ? 'Finished' : 'Active'}
        </span>
        {!finished && (
          <span className="text-xs leading-4 text-trunks">
            Ends in {time.days}d {time.hours}:{time.minutes}:{time.seconds}
          </span>
        )}
      </div>

      <p className="font-secondary text-[18px] font-light leading-6 text-bulma">{gameName || 'Challenge'}</p>
      <p className="text-sm leading-5 text-trunks">
        Hit <b className="font-semibold text-bulma">{trim(minMultiplier)}×</b> with a bet of at least{' '}
        <b className="font-semibold text-bulma">${trim(minBetUsd)}</b>. The first {winners}{' '}
        {winners === 1 ? 'player wins' : 'players win'} <b className="font-semibold text-bulma">${trim(prizeUsd)}</b>.
      </p>

      <div className="grid grid-cols-2 gap-2">
        <div className="grid gap-1 rounded-s-sm bg-goku px-3 py-2">
          <span className="text-xs leading-4 text-trunks">Prize</span>
          <span className="text-sm leading-6 text-bulma">${trim(prizeUsd)} each</span>
        </div>
        <div className="grid gap-1 rounded-s-sm bg-goku px-3 py-2">
          <span className="text-xs leading-4 text-trunks">Winners</span>
          <span className="text-sm leading-6 text-bulma">
            {winnersFound} / {winners}
          </span>
        </div>
      </div>

      {winnerNames?.length > 0 && (
        <p className="truncate text-xs leading-4 text-trunks">Won by {winnerNames.join(', ')}</p>
      )}

      {!finished && game && (
        <Button as={Link} to={`/play/games/${game}`} variant="primary" fullWidth>
          Play
        </Button>
      )}
    </article>
  );
}
