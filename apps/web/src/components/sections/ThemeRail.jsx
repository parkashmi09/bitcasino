import { Link } from 'react-router-dom';
import { THEMES } from '@/data/catalog';

/**
 * Curated-collection row. Tiles are landscape (16:9) rather than the portrait
 * ratio used for games, because these link to collection pages, not titles.
 *
 * These take no hover treatment, matching the reference: its theme cards wrap
 * a bare `absolute inset-0` link over the artwork and carry no hover class on
 * the card or on any thumbnail inside it. The fading play veil on `GameCard`
 * is the only hover state on the reference home page, and reserving it for
 * game tiles is what makes it read as "this one is playable".
 */
export function ThemeRail() {
  return (
    <section className="py-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="font-secondary text-xl font-light leading-8 text-bulma md:text-2xl">
          Themes
        </h2>
        <Link
          to="/themes"
          className="text-xs font-medium text-trunks transition-colors hover:text-piccolo"
        >
          See all
        </Link>
      </div>

      <ul className="rail gap-2 pb-2 md:gap-3">
        {THEMES.map((theme) => (
          <li key={theme.id}>
            <Link
              to={theme.href}
              className="block w-[200px] overflow-hidden rounded-i-md md:w-[260px]"
            >
              <div className="aspect-video overflow-hidden">
                <img
                  src={theme.art}
                  alt={theme.label}
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
