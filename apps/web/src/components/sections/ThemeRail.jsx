import { Link } from 'react-router-dom';
import { PLATFORM_COLLECTIONS } from '@/data/adapters/collections';

/**
 * Curated-collection row. Tiles are landscape (16:9) rather than the portrait
 * ratio used for games, because these link to collection pages, not titles.
 *
 * These take no hover treatment, matching the reference: its theme cards wrap
 * a bare `absolute inset-0` link over the artwork and carry no hover class on
 * the card or on any thumbnail inside it. The fading play veil on `GameCard`
 * is the only hover state on the reference home page, and reserving it for
 * game tiles is what makes it read as "this one is playable".
 *
 * The strip now names the **five collections the platform actually curates**
 * rather than the six invented `THEMES` it used to. Those six linked to
 * `/themes/:slug`, and there has never been a `/themes` route in `App.jsx` —
 * every tile in this row, and its "See all", was a 404. The five here each
 * link to `/games/:collection`, which `Category` serves from the platform's
 * own collection route.
 *
 * There is no request: `PLATFORM_COLLECTIONS` is slug, label and art, and the
 * strip renders none of the games inside a collection. Fetching five lists to
 * draw five tiles would be five requests for nothing.
 *
 * "See all" is gone with the route it pointed at. The five tiles ARE all of
 * them, so a link to a longer list would be a link to the same five.
 */
export function ThemeRail() {
  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="font-secondary text-xl font-light leading-8 text-bulma md:text-2xl">
          Themes
        </h2>
      </div>

      <ul className="rail gap-2 pb-2 md:gap-3">
        {PLATFORM_COLLECTIONS.map((collection) => (
          <li key={collection.slug}>
            <Link
              to={`/games/${collection.slug}`}
              className="block w-[200px] overflow-hidden rounded-i-md md:w-[260px]"
            >
              <div className="aspect-video overflow-hidden">
                <img
                  src={collection.art}
                  alt={collection.label}
                  loading="lazy"
                  decoding="async"
                  className="size-full object-cover"
                />
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
