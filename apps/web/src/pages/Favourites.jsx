import { GameList } from '@/components/sections/GameList';
import { useFavourites } from '@/hooks/useFavourites';

/**
 * `/games/favourite` — where the sidebar's star goes.
 *
 * The same listing chrome every game page uses, with no filters: the reference
 * draws a bare `Favourites` heading over the auto-fitting grid and the trail
 * below it, exactly as it does on `/games/recent`. There is no sort control,
 * because a favourites list has one true order — most recently added first,
 * which is the reference's own `addedTime: -1` — and nothing to narrow by.
 *
 * The list is local (`useFavourites`), so unlike `Recent` this page has no
 * request to fail and no skeleton to stand in: the store is readable on the
 * first render and the grid paints with it.
 *
 * It is also not behind `RequireAuth`. The reference gates its own favourites
 * on the account, but there is no server list here to protect — the data never
 * leaves the device — and the only entry point, the sidebar star, already
 * renders for signed-in players alone. Guarding the page would only make a
 * bookmarked URL bounce through a login form for no one's benefit.
 */
export function Favourites() {
  const { games } = useFavourites();

  return (
    <GameList
      title="Favourites"
      games={games}
      breadcrumb={CRUMB}
      empty="No favourite games yet. Open a game and press the star to keep it here."
    />
  );
}

/**
 * `Games` points at the All Games page, which is where the reference's own
 * trail sends it — verbatim from the favourites capture (`href="/games"`).
 */
const CRUMB = [{ label: 'Games', to: '/games' }, { label: 'Favourites' }];
