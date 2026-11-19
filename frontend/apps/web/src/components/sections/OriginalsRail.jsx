import { Link } from 'react-router-dom';
import { Icon } from '@/components/ui/Icon';
import { orderOriginals, useInHouseGames, useOriginalGames } from '@/queries';
import { toast } from '@/lib/toast';
import { Rail } from './Rail';

/**
 * The in-house originals (dice, crash, limbo…), first on the home page as on the reference.
 *
 * They are listed by name only and not playable: the site admin has their play switched off, so a
 * tap explains that instead of opening a game that would refuse to start.
 */
const blocked = (name) =>
  toast.info(`${name} is switched off by the site admin right now.`, { title: 'Not available' });

/** The in-house list, replaced by the aggregator's (the admin's on/off and order) once it lists any. */
function useOriginalTiles() {
  const inHouse = useInHouseGames();
  const aggregator = useOriginalGames();
  return {
    data: aggregator.isPending ? undefined : orderOriginals(inHouse.data, aggregator.data),
    isPending: inHouse.isPending || aggregator.isPending,
  };
}

function OriginalCard({ game, className }) {
  if (game.code) {
    return (
      <Link
        to={`/play/originals/${encodeURIComponent(game.code)}`}
        aria-label={game.name}
        className={`relative flex aspect-[3/4] flex-col items-center justify-end overflow-hidden rounded-i-md bg-gradient-to-b from-[#5b2bd6] to-[#1d0b4a] p-3 text-left ${className}`}
      >
        {game.image && <img src={game.image} alt="" className="absolute inset-0 size-full object-cover" loading="lazy" />}
        {!game.image && <span className="font-display text-xl font-bold uppercase leading-none text-white">{game.name}</span>}
        {!game.image && <span className="mt-1 text-[11px] text-white/70">Originals</span>}
      </Link>
    );
  }
  return (
    <button
      type="button"
      onClick={() => blocked(game.name)}
      aria-label={`${game.name} (not available)`}
      className={`relative flex aspect-[3/4] cursor-pointer flex-col items-center justify-end overflow-hidden rounded-i-md bg-gradient-to-b from-[#5b2bd6] to-[#1d0b4a] p-3 text-left ${className}`}
    >
      <span className="absolute right-2 top-2 grid size-7 place-items-center rounded-full bg-black/35 text-white">
        <Icon name="lock" size={14} />
      </span>
      <span className="font-display text-xl font-bold uppercase leading-none text-white">{game.name}</span>
      <span className="mt-1 text-[11px] text-white/70">Originals</span>
    </button>
  );
}

export function OriginalsRail() {
  const { data: games } = useOriginalTiles();
  if (!games?.length) return null;

  return (
    <Rail title="Originals" href="/categories/originals">
      {games.map((game) => (
        <OriginalCard key={game.id} game={game} className="w-[104px] shrink-0 md:w-[124px] lg:w-[140px]" />
      ))}
    </Rail>
  );
}

/** `/categories/originals`: the same cards as a page (the catalogue has no `originals` category). */
export function OriginalsPage() {
  const { data: games, isPending } = useOriginalTiles();

  return (
    <section className="pt-6">
      <h1 className="mb-4 font-secondary text-xl font-light leading-8 text-bulma md:text-2xl">Originals</h1>
      {isPending ? null : games?.length ? (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6 md:gap-3 xl:grid-cols-8">
          {games.map((game) => (
            <OriginalCard key={game.id} game={game} />
          ))}
        </div>
      ) : (
        <p className="py-16 text-center text-sm text-trunks">No originals on this site yet.</p>
      )}
    </section>
  );
}
