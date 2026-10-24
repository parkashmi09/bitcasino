import { Link, useSearchParams } from 'react-router-dom';
import { Icon } from '@/components/ui/Icon';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { MAX_LIMIT, useGames } from '@/queries';
import { providerSlug } from '@/data/adapters/providers';
import { fmt } from './playMetrics';

/**
 * The reference's right column: more of the same studio.
 *
 * The tiles are the reference's exact row: from `md` the desktop art sits left
 * and the title is on its right with the provider + AVG RTP badges under it
 * (`md:w-full md:flex gap-x-4`), while a phone shows the portrait art with the
 * title below and no badges — the two images are separate files, so neither
 * device downloads the other's crop.
 *
 * The reference serves a landscape crop (`thumbUrl`, 490x368) to `md+` and a
 * portrait one (`thumbUrlTab`, 490x624) below it, both `w-[140px]`. Our
 * catalogue only ships a portrait file for almost every studio, so the source
 * `thumbWide` falls back to the same tall art — pinning both boxes to the
 * reference's ratios is what keeps the rows the reference's height instead of
 * the ~195px a bare 228x318 portrait used to give.
 *
 * Load More is the reference's `?take=` hop: an anchor inside the list that
 * bumps the query, never a request for a page the route cannot supply. The
 * same label fix as the lobby tiles — `In-House` prints as `Bitcasino`.
 */
const PROVIDER_LABEL = { 'In-House': 'Bitcasino' };

const STEP = 24;

export function ProviderGames({ game }) {
  const [params] = useSearchParams();
  const take = Number(params.get('take')) || STEP;

  const { data, isPending, isError } = useGames({ provider: game.provider, limit: take });

  const label = PROVIDER_LABEL[game.provider] ?? game.provider;
  const games = (data?.games ?? []).filter((other) => other.id !== game.id);
  const total = data?.pagination?.total ?? games.length;
  /** The route caps `limit` at 100, so a studio with more is truncated there. */
  const hasMore = data?.pagination ? total > take && take < MAX_LIMIT : false;
  const nextTake = Math.min(take + STEP, MAX_LIMIT);

  return (
    <section aria-label={`More from ${label}`}>
      <div className="flex w-full items-center justify-between py-4 pl-3">
        <h4 className="text-xl font-semibold tracking-tight text-bulma">More from {label}</h4>
        <Button as={Link} to={`/providers/${providerSlug(game.provider)}`} variant="outline" size="sm" className="px-2.5 text-sm">
          All
          <Icon name="chevron-right" size={16} />
        </Button>
      </div>

      {isPending ? (
        <ul className="flex gap-x-2 xl:flex-col xl:gap-y-2 xl:px-4">
          {[0, 1, 2].map((row) => (
            <li key={row} className="shrink-0">
              <Skeleton className="aspect-[490/624] w-[140px] rounded-lg md:aspect-[490/368]" />
            </li>
          ))}
        </ul>
      ) : isError || games.length === 0 ? (
        <p className="px-3 text-sm text-trunks">No other games from {label} right now.</p>
      ) : (
        <div className="flex shrink-0 min-w-0 max-w-full gap-x-2 transition-all max-xl:overflow-x-scroll no-scrollbar xl:flex-col xl:gap-y-2 xl:px-4">
          {games.map((other) => (
            <Tile key={other.id} game={other} />
          ))}

          {hasMore && (
            <Link to={`?take=${nextTake}`} className="w-full self-center">
              <button
                type="button"
                className="mt-4 h-8 w-full gap-1.5 rounded-i-sm border-[0.8px] border-beerus bg-gohan px-2.5 text-sm font-medium text-bulma transition-colors hover:bg-beerus"
              >
                Load More
              </button>
            </Link>
          )}
        </div>
      )}

      {/* The reference pads the column's foot with a fixed spacer — `mt-20` —
          so the last tile never sits against the page's bottom edge. */}
      <div className="mt-20" aria-hidden="true" />
    </section>
  );
}

function Tile({ game }) {
  const label = PROVIDER_LABEL[game.provider] ?? game.provider;

  return (
    <Link to={`/play/${game.category ?? 'games'}/${game.slug}`} className="block transition-opacity hover:opacity-80">
      <div className="gap-x-4 md:flex md:w-full">
        <div className="relative">
          {/* Two crops of the same tile, like the reference: the landscape art
              from `md`, the portrait art on a phone, each pinned to the
              reference's ratio (`thumbUrl` 490x368, `thumbUrlTab` 490x624) so
              a studio with only portrait art still yields the reference's row
              height rather than a full-height card. */}
          <img src={game.thumbWide} alt={game.title} loading="lazy" decoding="async" className="hidden aspect-[490/368] w-[140px] rounded-lg object-cover md:block" />
          <img src={game.thumb} alt={game.title} loading="lazy" decoding="async" className="block aspect-[490/624] w-[140px] rounded-lg object-cover md:hidden" />
        </div>

        <div className="flex w-full min-w-0 flex-col items-start justify-center gap-y-2">
          <h4 className="w-full truncate text-lg font-semibold tracking-tight text-bulma">{game.title}</h4>
          <div className="hidden gap-2 md:flex">
            <Pill>{label}</Pill>
            <Pill className="text-bulma">
              AVG RTP <b className="font-bold text-[#0CD664]">{game.rtp !== undefined ? `${fmt(game.rtp)}%` : '—'}</b>
            </Pill>
          </div>
        </div>
      </div>
    </Link>
  );
}

function Pill({ children, className }) {
  return (
    <span
      className={`inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap border border-beerus bg-gohan text-trunks ${className ?? ''}`}
    >
      {children}
    </span>
  );
}