import { Link } from 'react-router-dom';
import { PROVIDERS } from '@/data/catalog';

/**
 * Studio wordmarks, run as a single greyscale strip directly under the hero.
 *
 * The reference deliberately gives these no card, no border and no game count:
 * they are a credibility signal read at a glance, and boxing each one turns
 * the strip into a second navigation row competing with the sidebar.
 *
 * Each wordmark sits at `opacity-40` and snaps to full on hover, with no
 * transition — that is the reference's `h-10 opacity-40 hover:opacity-100`
 * verbatim. The deep rest state is what keeps the strip reading as texture
 * under the hero rather than as a row of live links.
 */
export function ProviderRail() {
  return (
    <section aria-label="Software providers" className="py-6">
      <ul className="rail items-center gap-6 md:gap-10">
        {PROVIDERS.map((provider) => (
          <li key={provider.id}>
            <Link
              to={`/providers/${provider.slug}`}
              className="grid h-10 place-items-center opacity-40 hover:opacity-100"
            >
              <img
                src={provider.logo}
                alt={provider.name}
                loading="lazy"
                decoding="async"
                className="h-9 w-auto max-w-[160px] object-contain"
              />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
