import { Icon } from '@/components/ui/Icon';
import { useCountdown } from '@/hooks/useCountdown';
import { formatBalance } from '@/lib/format';
import { cn } from '@/lib/cn';
import { useQuests } from '@/queries/promotions';

/**
 * Today's quests on `/promotions` (`GET /user/quests`, owner `challenges`, gate `quests`).
 *
 * Progress only: the platform's quests carry no reward and have no claim route, so a
 * finished quest reads "Completed" rather than offering a button that has nothing to pay.
 * Signed-out and on error it renders nothing, like the rest of the index's optional rows.
 */
export function DailyQuests() {
  const { data } = useQuests();
  if (!data?.quests?.length) return null;

  return (
    <section className="grid gap-3 rounded-i-sm bg-gohan p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-xl leading-7 font-semibold text-bulma">Daily quests</h2>
        {data.endsAt && <EndsIn at={data.endsAt} />}
      </div>
      <ul className="grid gap-3 md:grid-cols-2">
        {data.quests.map((quest) => (
          <li key={quest.key}>
            <Quest quest={quest} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function EndsIn({ at }) {
  const { hours, minutes, seconds, done } = useCountdown(at);
  return (
    <span className="text-sm text-trunks tabular-nums">
      {done ? 'Resetting…' : `Resets in ${hours}:${minutes}:${seconds}`}
    </span>
  );
}

function Quest({ quest }) {
  const usd = quest.unit === 'usd';
  const target = Number(quest.target) || 0;
  const width = target > 0 ? Math.min(100, (Number(quest.progress) / target) * 100) : 100;
  const show = (value) => (usd ? `${formatBalance(String(value))} USD` : String(Math.floor(Number(value))));

  return (
    <article className="grid gap-2 rounded-i-sm bg-goku p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-base font-bold text-bulma">{quest.title}</h3>
        <span className={cn('flex items-center gap-1 text-sm', quest.completed ? 'text-roshi' : 'text-trunks')}>
          {quest.completed && <Icon name="check" size={16} />}
          {quest.completed ? 'Completed' : `${show(quest.progress)} / ${show(quest.target)}`}
        </span>
      </div>
      <p className="text-sm text-trunks">{quest.description}</p>
      <div
        role="progressbar"
        aria-label={`${quest.title} progress`}
        aria-valuenow={Math.round(width)}
        aria-valuemin={0}
        aria-valuemax={100}
        className="h-2 overflow-hidden rounded-full bg-beerus"
      >
        <div className="h-full rounded-full bg-piccolo" style={{ width: `${width}%` }} />
      </div>
    </article>
  );
}
