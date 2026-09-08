import { Link } from 'react-router-dom';
import { PROVIDERS } from '@/data/catalog';

/**
 * Studio wordmarks, run as a single greyscale strip.
 *
 * Where the strip sits depends on the session, and `pages/Home.jsx` is what
 * decides — this component only draws the band. Signed out the reference puts
 * it directly under the hero, backing the pitch the hero just made. Signed in
 * it is the last section in the column, an 80px band immediately below the
 * collapsed editorial panel, with the banner row followed directly by the
 * first game rail — that is the measured column in `pages/Home.jsx`, and the
 * reason the strip is never a band between the promo cards and Originals.
 *
 * The reference deliberately gives these no card, no border, no game count and
 * no heading: they are a credibility footnote read at a glance, and boxing
 * each one turns the strip into a second navigation row competing with the
 * sidebar.
 *
 * Geometry is the reference's, measured from its own DOM:
 *
 * | | |
 * | --- | --- |
 * | Section | 80px tall, no heading, snap-scrolling on x |
 * | Tile | `h-20 w-40` (160x80), `px-4` — the spacing is padding, not a gap |
 * | Wordmark | 40px tall, `opacity-40`, full on hover, no transition |
 *
 * Fixed 160px tiles rather than a gap matter: they keep every wordmark on the
 * same rhythm however wide its own artwork is, which is what stops a strip of
 * mixed-width logos from reading as ragged.
 */
export function ProviderRail() {
  return (
    <section aria-label="Software providers">
      <ul className="rail items-center">
        {PROVIDERS.map((provider) => (
          <li key={provider.id}>
            <Link
              to={`/providers/${provider.slug}`}
              className="flex h-20 w-40 items-center justify-center px-4"
            >
              <img
                src={provider.logo}
                alt={provider.name}
                loading="lazy"
                decoding="async"
                className="h-10 w-auto max-w-full object-contain opacity-40 hover:opacity-100"
              />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
