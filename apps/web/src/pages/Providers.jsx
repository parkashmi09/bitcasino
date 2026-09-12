import { Link } from 'react-router-dom';
import { ProviderGridSkeleton, QueryError, QueryEmpty } from '@/components/ui/QueryState';
import { useProviders } from '@/queries';

/**
 * Every studio in the catalogue, at `/providers`.
 *
 * The list is `GET /casino/games/providers` and the counts are
 * `topProviders` out of `GET /casino/games/stats` — two routes, because the
 * platform has no single one that answers both. `useProviders` joins them and
 * lets the counts fail on their own: a grid of studios reading "0 games" is a
 * working page, and an error where a studio list should be is not.
 *
 * ## A studio with no logo still gets a tile
 *
 * `toProvider` answers `logo: null` for a studio we have no art for, and after
 * a real Slotegrator sync that is most of them — nobody ships several hundred
 * studio wordmarks with a front end. So the tile falls back to the name set in
 * the same place the wordmark would have gone. That is why this grid renders
 * every studio while `ProviderRail` skips the ones without art: the rail is
 * *only* wordmarks and has no text treatment to fall back to, and this page is
 * the catalogue of record.
 */
/**
 * Up to two initials for a studio with no wordmark.
 *
 * Words rather than characters, so `Big Time Gaming` is `BT` and not `Bi`, and
 * `In-House` is `IH` — the hyphen is a word break in a studio name as often as
 * a space is.
 */
function monogram(name) {
  return String(name)
    .split(/[\s-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0].toUpperCase())
    .join('');
}

export function Providers() {
  const { data: providers, isPending, error, refetch } = useProviders();

  if (isPending) {
    return (
      <div className="py-6">
        <h1 className="font-secondary text-xl font-light leading-8 text-bulma md:text-2xl">
          Software providers
        </h1>
        <p className="mt-1 text-sm text-trunks">Loading studios…</p>
        <div className="mt-5">
          <ProviderGridSkeleton />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="py-6">
        <h1 className="font-secondary text-xl font-light leading-8 text-bulma md:text-2xl">
          Software providers
        </h1>
        <div className="mt-5">
          <QueryError
            error={error}
            onRetry={refetch}
            title="Could not load the studio list"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="py-6">
      <h1 className="font-secondary text-xl font-light leading-8 text-bulma md:text-2xl">
        Software providers
      </h1>
      <p className="mt-1 text-sm text-trunks">
        {providers.length} {providers.length === 1 ? 'studio' : 'studios'}
      </p>

      {providers.length === 0 ? (
        <div className="mt-5">
          <QueryEmpty
            title="No studios yet"
            message="The catalogue has not been synced with a provider account."
          />
        </div>
      ) : (
        <ul className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
          {providers.map((provider) => (
            <li key={provider.id}>
              <Link
                to={`/providers/${provider.slug}`}
                className="flex h-28 flex-col items-center justify-center gap-2 rounded-i-md bg-gohan px-3 transition-colors hover:bg-beerus"
              >
                {provider.logo ? (
                  <img
                    src={provider.logo}
                    alt={provider.name}
                    loading="lazy"
                    decoding="async"
                    className="h-7 w-auto max-w-full object-contain"
                  />
                ) : (
                  // A monogram, not the name again — the name is already the
                  // line below, and repeating it reads as a rendering fault
                  // rather than as missing art. It occupies the wordmark's own
                  // 28px band so a tile with art and one without are the same
                  // height and the grid does not go ragged.
                  <span
                    aria-hidden="true"
                    className="grid size-7 place-items-center rounded-full bg-beerus font-secondary text-xs font-semibold text-trunks"
                  >
                    {monogram(provider.name)}
                  </span>
                )}
                <span className="text-center text-xs font-medium text-bulma">
                  {provider.name}
                </span>
                <span className="text-[11px] text-trunks">
                  {provider.gameCount} {provider.gameCount === 1 ? 'game' : 'games'}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
