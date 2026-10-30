import { Link } from 'react-router-dom';
import { SportIcon } from './icons';

/**
 * RaceBoard — a racing sport's races (Horse Racing / Greyhound Racing) for the lobby: one layer3
 * card per country, a row per venue, and the venue's race times as links to the race page.
 *
 * @param {object} props
 * @param {{ etid:number, name:string, children:Array<{ cid:string, name:string,
 *   children:Array<{ gmid:string, venue:string, time:string }> }> }} props.sport  model.js `racingSports` entry.
 * @param {string} [props.icon]                    SportIcon key for the card headers.
 * @param {(race)=>string} props.linkFor           Router path per race.
 */
export default function RaceBoard({ sport, icon, linkFor }) {
  return (
    <section className="flex flex-col gap-3">
      {sport.children.map((country) => {
        /* Venues in the order of their first race, each with its races in time order. */
        const venues = [];
        const byVenue = new Map();
        for (const race of country.children) {
          if (!byVenue.has(race.venue)) {
            byVenue.set(race.venue, []);
            venues.push(race.venue);
          }
          byVenue.get(race.venue).push(race);
        }
        return (
          <div key={country.cid} className="overflow-hidden rounded-xl bg-layer3">
            <div className="flex items-center gap-2 bg-layer4 px-3 py-2 sm:px-4">
              {icon && <SportIcon sport={icon} className="size-4 flex-none [&_svg]:size-full [&_svg]:fill-secondary" />}
              <span className="truncate text-xs font-semibold text-secondary">{country.name}</span>
            </div>
            {venues.map((venue) => (
              <div key={venue} className="flex flex-col gap-2 border-t border-layer4 px-3 py-2.5 first:border-t-0 sm:flex-row sm:items-center sm:px-4">
                <span className="w-40 flex-none truncate text-sm font-semibold text-primary">{venue}</span>
                <div className="flex flex-wrap gap-1.5">
                  {byVenue.get(venue).map((race) => (
                    <Link
                      key={race.gmid}
                      to={linkFor(race)}
                      className="rounded-md bg-layer5 px-2.5 py-1 text-xs font-semibold text-secondary hover:text-primary"
                    >
                      {race.time || 'Race'}
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
        );
      })}
    </section>
  );
}
