import { Navigate, useParams } from 'react-router-dom';
import { TournamentCard } from '@/components/sections/TournamentCard';
import { Breadcrumb } from '@/components/ui/Breadcrumb';
import { ACTIVE_TOURNAMENTS, FINISHED_TOURNAMENTS } from '@/data/tournaments';

/**
 * `/tournaments/all/current` and `/tournaments/all/past` — where the two
 * `See all` links on `/tournaments` go. The reference uses exactly those two
 * segments, which is why the route is `all/:filter` with a fixed pair rather
 * than a query string.
 *
 * Same cards, laid out rather than railed. The rail exists on the index
 * because the sections have to share one screen with each other; here there is
 * one section and the whole column, so the cards wrap. `36.125rem` is the
 * card's own max width, so `auto-fill` gives two columns at the reference's
 * 1264px content width and one on a phone without a breakpoint of its own.
 *
 * The breadcrumb sits BELOW the grid, which is where every listing page in
 * this project puts it — the reference's own order, and the reason `GameList`
 * does the same.
 */
const FILTERS = {
  current: {
    heading: 'Active now',
    tournaments: ACTIVE_TOURNAMENTS,
    empty: 'No tournaments are running right now. Check back shortly.',
  },
  past: {
    heading: 'Finished',
    tournaments: FINISHED_TOURNAMENTS,
    empty: 'No tournaments have finished yet.',
  },
};

export function TournamentList() {
  const { filter } = useParams();
  const config = FILTERS[filter];

  // An unknown segment is not a 404 here: `/tournaments/all/anything` is still
  // the tournaments area, and the index is a better answer than an error page.
  if (!config) return <Navigate to="/tournaments" replace />;

  const { heading, tournaments, empty } = config;

  return (
    <div className="flex flex-col gap-6 py-2">
      <h1 className="font-primary text-2xl leading-8 font-normal tracking-normal text-bulma">
        {heading} ({tournaments.length})
      </h1>

      {tournaments.length === 0 ?
        <p className="py-16 text-center text-sm text-trunks">{empty}</p>
      : <ul className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(min(100%,28rem),1fr))]">
          {tournaments.map((tournament) => (
            <li key={tournament.slug}>
              <TournamentCard tournament={tournament} />
            </li>
          ))}
        </ul>
      }

      <Breadcrumb items={[{ label: 'Tournaments', to: '/tournaments' }, { label: heading }]} />
    </div>
  );
}
