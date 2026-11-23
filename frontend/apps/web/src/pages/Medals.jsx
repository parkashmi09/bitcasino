import { Icon } from '@/components/ui/Icon';
import { Skeleton } from '@/components/ui/Skeleton';
import { useMedals } from '@/queries/rewards';
import { cn } from '@/lib/cn';

/**
 * `/profile/medals` — the player's achievements (`GET /user/medals`).
 *
 * Cosmetic: nothing is paid, so the backend serves it to every player, an agent's included.
 * Every medal is listed, locked or not; a medal the platform cannot measure says why.
 * Same grid and card shell as Rewards (`gohan`, `rounded-i-sm`, container-fitted columns).
 */
export function Medals() {
  const { data, isPending, isError } = useMedals();
  const medals = data?.medals ?? [];

  return (
    <div className="grid gap-4">
      <h1 className="font-primary text-2xl font-normal tracking-normal text-bulma">
        Medals
        {data && (
          <span className="ms-2 text-base text-trunks tabular-nums">
            {data.medalCount} / {data.total ?? medals.length}
          </span>
        )}
      </h1>

      {isPending ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(220px,100%),1fr))] gap-4">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-40 rounded-i-sm" />
          ))}
        </div>
      ) : isError ? (
        <p className="max-w-[750px] text-sm text-trunks">Could not load your medals. Reload the page to try again.</p>
      ) : medals.length === 0 ? (
        <p className="max-w-[750px] text-sm text-trunks">No medals yet.</p>
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(220px,100%),1fr))] items-start gap-4">
          {medals.map((medal) => (
            <li key={medal.key}>
              <MedalCard medal={medal} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function MedalCard({ medal }) {
  const progress = medal.progress;
  const width = progress?.target ? Math.min(100, (Number(progress.current) / Number(progress.target)) * 100) : 0;

  return (
    <article className={cn('grid gap-3 rounded-i-sm bg-gohan p-4', !medal.unlocked && 'opacity-80')}>
      <div className="flex items-center gap-3">
        <span
          className={cn(
            'grid size-10 shrink-0 place-items-center rounded-full',
            medal.unlocked ? 'bg-piccolo text-on-piccolo' : 'bg-goku text-trunks',
          )}
        >
          <Icon name={medal.unlocked ? 'trophy' : 'lock'} size={20} />
        </span>
        <h2 className="min-w-0 font-primary text-base leading-6 font-bold tracking-normal text-bulma">
          {medal.title}
        </h2>
      </div>

      <p className="text-sm leading-5 text-trunks">
        {medal.rule?.description ?? medal.unavailableReason ?? ''}
      </p>

      {!medal.unlocked && progress && (
        <div
          role="progressbar"
          aria-label={`${medal.title} progress`}
          aria-valuenow={Math.round(width)}
          aria-valuemin={0}
          aria-valuemax={100}
          className="h-2 overflow-hidden rounded-full bg-goku"
        >
          <div className="h-full rounded-full bg-piccolo" style={{ width: `${width}%` }} />
        </div>
      )}

      <p className="text-xs text-trunks">
        {medal.unlocked
          ? `Unlocked ${new Date(medal.unlockedAt).toLocaleDateString('en-GB')}`
          : progress
            ? `${progress.current} / ${progress.target}${medal.rule?.unit ? ` ${medal.rule.unit}` : ''}`
            : 'Locked'}
        {' · '}
        {medal.holders} {medal.holders === 1 ? 'holder' : 'holders'}
      </p>
    </article>
  );
}
