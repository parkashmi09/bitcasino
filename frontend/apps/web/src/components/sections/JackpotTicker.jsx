import { Icon } from '@/components/ui/Icon';
import { formatBalance } from '@/lib/format';
import { useJackpots } from '@/queries/rewards';

/**
 * The aggregator's running jackpots (`GET /casino/gis/jackpots`), one scrolling row on the
 * signed-in home. Polled every minute. Nothing is drawn while GIS is not configured (503),
 * on error, or with no jackpot: a ticker has no useful empty state.
 */
export function JackpotTicker() {
  const { data } = useJackpots();
  if (!data?.length) return null;

  return (
    <section aria-label="Jackpots" className="no-scrollbar flex gap-3 overflow-x-auto py-3">
      {data.map((jackpot) => (
        <div
          key={jackpot.id}
          className="flex shrink-0 items-center gap-3 rounded-i-sm border border-beerus bg-gohan px-4 py-2"
        >
          <span className="grid size-8 place-items-center rounded-full bg-jackpot text-goten">
            <Icon name="trophy" size={16} />
          </span>
          <span className="grid">
            <span className="text-xs text-trunks">{jackpot.name}</span>
            <span className="text-base font-bold text-bulma tabular-nums">
              {formatBalance(String(jackpot.amount))} {jackpot.currency}
            </span>
          </span>
        </div>
      ))}
    </section>
  );
}
