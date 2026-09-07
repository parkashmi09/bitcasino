import { ASSETS } from '@/data/assets.generated';
import { cn } from '@/lib/cn';

/**
 * Navigation icons.
 *
 * The reference renders these as 20x20 raster/vector images from its CMS, not
 * as inline glyphs — each one is a small full-colour illustration, which is
 * what makes the category list scannable. We serve the same files out of
 * /images/categories (see scripts/place-assets.mjs).
 *
 * The keys of SRC below are the complete set of valid `name` values.
 */

/** Our nav slugs to the CMS icon filenames, which use their own names. */
const SRC = {
  originals: ASSETS.navIcons.originals,
  'new-releases': ASSETS.navIcons['new-releases'],
  'live-rtp': ASSETS.navIcons['live-rtp'],
  promotions: ASSETS.navIcons.promotions,
  tournaments: ASSETS.navIcons.tournaments,
  providers: ASSETS.navIcons.providers,
  'live-games': ASSETS.navIcons['live-games'],
  'live-casino': ASSETS.navIcons['all-live-casino'],
  vip: ASSETS.navIcons.crown,
  'table-games': ASSETS.navIcons['table-games'],
  slots: ASSETS.navIcons.slots,
  crash: ASSETS.navIcons['crash-instant-win'],
  'game-shows': ASSETS.navIcons['game-shows'],
  jackpots: ASSETS.navIcons.jackpots,
};

/** `size` is the rendered size in px; 20 matches the reference's nav. */
export function NavIcon({ name, size = 20, className }) {
  return (
    <img
      src={SRC[name]}
      alt=""
      width={size}
      height={size}
      decoding="async"
      aria-hidden="true"
      className={cn('shrink-0 object-contain', className)}
      style={{ width: size, height: size }}
    />
  );
}
